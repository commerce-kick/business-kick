import { absoluteUrl } from "./canonical"

/**
 * The single source of head metadata.
 *
 * No route hand-writes meta tags. That is not tidiness for its own sake — it is
 * what makes the indexing policy below enforceable in one place.
 */

export const SITE_NAME = "Meridian"
const DEFAULT_DESCRIPTION =
	"Industrial supply and B2B procurement, built for teams that order at scale."
const TITLE_LIMIT = 60
const DESCRIPTION_LIMIT = 155

export interface SeoInput {
	title?: string
	description?: string
	/** Absolute or root-relative image URL for OG/Twitter cards. */
	image?: string
	canonical?: string
	/**
	 * Opt **in** to indexing.
	 *
	 * The default is `noindex, nofollow`. A page that leaks into the index when
	 * it shouldn't — a cart, an account screen, a thin filtered view — actively
	 * costs crawl budget and dilutes the pages that matter. Failing safe means a
	 * forgotten flag suppresses a page rather than exposing one.
	 */
	index?: boolean
	type?: "website" | "article" | "product"
	/** Rendered verbatim when set, bypassing the "· Meridian" suffix. */
	titleOverride?: string
}

type MetaTag =
	| { title: string }
	| { name: string; content: string }
	| { property: string; content: string }

export interface SeoResult {
	meta: Array<MetaTag>
	links: Array<{ rel: string; href: string }>
}

function truncate(value: string, limit: number): string {
	if (value.length <= limit) return value
	// Cut on a word boundary so the ellipsis does not land mid-word.
	const cut = value.slice(0, limit - 1)
	const lastSpace = cut.lastIndexOf(" ")
	return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export function seo(input: SeoInput = {}): SeoResult {
	const title =
		input.titleOverride ??
		(input.title
			? truncate(`${input.title} · ${SITE_NAME}`, TITLE_LIMIT)
			: SITE_NAME)

	const description = truncate(
		input.description || DEFAULT_DESCRIPTION,
		DESCRIPTION_LIMIT,
	)

	const image = input.image ? absoluteUrl(input.image) : undefined
	const robots = input.index
		? "index, follow, max-image-preview:large, max-snippet:-1"
		: "noindex, nofollow"

	const meta: Array<MetaTag> = [
		{ title },
		{ name: "description", content: description },
		{ name: "robots", content: robots },

		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:type", content: input.type ?? "website" },
		{ property: "og:site_name", content: SITE_NAME },

		{
			name: "twitter:card",
			content: image ? "summary_large_image" : "summary",
		},
		{ name: "twitter:title", content: title },
		{ name: "twitter:description", content: description },
	]

	if (input.canonical) {
		meta.push({ property: "og:url", content: input.canonical })
	}
	if (image) {
		meta.push({ property: "og:image", content: image })
		meta.push({ name: "twitter:image", content: image })
	}

	const links = input.canonical
		? [{ rel: "canonical", href: input.canonical }]
		: []

	return { meta, links }
}

/** Convenience for the many routes that are public but must not be indexed. */
export const noindexSeo = (title: string, description?: string): SeoResult =>
	seo({ title, description, index: false })
