import { webstoreBase } from "../config"
import { request } from "../http"
import type { Paged } from "../types/common"
import type { ProductSummary, SearchFacet } from "../types/product"
import { getProductPrices } from "./pricing"
import { mapProductSummary, type RawProduct } from "./products"

/**
 * Product search — the engine behind both the PLP and the search page.
 *
 * Endpoint: POST /search/product-search
 *
 * Results are account-scoped: two buyers searching the same term can legitimately
 * see different products, because entitlement policies filter the catalog. This
 * is why search responses must never be cached across sessions.
 */

export interface ProductSearchParams {
	term?: string
	categoryId?: string
	page?: number
	pageSize?: number
	/** `facetId -> selected value ids` */
	refinements?: Record<string, Array<string>>
	sortRuleId?: string
	/** Skip the batch pricing call — used by the sitemap, which needs no prices. */
	withPrices?: boolean
}

interface RawFacet {
	id?: string
	nameOrId?: string
	displayName?: string
	values?: Array<{
		id?: string
		nameOrId?: string
		displayName?: string
		productCount?: number
	}>
}

interface RawSearchResponse {
	productsPage?: {
		products?: Array<RawProduct>
		total?: number
		currentPage?: number
		pageSize?: number
	}
	facets?: Array<RawFacet>
	total?: number
}

export const DEFAULT_PAGE_SIZE = 24

function mapFacets(raw: Array<RawFacet> | undefined): Array<SearchFacet> {
	return (raw ?? [])
		.map((facet) => {
			const id = facet.id ?? facet.nameOrId ?? ""
			return {
				id,
				label: facet.displayName ?? facet.nameOrId ?? id,
				values: (facet.values ?? [])
					.map((value) => ({
						id: value.id ?? value.nameOrId ?? "",
						label: value.displayName ?? value.nameOrId ?? "",
						count: value.productCount ?? 0,
					}))
					.filter((v) => v.id),
			}
		})
		.filter((f) => f.id && f.values.length > 0)
}

export async function searchProducts(
	params: ProductSearchParams,
	opts: { signal?: AbortSignal } = {},
): Promise<Paged<ProductSummary> & { facets: Array<SearchFacet> }> {
	const page = Math.max(1, params.page ?? 1)
	const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE

	const refinements = Object.entries(params.refinements ?? {})
		.filter(([, values]) => values.length > 0)
		.map(([nameOrId, values]) => ({
			nameOrId,
			type: "Distinct" as const,
			values,
		}))

	const response = await request<RawSearchResponse>(
		`${webstoreBase()}/search/product-search`,
		{
			method: "POST",
			scopeToAccount: true,
			signal: opts.signal,
			body: {
				searchTerm: params.term || undefined,
				categoryId: params.categoryId || undefined,
				// Connect REST pages are zero-indexed; our URLs are one-indexed.
				page: page - 1,
				pageSize,
				includePrices: false,
				...(refinements.length > 0 ? { refinements } : {}),
				...(params.sortRuleId ? { sortRuleId: params.sortRuleId } : {}),
			},
		},
	)

	const rawProducts = response.productsPage?.products ?? []
	const items = rawProducts.map(mapProductSummary).filter((p) => p.id)
	const total = response.productsPage?.total ?? response.total ?? items.length

	if (params.withPrices !== false && items.length > 0) {
		// One batch call for the whole grid rather than one per tile. A pricing
		// failure degrades to "no price shown" instead of failing the page.
		const prices = await getProductPrices(
			items.map((p) => p.id),
			opts,
		).catch(() => new Map())

		for (const item of items) {
			item.price = prices.get(item.id)
		}
	}

	return {
		items,
		total,
		page,
		pageSize,
		hasMore: page * pageSize < total,
		facets: mapFacets(response.facets),
	}
}

/** Products within a category, the PLP's primary query. */
export function listCategoryProducts(
	categoryId: string,
	params: Omit<ProductSearchParams, "categoryId"> = {},
	opts: { signal?: AbortSignal } = {},
) {
	return searchProducts({ ...params, categoryId }, opts)
}
