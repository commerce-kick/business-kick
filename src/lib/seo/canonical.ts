/**
 * Canonical URL resolution.
 *
 * This module is deliberately **isomorphic**. Route `head()` functions run on
 * the server during SSR *and* on the client during navigation, so canonical
 * resolution cannot reach for `process.env` — it reads the Vite-exposed public
 * origin instead, which is why the variable is named `VITE_PUBLIC_SITE_URL`.
 *
 * The origin is read from configuration rather than the incoming request on
 * purpose: deriving it from the request host means preview deployments emit
 * canonicals pointing at themselves, which is a reliable way to get a staging
 * domain indexed in place of production.
 */

const FALLBACK_ORIGIN = "http://localhost:3000"

export function siteOrigin(): string {
	const configured = import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined
	return (configured || FALLBACK_ORIGIN).replace(/\/+$/, "")
}

/** Absolute URL for a path, for canonicals, OG tags and sitemap entries. */
export function absoluteUrl(path: string): string {
	if (/^https?:\/\//i.test(path)) return path
	return `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * Build a canonical URL, keeping only the search params that genuinely define
 * a distinct page.
 *
 * Pagination is a distinct page and must be kept; sort order and facet
 * refinements are views of the same set and are dropped, so filtered variants
 * consolidate onto one canonical rather than competing with each other.
 */
export function canonicalFor(
	path: string,
	search: Record<string, unknown> = {},
	keep: Array<string> = ["page"],
): string {
	const url = new URL(absoluteUrl(path))

	for (const key of keep) {
		const value = search[key]
		if (value === undefined || value === null || value === "") continue
		// Page 1 is the bare URL, not `?page=1` — otherwise the same content is
		// reachable under two canonicals.
		if (key === "page" && Number(value) <= 1) continue
		url.searchParams.set(key, String(value))
	}

	return url.toString()
}
