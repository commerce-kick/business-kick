import { isPlaceholderImage, mediaUrl, webstoreBase } from "../config"
import { SalesforceNotFoundError } from "../errors"
import { request } from "../http"
import { log } from "../log"
import { looksLikeSalesforceId, rememberSlug, resolveSlug } from "../slug"

import type { Category, CategorySummary } from "../types/category"

/**
 * Product categories.
 *
 * ── Verified against a live org, because the documented shape did not hold ──
 *
 * Endpoint: GET /product-categories/children[?categoryId={id}]
 *
 * Three findings drove this implementation, all confirmed by probing:
 *
 *   1. Root categories come from `/product-categories/children` with **no**
 *      category Id. The path-segment form (`/product-categories/{id}/children`)
 *      returns 404.
 *
 *   2. `?categoryId=` is accepted but, in at least some org configurations,
 *      **ignored** — the response echoes the same top-level list back. Left
 *      unguarded that turns any tree walk into infinite recursion, so
 *      `listChildCategories` drops any entry whose id equals the id requested.
 *      Where the parameter does work, real children come back and the guard is
 *      a no-op.
 *
 *   3. `/product-category-paths/product-categories/{id}` returns 404 here.
 *      Ancestor paths are therefore derived from the tree walk rather than
 *      fetched, which also avoids a second round trip.
 *
 * Field placement is likewise not what the docs suggest: the display name is at
 * `fields.Name` (not a top-level `name`), while the slug is top-level
 * `urlName`. When `urlName` is null — common when the store has never had SEO
 * URLs configured — the slug is derived from the name.
 */

interface RawCategory {
	id?: string
	urlName?: string | null
	bannerImage?: { url?: string; alternateText?: string } | null
	tileImage?: { url?: string; alternateText?: string } | null
	fields?: Record<string, string | null>
}

interface RawChildrenResponse {
	productCategories?: Array<RawCategory>
}

function mapSummary(raw: RawCategory): CategorySummary {
	const id = raw.id ?? raw.fields?.Id ?? ""
	const name = raw.fields?.Name ?? ""
	const slug = resolveSlug(raw as Record<string, unknown>, name, id)

	if (id) rememberSlug("category", id, slug)

	const image = raw.tileImage ?? raw.bannerImage
	const resolvedImage = mediaUrl(image?.url)
	const count = raw.fields?.NumberOfProducts

	return {
		id,
		slug,
		name,
		description: raw.fields?.Description ?? undefined,
		productCount: count ? Number.parseInt(count, 10) : undefined,
		image: resolvedImage
			? {
					url: resolvedImage,
					alt: image?.alternateText ?? name,
					isPlaceholder: isPlaceholderImage(image?.url),
				}
			: undefined,
	}
}

async function fetchCategories(
	categoryId: string | undefined,
	signal?: AbortSignal,
): Promise<Array<CategorySummary>> {
	const response = await request<RawChildrenResponse>(
		`${webstoreBase()}/product-categories/children`,
		{
			scopeToAccount: true,
			signal,
			query: categoryId ? { categoryId } : undefined,
		},
	)

	return (response.productCategories ?? [])
		.map(mapSummary)
		.filter((c) => c.id && c.id !== categoryId)
}

/** Top-level categories. Used by the header nav, home page and sitemap. */
export function listRootCategories(
	opts: { signal?: AbortSignal } = {},
): Promise<Array<CategorySummary>> {
	return fetchCategories(undefined, opts.signal)
}

/** Direct children of a category. Empty when the category is a leaf. */
export function listChildCategories(
	categoryId: string,
	opts: { signal?: AbortSignal } = {},
): Promise<Array<CategorySummary>> {
	return fetchCategories(categoryId, opts.signal)
}

interface Located {
	category: CategorySummary
	/** Root-first ancestors, excluding the category itself. */
	path: Array<CategorySummary>
}

/**
 * Breadth-first walk from the root looking for a category.
 *
 * `match` decides what we are looking for, so slug and Id lookups share one
 * traversal. Depth is bounded, and visited ids are tracked, so a cyclic or
 * self-referential response cannot hang a request.
 */
async function locate(
	match: (category: CategorySummary) => boolean,
	signal: AbortSignal | undefined,
	maxDepth = 5,
): Promise<Located | undefined> {
	const seen = new Set<string>()
	let frontier: Array<Located> = (await listRootCategories({ signal })).map(
		(category) => ({ category, path: [] }),
	)

	for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
		const hit = frontier.find((entry) => match(entry.category))
		if (hit) return hit

		const next: Array<Located> = []
		for (const entry of frontier) {
			if (seen.has(entry.category.id)) continue
			seen.add(entry.category.id)

			const children = await listChildCategories(entry.category.id, {
				signal,
			}).catch(() => [])

			for (const child of children) {
				if (seen.has(child.id)) continue
				next.push({
					category: child,
					path: [...entry.path, entry.category],
				})
			}
		}
		frontier = next
	}

	return undefined
}

async function toCategory(
	found: Located,
	signal: AbortSignal | undefined,
): Promise<Category> {
	const children = await listChildCategories(found.category.id, {
		signal,
	}).catch(() => [])

	return { ...found.category, children, path: found.path }
}

export async function getCategory(
	categoryId: string,
	opts: { signal?: AbortSignal } = {},
): Promise<Category> {
	const found = await locate((c) => c.id === categoryId, opts.signal)

	if (!found) {
		throw new SalesforceNotFoundError(
			`No category found for id "${categoryId}".`,
			{ status: 404, errorCode: "ITEM_NOT_FOUND" },
		)
	}

	return toCategory(found, opts.signal)
}

/** Resolve `/c/$slug`. Accepts a raw record Id too, so deep links never 404. */
export async function getCategoryBySlug(
	slug: string,
	opts: { signal?: AbortSignal } = {},
): Promise<Category> {
	const found = await locate(
		(c) => (looksLikeSalesforceId(slug) ? c.id === slug : c.slug === slug),
		opts.signal,
	)

	if (!found) {
		log.warn(`no category matched slug "${slug}"`)
		throw new SalesforceNotFoundError(
			`No category matches the slug "${slug}".`,
			{ status: 404, errorCode: "ITEM_NOT_FOUND" },
		)
	}

	return toCategory(found, opts.signal)
}
