/**
 * Query key factory.
 *
 * One place that owns key shape, so invalidation can be reasoned about instead
 * of guessed at. Keys are hierarchical: invalidating `catalog.all()` clears
 * every catalog query, which is exactly what has to happen when a buyer signs
 * in or switches account and all pricing becomes stale at once.
 */

export const queryKeys = {
	session: {
		current: () => ["session"] as const,
	},
	catalog: {
		all: () => ["catalog"] as const,
		rootCategories: () => ["catalog", "root-categories"] as const,
		category: (slug: string, params: Record<string, unknown> = {}) =>
			["catalog", "category", slug, params] as const,
		product: (slug: string) => ["catalog", "product", slug] as const,
		search: (params: Record<string, unknown>) =>
			["catalog", "search", params] as const,
	},
	cart: {
		current: () => ["cart"] as const,
	},
	orders: {
		list: (page: number) => ["orders", page] as const,
	},
} as const
