# Architecture

A headless Salesforce B2B Commerce storefront on TanStack Start.

Two systems carry the weight: a **typed server-only SDK** and an **SEO layer**.
Everything else is pages sitting on top of them.

---

## Stack

TanStack Start 1.168 (stable) · React 19.2 · Vite 8 · TypeScript 6 ·
Nitro 3 (beta) · TanStack Query (SSR-integrated) · Tailwind v4 ·
shadcn `base-nova` on **Base UI** (not Radix) · zod 4 · Biome · bun

Import alias is `#/*` → `./src/*`.

---

## Three rules

1. **The SDK is server-only.** Access tokens are httpOnly and the client secret
   lives in this process. Nothing under `lib/salesforce/` may be imported from a
   module that reaches the browser; the only sanctioned path is a
   `createServerFn` boundary in `src/server/`. Route loaders run on the server
   during SSR and call server functions during client navigation, so loaders
   work identically in both and the browser only ever sees plain JSON.

2. **Salesforce shapes never leak into components.** Every resource module maps
   raw Connect REST payloads to domain types we own. This is the seam that keeps
   an API version bump — or a field rename in the org — from cascading into UI
   files. It has already paid for itself: the category response shape differed
   from the docs in four ways and only one file changed.

3. **SEO is a module, not a per-route habit.** One `seo()` helper and a set of
   JSON-LD builders, so no route hand-writes meta tags and no route can silently
   forget `noindex`.

---

## Layout

```
src/
  lib/
    env.server.ts             zod-validated env, fails loudly with named vars
    format.ts                 isomorphic money/date (locale pinned — see below)
    salesforce/               ── SERVER ONLY ──
      config.ts               API_VERSION, base URLs, host selection
      instance.ts             API host discovered from token responses
      errors.ts               typed error taxonomy
      log.ts                  redacting logger + error→fix explainer
      fetch.ts                HTTP/2 dispatcher for identity calls
      http.ts                 the single fetch call site
      slug.ts                 slug ↔ Id resolution + bounded cache
      auth/  tokens · headless · session
      resources/  products · search · categories · pricing · cart · orders · account
      types/  common · product · category · cart · account
    seo/
      seo.ts                  seo() → { meta, links }; indexing is opt-in
      jsonld.ts               Product / BreadcrumbList / ItemList / Organization
      canonical.ts            isomorphic canonical resolution
    query/
      keys.ts                 hierarchical query key factory
      catalog.ts              queryOptions shared by loaders + components
  server/
    auth.fn.ts                login / register / forgot / logout / session
    catalog.fn.ts             category / product / search
  components/
    layout/ · catalog/ · auth/ · ui/ (shadcn)
  routes/                     see below
```

---

## The SDK

### Transport (`http.ts`)

One `request()` is the only place `fetch` is called against Salesforce.
Centralising it is what makes token injection, the 401 dance, retry policy and
error mapping consistent rather than reimplemented per resource.

- Injects the buyer token when a session cookie exists, the shared guest token
  otherwise.
- Appends `effectiveAccountId` to account-scoped calls — the B2B pivot.
- Retries idempotent GETs on 5xx/429/network with capped backoff. Never retries
  mutations.
- **401/403 → re-authenticate once → replay once.** Never loops.

Two caching decisions that are easy to get wrong:

**Guest token is a process-wide singleton**, held in memory with its expiry and
refreshed ~60s early. It is never written to a cookie — it is an *application*
credential, not a user credential.

**Refresh is stampede-guarded** by an in-flight `Map` keyed on the refresh
token. A single SSR render fans out several loader calls; without the guard they
all see 401 together and each POSTs a refresh. Since Salesforce rotates refresh
tokens, the first response invalidates the token the others are still using and
the buyer is logged out mid-render.

### Errors (`errors.ts`)

`SalesforceApiError` + `SalesforceAuthError` / `NotFound` / `Validation` /
`RateLimit` / `Network`.

Salesforce is inconsistent about status codes — a missing product can arrive as
a 400 carrying `ITEM_NOT_FOUND` — so the body's `errorCode` is consulted before
the status.

Each error carries a stable string `code`. **Class identity does not survive the
server-function serialization boundary**, so client-side branching uses
`errorCodeOf()`, never `instanceof`. For the same reason, catalog server
functions return `null` for "not found" rather than throwing — loaders convert
that to `notFound()`, which is what produces a real 404 status.

### Logging (`log.ts`)

`SF_DEBUG=1` enables request/timing/token detail; errors always log. Tokens,
secrets and passwords are redacted to `first4…last4 (len N)` — enough to
correlate, never enough to use.

`explainAuthError()` maps eleven distinct Salesforce misconfigurations to the
exact admin action and prints it next to the raw error. See
[salesforce-setup.md §7](./salesforce-setup.md#7-error-reference). This is the
most reusable artefact in the codebase — most of these errors name the wrong
cause.

---

## Auth

| Cookie | Contents |
|---|---|
| `sf_at` | access token |
| `sf_rt` | refresh token |
| `sf_ea` | effectiveAccountId |
| `sf_u`  | base64url session projection |

All httpOnly, `SameSite=Lax`, `Secure` outside dev. The client never reads auth
state from cookies — session reaches the UI through **router context**, resolved
once in the root `beforeLoad`. No waterfall, no flash of signed-out chrome.

`_authed.tsx` guards only genuinely private routes; guests browse the catalog.
The `?redirect=` target is re-validated server-side against same-origin paths,
so it cannot become an open redirect on a page users just typed a password into.

Sign-in and sign-out both call `queryClient.clear()` — cached guest-priced
catalog data is wrong for an authenticated buyer, which is the whole point of
B2B.

---

## Routes

```
/                      home            indexed
/c/$slug               PLP    SSR      indexed · ItemList + Breadcrumb JSON-LD
/p/$slug               PDP    SSR      indexed · Product + Breadcrumb JSON-LD
/search                                noindex (thin/duplicate)
/login /register /forgot-password      noindex
/cart                  stub            noindex
/_authed/account                       noindex
/robots.txt  /sitemap.xml              server routes
```

`beforeLoad` is for session and guards only. Catalog data uses `loader` +
`ensureQueryData`, and components call `useSuspenseQuery` with the *same*
`queryOptions` object — one definition, so SSR data is reused rather than
refetched on hydration.

### Search params are `.optional()`, never `.default()`

Not a style preference. TanStack Router rewrites the URL whenever
`validateSearch` produces a value the URL didn't carry, so `.default(1)` on
`page` makes `/c/bolts` **307 → `/c/bolts?page=1`** — while `canonicalFor()`
strips `page=1` to keep one canonical per page. The result is a canonical
pointing at a URL that immediately redirects elsewhere.

Defaults are applied at the point of use (`search.page ?? 1`), where they affect
data and not the URL. `.catch(undefined)` still absorbs garbage from a
hand-edited URL.

---

## SEO

### Indexing is opt-in

`seo()` emits `noindex, nofollow` unless a route passes `index: true`. A gated
or thin page that leaks into the index costs crawl budget and dilutes the pages
that matter, so a forgotten flag fails safe.

### Canonicals are isomorphic

`head()` runs on the server *and* the client, so canonical resolution can't
reach for `process.env` — hence `VITE_PUBLIC_SITE_URL`. The origin comes from
config rather than the request host on purpose: deriving it from the request
means preview deploys emit canonicals pointing at themselves, which is a
reliable way to get a staging domain indexed instead of production.

Pagination is kept in the canonical; sort and facets are dropped, so filtered
views consolidate rather than compete.

### The B2B pricing rule

`productJsonLd()` emits `offers.price` **only** when the price came from generic
list pricing (`origin === "list"`).

In B2B the same SKU carries a different price per buyer account, set by
contract. Publishing a signed-in buyer's negotiated price into structured data
would tell a crawler something untrue for everyone else — earning a
Merchant-listing mismatch penalty — and disclose that account's commercial terms
to anyone viewing source. Enforced inside the builder so no route can get it
wrong, including routes written later by someone who never read this.

JSON-LD is serialized with `<` escaped: catalog copy containing `</script>`
would otherwise close the tag early and inject markup.

### sitemap.xml

Built with the **guest** token — it must describe the catalog a crawler can see,
not a buyer's entitlement-filtered view. Cached with an in-flight guard so
concurrent crawler hits trigger one catalog walk. Coverage caps `log.warn()`
when they truncate: a silently truncated sitemap looks identical to a complete
one, which is how half a catalog goes un-indexed unnoticed.

---

## Smaller decisions worth knowing

- **`format.ts` pins `en-US`.** A locale that differs between server and client
  trips React's hydration check. Swap for a request-derived locale only once
  it's threaded to both sides.
- **`biome.json` uses `semicolons: "asNeeded"`.** The shipped default disagreed
  with 100% of the repo including untouched shadcn components.
- **Buttons rendering `<Link>` pass `nativeButton={false}`.** Base UI expects a
  real `<button>` by default; these render anchors.
- **`slug.ts` caches both directions** with a TTL and a hard entry cap, so a
  crawler walking a large catalog can't grow it unboundedly.

---

## Verification

```bash
bun run typecheck     # tsc --noEmit
bun run check         # biome
bun run build
SF_DEBUG=1 bun run dev
```

Then confirm SSR is real — this is the precondition for the entire SEO layer:

```bash
curl -s localhost:3000/c/products | grep -c 'href="/p/'   # > 0
curl -s -o /dev/null -w '%{http_code}' localhost:3000/p/nope   # 404, not 200
```

`view-source` on a PDP should show fully rendered HTML, an absolute canonical,
and JSON-LD — not an empty shell.

---

## Not built yet

Cart and checkout UI (SDK resources are complete and typed), order history view,
account switching for multi-account buyers, and `hreflang` (the SEO layer is
structured for it but no locales are configured).

Current blocker for guest browsing is org configuration, not code — see
[salesforce-setup.md §4](./salesforce-setup.md#4-guest-identity--guest_user-mode-preferred).
