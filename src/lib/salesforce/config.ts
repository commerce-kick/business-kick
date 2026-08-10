import { getEnv } from "#/lib/env.server"
import { getDiscoveredInstanceUrl } from "./instance"

/**
 * URL construction for the Connect REST API and the Identity endpoints.
 *
 * Two different hosts are in play and mixing them up is the single most common
 * setup mistake:
 *
 *   - Commerce data  → the org host        (SF_INSTANCE_URL)
 *   - Identity/OAuth → the Experience site (SF_EXPERIENCE_SITE_URL)
 *
 * Headless login must be issued against the Experience Cloud site, because that
 * is what scopes the resulting token to the store's buyer context.
 */

const trimSlash = (s: string) => s.replace(/\/+$/, "")

/**
 * The host to issue Data API calls against.
 *
 * Prefers the `instance_url` discovered from a token response over the
 * configured value — Salesforce is authoritative about where its own tokens are
 * valid, and `SF_INSTANCE_URL` is easy to get subtly wrong.
 */
export function instanceUrl(): string {
	const env = getEnv()

	// Guest tokens are JWTs issued *by the Experience Cloud site*, and they are
	// only valid against it. Sent to the org host they are rejected with
	// `INVALID_ISS` — the issuer in the JWT does not match. Confirmed live:
	//
	//   org host  → 401 INVALID_ISS / INVALID_AUTH_HEADER
	//   site host → authenticates
	//
	// Client-credentials tokens behave the opposite way: they report an
	// `instance_url` pointing at the org host and work there. So the correct
	// base genuinely depends on which guest mode is active.
	if (env.SF_GUEST_MODE === "guest_user") {
		return identityBase()
	}

	return getDiscoveredInstanceUrl() ?? trimSlash(env.SF_INSTANCE_URL)
}

/** `{instance}/services/data/{version}` */
export function dataApiBase(): string {
	return `${instanceUrl()}/services/data/${getEnv().SF_API_VERSION}`
}

/** `{instance}/services/data/{version}/commerce/webstores/{webstoreId}` */
export function webstoreBase(): string {
	return `${dataApiBase()}/commerce/webstores/${getEnv().SF_WEBSTORE_ID}`
}

/** `{instance}/services/data/{version}/commerce` — store-agnostic commerce. */
export function commerceBase(): string {
	return `${dataApiBase()}/commerce`
}

/** Experience Cloud site origin — the Identity host. */
export function identityBase(): string {
	return trimSlash(getEnv().SF_EXPERIENCE_SITE_URL)
}

export const oauth = {
	authorize: () => `${identityBase()}/services/oauth2/authorize`,
	token: () => `${identityBase()}/services/oauth2/token`,
	revoke: () => `${identityBase()}/services/oauth2/revoke`,
	userinfo: () => `${identityBase()}/services/oauth2/userinfo`,
	/** Headless Identity API root. */
	headless: (path: string) =>
		`${identityBase()}/services/auth/headless/${path.replace(/^\/+/, "")}`,
}

/**
 * Resolve a media URL returned by Connect REST.
 *
 * Salesforce returns product and category images as **site-relative** paths
 * (e.g. `/img/b2b/default-product-image.svg`). Rendered as-is they resolve
 * against *our* origin and 404. Worse for SEO: `absoluteUrl()` in the JSON-LD
 * builder would happily prefix them with our own host and publish image URLs
 * that don't exist.
 *
 * Resolving at the SDK boundary means everything downstream — components,
 * OG tags, JSON-LD — receives an absolute URL and needs no special handling.
 */
export function mediaUrl(url: string | undefined | null): string | undefined {
	if (!url) return undefined
	if (/^https?:\/\//i.test(url)) return url
	if (url.startsWith("//")) return `https:${url}`

	// Salesforce's stock placeholder is swapped for our own local asset: it is
	// not product content, so there is no reason to make every image-less tile
	// a cross-origin request to the org. Note we return OUR path rather than
	// echoing theirs — the two directories differ (`/img/b2b/…` upstream vs
	// `/img/…` in `public/`), and passing theirs through would 404 locally.
	if (isPlaceholderImage(url)) return LOCAL_PLACEHOLDER

	return `${identityBase()}${url.startsWith("/") ? url : `/${url}`}`
}

/**
 * Salesforce's generic "no image" asset.
 *
 * Worth identifying rather than treating as a normal image: it must not be
 * published as `Product.image` or `og:image`, where it would assert that a
 * placeholder is the product's photograph. `jsonld.ts` filters on this.
 *
 * Matched on **filename**, not full path, deliberately. Salesforce serves it
 * from `/img/b2b/…` on a B2B store, but the directory varies by store type and
 * release. An exact-path check stops matching when that changes, and the
 * failure is quiet — the placeholder simply resumes loading cross-origin from
 * the org, which looks fine until it turns up in `og:image`.
 */
const PLACEHOLDER_FILENAMES = ["default-product-image.svg"]

/** Our own placeholder, served from `public/`. Keep in sync with that file. */
const LOCAL_PLACEHOLDER = "/img/default-product-image.svg"

export function isPlaceholderImage(url: string | undefined | null): boolean {
	if (!url) return false
	const filename = url.split("?")[0].split("/").pop()?.toLowerCase()
	return filename ? PLACEHOLDER_FILENAMES.includes(filename) : false
}

/** Public origin used for canonicals, OG tags and sitemap URLs. */
export function siteUrl(): string {
	return trimSlash(getEnv().VITE_PUBLIC_SITE_URL)
}

export function absoluteUrl(path: string): string {
	return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`
}
