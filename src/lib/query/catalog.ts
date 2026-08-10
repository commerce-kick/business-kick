import { queryOptions } from "@tanstack/react-query"

import {
	getCategoryPageFn,
	getProductPageFn,
	getRootCategoriesFn,
	searchProductsFn,
} from "#/server/catalog.fn"

import { queryKeys } from "./keys"

/**
 * `queryOptions` factories shared by route loaders and components.
 *
 * A loader calls `ensureQueryData(...)` with one of these and the component
 * calls `useSuspenseQuery(...)` with the *same* object. That is what stops the
 * client re-fetching on hydration what SSR already delivered — and it only
 * holds because both sides read one definition rather than two that drift.
 */

export const rootCategoriesQuery = () =>
	queryOptions({
		queryKey: queryKeys.catalog.rootCategories(),
		queryFn: () => getRootCategoriesFn(),
		// Navigation changes rarely; this is safe to hold across a session.
		staleTime: 10 * 60_000,
	})

export interface CategoryPageParams {
	slug: string
	page: number
	sort?: string
	refine?: Array<string>
}

export const categoryPageQuery = (params: CategoryPageParams) =>
	queryOptions({
		queryKey: queryKeys.catalog.category(params.slug, {
			page: params.page,
			sort: params.sort,
			refine: params.refine,
		}),
		queryFn: () => getCategoryPageFn({ data: params }),
	})

export const productPageQuery = (slug: string) =>
	queryOptions({
		queryKey: queryKeys.catalog.product(slug),
		queryFn: () => getProductPageFn({ data: { slug } }),
	})

export interface SearchParams {
	q: string
	page: number
	sort?: string
	refine?: Array<string>
}

export const searchQuery = (params: SearchParams) =>
	queryOptions({
		queryKey: queryKeys.catalog.search({ ...params }),
		queryFn: () => searchProductsFn({ data: params }),
	})
