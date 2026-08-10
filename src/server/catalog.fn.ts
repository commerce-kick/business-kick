import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { isNotFound } from "#/lib/salesforce/errors"
import {
	getCategoryBySlug,
	listRootCategories,
} from "#/lib/salesforce/resources/categories"
import { getProductBySlug } from "#/lib/salesforce/resources/products"
import {
	listCategoryProducts,
	searchProducts,
} from "#/lib/salesforce/resources/search"

/**
 * Catalog server functions.
 *
 * Note the `null`-on-missing convention rather than thrown errors. Custom error
 * classes do not survive the serialization boundary between the server function
 * and a client-side navigation, so "not found" is modelled as data. Loaders turn
 * that `null` into `notFound()`, which is what produces a real 404 status —
 * and a 404 status is the difference between a crawler dropping a dead URL and
 * indexing an empty page.
 */

/**
 * Shared search-param contract for the PLP and the search page.
 *
 * Every field is `.optional()`, never `.default()`, and that is a deliberate
 * SEO decision rather than a style preference.
 *
 * TanStack Router rewrites the URL whenever `validateSearch` produces a value
 * the URL did not carry. A `.default(1)` on `page` therefore makes `/c/bolts`
 * 307-redirect to `/c/bolts?page=1` — while `canonicalFor()` deliberately
 * strips `page=1` to keep one canonical per page. The result is a canonical
 * that points at a URL which immediately redirects elsewhere, which is exactly
 * the kind of contradictory signal that costs a page its ranking.
 *
 * Keeping them optional means clean URLs stay clean. Defaults are applied at
 * the point of use (`search.page ?? 1`), where they affect data and not the URL.
 *
 * `.catch(undefined)` still absorbs a garbage value from a hand-edited URL
 * instead of throwing mid-render.
 */
export const catalogSearchSchema = z.object({
	page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
	sort: z.string().optional().catch(undefined),
	q: z.string().optional().catch(undefined),
	/** `facetId:valueId` pairs, repeatable. */
	refine: z.array(z.string()).optional().catch(undefined),
})

export type CatalogSearchParams = z.infer<typeof catalogSearchSchema>

/** Turn `["color:red","color:blue"]` into `{ color: ["red","blue"] }`. */
function parseRefinements(
	refine: Array<string> | undefined,
): Record<string, Array<string>> {
	const result: Record<string, Array<string>> = {}
	for (const entry of refine ?? []) {
		const separator = entry.indexOf(":")
		if (separator <= 0) continue
		const facet = entry.slice(0, separator)
		const value = entry.slice(separator + 1)
		if (!value) continue
		const bucket = result[facet] ?? []
		bucket.push(value)
		result[facet] = bucket
	}
	return result
}

export const getRootCategoriesFn = createServerFn({ method: "GET" }).handler(
	async () => {
		// Header navigation must never take down the page it decorates.
		return listRootCategories().catch(() => [])
	},
)

export const getCategoryPageFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			slug: z.string().min(1),
			page: z.number().int().min(1).default(1),
			sort: z.string().optional(),
			refine: z.array(z.string()).optional(),
		}),
	)
	.handler(async ({ data }) => {
		try {
			const category = await getCategoryBySlug(data.slug)

			const products = await listCategoryProducts(category.id, {
				page: data.page,
				sortRuleId: data.sort,
				refinements: parseRefinements(data.refine),
			})

			return { category, products }
		} catch (error) {
			if (isNotFound(error)) return null
			throw error
		}
	})

export const getProductPageFn = createServerFn({ method: "GET" })
	.validator(z.object({ slug: z.string().min(1) }))
	.handler(async ({ data }) => {
		try {
			return await getProductBySlug(data.slug)
		} catch (error) {
			if (isNotFound(error)) return null
			throw error
		}
	})

export const searchProductsFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			q: z.string().default(""),
			page: z.number().int().min(1).default(1),
			sort: z.string().optional(),
			refine: z.array(z.string()).optional(),
		}),
	)
	.handler(async ({ data }) => {
		if (!data.q.trim()) {
			return {
				items: [],
				total: 0,
				page: 1,
				pageSize: 0,
				hasMore: false,
				facets: [],
			}
		}

		return searchProducts({
			term: data.q,
			page: data.page,
			sortRuleId: data.sort,
			refinements: parseRefinements(data.refine),
		})
	})
