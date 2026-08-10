# Meridian docs

Headless Salesforce B2B Commerce storefront on TanStack Start.

| Doc | Read it when |
|---|---|
| [architecture.md](./architecture.md) | Working on the code. How the SDK, auth and SEO layers fit together, and why the non-obvious decisions were made that way. |
| [salesforce-setup.md](./salesforce-setup.md) | Configuring the org, or an API call is failing. Verified wire formats, the full setup chain, and an error → fix table. |

## Quick start

```bash
bun install
cp .env.example .env     # fill in — see salesforce-setup.md §1
SF_DEBUG=1 bun run dev
```

`SF_DEBUG=1` logs every Salesforce request with timing, and prints the specific
admin action for known misconfigurations. Turn it on for any setup work — most
Salesforce auth errors name the wrong cause.

## Current state

Working end to end against a live org in `SF_GUEST_MODE=guest_user` — the
preferred configuration, running as the Experience Cloud guest user:

| Route | Result |
|---|---|
| `/` | 200, category nav |
| `/c/products` | 200, **18 products** |
| `/p/genwatt-diesel-200kw` | 200, canonical, `index, follow`, Product + Breadcrumb JSON-LD |
| `/p/nope` | **404** — real status |
| `/robots.txt`, `/sitemap.xml` | 200, 20 URLs |

Buyer login works too — authorize → token with `refresh_token` → session
cookies → account-scoped pricing.

## Two things that will save you hours

**Salesforce's headless guest flow requires HTTP/2.** Node's `fetch` is
HTTP/1.1, and over 1.1 the token exchange fails with `uvid invalid` — blaming
the UVID for a transport problem. Handled in `lib/salesforce/fetch.ts`.

**Most Salesforce auth errors name the wrong cause.** `explainAuthError()` in
`lib/salesforce/log.ts` maps each known one to the actual fix and prints it
alongside the raw error. Add to it whenever a new one costs you time.

The worst offender: `You can't access this account` means the buyer is missing
Salesforce's preconfigured **`Buyer`** permission set — not that anything is
wrong with the account.
