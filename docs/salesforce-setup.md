# Salesforce B2B Commerce — setup & field notes

Everything here was verified against a live org (`orgfarm-896decfb44-dev-ed`) by
probing the API directly. Where the official docs and observed behaviour
disagree, the observed behaviour is recorded and the discrepancy called out.

Read this before touching `src/lib/salesforce/auth/`.

---

## 1. Environment

Copy `.env.example` → `.env`.

| Variable | Notes |
|---|---|
| `SF_INSTANCE_URL` | My Domain host. **Not** `login.salesforce.com` / `test.salesforce.com` — those are login hosts and the Data API rejects them with `URL_NOT_RESET`. Validated at startup. |
| `SF_EXPERIENCE_SITE_URL` | Experience Cloud site base. All Identity/OAuth calls go here, never the org host. |
| `SF_WEBSTORE_ID` | 18-char WebStore Id, starts with `0ZE`. |
| `SF_API_VERSION` | Pinned, e.g. `v63.0`. |
| `SF_CLIENT_ID` / `SF_CLIENT_SECRET` | External Client App consumer key/secret. |
| `VITE_PUBLIC_SITE_URL` | Public origin. `VITE_`-prefixed because route `head()` runs on the client too and needs the same value for canonicals. |
| `SF_GUEST_MODE` | `client_credentials` (default) or `guest_user`. See §4. |
| `SF_DEBUG` | `1` enables verbose SDK logging. Errors always log. |

The SDK auto-discovers the API host from `instance_url` in the token response
and prefers it over `SF_INSTANCE_URL`, so a wrong value self-corrects after the
first token — except in `guest_user` mode, where the site host is used instead.

---

## 2. External Client App configuration

Setup → **External Client App Manager** → your app.

### Settings → OAuth Settings

- **Callback URL** — must include `{VITE_PUBLIC_SITE_URL}/auth/callback`. The
  headless flows never redirect a browser there, but Salesforce still validates
  the value against this allowlist.
- **Selected OAuth Scopes** — must include:
  - `Manage user data via APIs (api)`
  - `Perform requests at any time (refresh_token, offline_access)`

  `Full access (full)` is **not** sufficient on its own. The Client Credentials
  flow rejects it with `no valid scopes defined`, and the `scope` request
  parameter is refused outright (`scope parameter not supported`), so this can
  only be fixed on the app.

  Without `refresh_token`, the org issues no refresh token at all and buyers are
  silently logged out at the first access-token expiry.

### Policies → OAuth Policies

- **Permitted Users** — `All users can self-authorize` is simplest for dev. If
  set to `Admin approved users are pre-authorized`, every profile that needs to
  log in must be added under Manage Profiles.

  > Per Salesforce docs, Permitted Users policies **do not apply to the Client
  > Credentials execution user**. So this setting never explains a
  > client-credentials failure — don't go looking there.

- **Enable Client Credentials Flow** + **Run As** — see §3.
- **Enable Code and Credentials Flow for Guest Users** — see §4.

  ⚠️ Toggling *Enable Client Credentials Flow* has been observed to clear both
  the Run-As user **and** the guest-flow checkbox. Re-check both after any edit.

- **IP Relaxation** — set to `Relax IP restrictions`, or allowlist the server's
  egress IP. `Enforce IP restrictions` works from localhost but starts rejecting
  tokens once deployed, in a way that reads like a credential problem.

---

## 3. Guest identity — `client_credentials` mode

Anonymous catalog traffic runs as the app's **Run As** user.

### The constraint that matters

The Run-As user must be able to see the catalog, and B2B Commerce resolves the
catalog through a *buyer context*. Verified by probe:

| Run-As user | Result |
|---|---|
| System Administrator | Works — admins bypass entitlement checks |
| `Minimum Access - Salesforce` + API Enabled + site member | **403 on every catalog endpoint**; `/search` returns `Invalid effective accountId` |
| Customer Community Plus (portal) user | `access_denied: end-user denied authorization` — rejected as execution user |

So in practice this mode needs a privileged internal user, which has a real
consequence: **every anonymous visitor, and everything a crawler indexes, sees
the catalog through that user's eyes.** Never point Run-As at a System
Administrator in production. This is the main reason `guest_user` mode exists.

Pricing also 403s in this mode (`The buyer account is not a member of the
store`) because an internal user has no Contact/Account and therefore is not a
buyer. PDPs correctly render "Sign in to see pricing", and `productJsonLd`
omits `offers.price` rather than publishing something false.

---

## 4. Guest identity — `guest_user` mode (preferred)

Runs as the Experience Cloud guest user: minimal permissions, tied to the
store's guest buyer account, so what renders is genuinely what an anonymous
visitor sees — which is exactly what should be indexed.

### The wire contract

Five things differ from what the docs imply. Each produced a misleading error,
and all are now encoded in `auth/headless.ts`.

1. **The UVID is a header, not a parameter.**
   - Authorize: `Uvid-Hint: UVID <v4-uuid>` — the literal `UVID ` prefix.
   - Token: `Uvid-Hint: <v4-uuid>` — same id, **no** prefix.
   - `Auth-Request-Type: guest` (lowercase; `Guest-User` → `invalid headers`).

   Every wrong shape returns the identical `invalid_request: uvid invalid`,
   *including omitting it entirely*, so the error carries no signal.

2. **Scope must be `api`.** The docs example uses `openid`, which this org
   rejects. Verified: `api` and `refresh_token` are accepted; `openid`, `web`
   and `full` all fail with `invalid_scope`.

3. **Authorize returns a 302, not JSON.** The code arrives in the `Location`
   query string. `fetch` must use `redirect: "manual"` — following the redirect
   sends the code to the callback and leaves an empty body.

4. **Salesforce requires HTTP/2.** Node's global `fetch` is HTTP/1.1, and over
   1.1 the token exchange fails as `uvid invalid` — blaming the UVID for a
   transport problem. Byte-identical requests:

   ```
   curl --http2    → 200, token issued
   curl --http1.1  → 400, "uvid invalid"
   ```

   Fixed with `undici` + `new Agent({ allowH2: true })` in
   `lib/salesforce/fetch.ts`, scoped to identity calls only.

5. **Guest tokens are site-scoped JWTs.** Sent to the org host they fail
   `INVALID_ISS: INVALID_AUTH_HEADER`; they authenticate only against the
   Experience site host. `instanceUrl()` in `config.ts` switches base by mode.

### Org setup — the chain that makes it work

Order matters; each step's failure looks different:

1. **Enable Guest Browsing** on the store.
   Without it: `401 INSUFFICIENT_ACCESS: This feature is not currently enabled
   for this user.`
2. **Add the store's guest buyer group to the WebStore**, with an **entitlement
   policy**.
   Without it: `404 WEBSTORE_NOT_FOUND`. This is the step most easily missed —
   enabling Guest Browsing alone is *not* sufficient, and the error names the
   webstore rather than the missing entitlement.
3. **Assign a price book** to that buyer group, if guest prices are wanted.
   Without it the catalog renders fine and PDPs show "Sign in to see pricing";
   `productJsonLd` correctly omits `offers.price` rather than publishing a zero.

Steps 2 and 3 are separate on purpose — entitlement controls *what* is visible,
the price book controls *how much*.

**Status in this org:** all three done and verified — guest browsing returns 200
with all 18 products and real list prices.

Note the site's canonical path is `/meridianvforcesite` while `.env` uses
`/meridian`. Both authenticate and both work, so this is cosmetic — but worth
knowing if a second site ever appears in the org.

The guest token cannot query objects (`INVALID_SESSION_ID` on `/query`), so org
state can't be inspected from the client side; use Setup for these checks.

---

## 5. Buyer login (headless)

`POST {site}/services/oauth2/authorize` with `Auth-Request-Type: Named-User`,
`response_type=code_credentials` + PKCE, then exchange for tokens. Verified
working, including a `refresh_token` in the response.

### The four gates, in the order they bite

Each produces a different error, and only the last one is non-obvious.

**1. App authorization** — `invalid_app_access: user is not admin approved`.

The buyer's profile must be granted access on the **External Client App's own
Policies page** (App Policies → Select Profiles / Select Permission Sets). The
classic Connected App "Manage Profiles" screen does *not* govern External Client
Apps — editing it looks like it works and changes nothing.

Note also that `All users can self-authorize` cannot help a headless flow:
self-authorization happens through an interactive consent screen, and there
isn't one. Headless named-user login requires explicit pre-authorization.

**2. API access** — `API_CURRENTLY_DISABLED: API is disabled for this User`.

`Customer Community Plus Login User` does not include **API Enabled**. Grant it
via a permission set whose *License* is `--None--` (a Salesforce-licensed
permission set cannot be assigned to a community user). Standard profiles cannot
be edited, so a permission set is the only route.

**3. Object access** — `INSUFFICIENT_ACCESS` on catalog endpoints.

Read on `Product2`, `ProductCategory`, `ProductCatalog`, `WebStore`,
`WebStoreCatalog`. Object Settings is a *separate tab* from System Permissions
in a permission set; granting only `API Enabled` leaves this half-done.

**4. The Buyer permission set** — `INSUFFICIENT_ACCESS: You can't access this
account.`

⚠️ **The one that costs the most time.** B2B Commerce gates named-user store
access behind Salesforce's preconfigured **`Buyer`** permission set. Buyer group
membership, entitlement policy, price book and object permissions are all
*necessary but not sufficient* — which is why fixing them one at a time keeps
returning the same error.

Setup → Permission Sets → **`Buyer`** → Manage Assignments → add the user.

Diagnostic that isolates it: if SOQL works for the buyer
(`SELECT Id, Name FROM Account` returns) but every `/commerce/webstores/...`
call fails, the problem is the Buyer permission set, not object permissions.

> **Why guest can work perfectly while buyer fails.** The Experience Cloud guest
> buyer profile is handled by the platform, not by a permission set. So guest
> browsing can be fully green while every named buyer is locked out — the two
> paths share almost no authorization machinery.

### Buyer entitlement chain

Separate from permissions, and all of it required:

1. Account enabled as a **Buyer Account**
2. Account in a **Buyer Group**
3. Buyer Group has an **Entitlement Policy** → controls *what* is visible
4. Buyer Group has a **Price Book** → controls *prices*
5. Buyer Group assigned to the **WebStore**

Missing 3 gives an empty catalog; missing 4 gives products with no prices
(`PRICE_NOT_FOUND`, `pricebookEntryId: null`).

Rebuild the search index after entitlement changes — Commerce → store →
Administration → Search → Rebuild Index. Results come from the index, so changes
can look like they didn't apply when the index is simply stale.

---

## 6. Connect REST API — observed shapes

The documented shapes did not hold in this org. Encoded in
`resources/categories.ts`.

- **Root categories**: `GET /product-categories/children` with **no** category
  Id. The documented `/product-categories/{id}/children` returns 404.
- **`?categoryId=` is silently ignored** in some configurations — the response
  echoes the same top-level list. Unguarded this makes any tree walk infinitely
  recursive, so `listChildCategories` drops entries matching the requested Id.
- **`/product-category-paths/...` returns 404**, so breadcrumb ancestors are
  derived from the tree walk instead of fetched.
- **Field placement**: display name is at `fields.Name` (not top-level `name`);
  the slug is top-level `urlName`. In search results `fields.*` values are
  wrapped as `{value: …}`; on the detail endpoint they are plain strings. The
  `fieldValue()` helper handles both.
- **`urlName` is null** on every product in this org, so slugs derive from
  names. Populating `urlName` in Salesforce would pin URLs — worth doing before
  anything is indexed, since renaming a product currently changes its URL.
- **Search requires** `searchTerm` and/or `categoryId`; neither alone is
  optional (`INVALID_API_INPUT`).

---

## 7. Error reference

`explainAuthError()` in `lib/salesforce/log.ts` maps each of these to the exact
admin action and prints it to the terminal alongside the raw error.

| Error | Cause |
|---|---|
| `no client credentials user enabled` | Client Credentials flow enabled but no Run-As user |
| `invalid_app_access` / `not admin approved` | Permitted Users is admin-approved; profile not granted |
| `access_denied: end-user denied authorization` | Run-As user rejected (e.g. a portal user) |
| `no valid scopes defined` | App scopes lack `api`; `full` alone is not accepted |
| `URL_NOT_RESET` | `SF_INSTANCE_URL` points at a login host |
| `API_CURRENTLY_DISABLED` | User lacks `API Enabled` |
| `INVALID_ISS` | Guest JWT sent to the org host instead of the site host |
| `INSUFFICIENT_ACCESS` | Guest user has no commerce access |
| `uvid invalid` | Wrong `Uvid-Hint` shape — **or HTTP/1.1 instead of HTTP/2** |
| `invalid_scope` | Requested scope not in the app's Selected OAuth Scopes |
| `guest flow not enabled` | Guest-users checkbox off (often cleared by toggling the other flow) |
| `You can't access this account` | Buyer is missing the preconfigured **`Buyer`** permission set |
| `WEBSTORE_NOT_FOUND` | Guest/buyer group not assigned to the store, or no entitlement policy |
| `PRICE_NOT_FOUND` | Price book has no `PricebookEntry` for the product |

---

## 8. Verified working

Against the live org in **`guest_user` mode** — the preferred configuration,
running as the Experience Cloud guest user:

| Route | Result |
|---|---|
| `/` | 200, category nav renders |
| `/c/products` | 200, 18 products |
| `/p/genwatt-diesel-200kw` | 200, title, canonical, `index, follow` |
| `/p/does-not-exist` | **404** — real status, not a soft 404 |
| `/robots.txt` | 200, `text/plain` |
| `/sitemap.xml` | 200, 20 URLs |

`view-source` shows fully rendered product HTML, JSON-LD `BreadcrumbList` and
`Product`, and an absolute canonical — i.e. SSR is genuinely working, which is
the precondition for everything in the SEO layer.

`offers` is emitted only for generic **list** pricing. A signed-in buyer's
contract price is deliberately never published — see
[architecture.md](./architecture.md#the-b2b-pricing-rule).

Buyer login is verified too: authorize → token (**with** `refresh_token`) →
userinfo → catalog → account-scoped pricing.

`client_credentials` mode also works with an admin Run-As user, but it is not
the recommended configuration: anonymous visitors inherit that user's catalog
visibility, and pricing 403s because an internal user is not a buyer.
