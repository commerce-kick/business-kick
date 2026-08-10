import type { Image, Money } from "./common"

/**
 * Where a price came from.
 *
 * This is load-bearing for SEO, not bookkeeping. Only `list` pricing may be
 * emitted into JSON-LD: a `negotiated` price is specific to one buyer account
 * and publishing it to a crawler is both factually wrong and a commercial
 * disclosure. `jsonld.ts` enforces this; the flag is what it enforces against.
 */
export type PriceOrigin = "list" | "negotiated" | "unavailable"

export interface ProductPrice {
	listPrice: Money
	/** Account-specific price. Equals list price for guests. */
	negotiatedPrice: Money
	origin: PriceOrigin
}

export type ProductAvailability = "in_stock" | "out_of_stock" | "unknown"

export interface ProductSummary {
	id: string
	/** URL segment used by `/p/$slug`. */
	slug: string
	name: string
	sku?: string
	image?: Image
	price?: ProductPrice
	availability: ProductAvailability
}

export interface ProductVariationAttribute {
	label: string
	value: string
}

export interface Product extends ProductSummary {
	description?: string
	images: Array<Image>
	/** Display-ready spec sheet rows. */
	attributes: Array<ProductVariationAttribute>
	categoryPath: Array<{ id: string; slug: string; name: string }>
	/** Minimum order quantity — common in B2B, defaults to 1. */
	minimumQuantity: number
	quantityIncrement: number
	unitOfMeasure?: string
}

export interface SearchFacetValue {
	id: string
	label: string
	count: number
}

export interface SearchFacet {
	id: string
	label: string
	values: Array<SearchFacetValue>
}
