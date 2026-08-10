import type { Image } from "./common"

export interface CategorySummary {
	id: string
	/** URL segment used by `/c/$slug`. */
	slug: string
	name: string
	description?: string
	image?: Image
	productCount?: number
}

export interface Category extends CategorySummary {
	children: Array<CategorySummary>
	/** Root-first ancestor chain, excluding this category. Drives breadcrumbs. */
	path: Array<CategorySummary>
}
