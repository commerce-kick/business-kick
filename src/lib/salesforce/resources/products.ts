import { isPlaceholderImage, mediaUrl, webstoreBase } from "../config"
import { SalesforceNotFoundError } from "../errors"
import { request } from "../http"
import {
	looksLikeSalesforceId,
	lookupIdBySlug,
	rememberSlug,
	resolveSlug,
	slugToSearchTerm,
} from "../slug"
import type { Image } from "../types/common"
import type {
	Product,
	ProductAvailability,
	ProductSummary,
} from "../types/product"
import { getProductPrice } from "./pricing"
import { searchProducts } from "./search"

/**
 * Products.
 *
 * Endpoints:
 *   GET /products/{productId}
 *   GET /products?ids=a,b,c
 */

interface RawMedia {
	url?: string
	alternateText?: string
	title?: string
	mediaType?: string
}

export interface RawProduct {
	id?: string
	name?: string
	fields?: Record<string, unknown>
	productClass?: string
	defaultImage?: RawMedia
	mediaGroups?: Array<{ mediaItems?: Array<RawMedia> }>
	purchaseQuantityRule?: {
		minimum?: string | number
		increment?: string | number
	}
	variationAttributeSet?: {
		attributes?: Record<string, { label?: string; value?: string }>
	}
	primaryProductCategoryPath?: {
		path?: Array<{ id?: string; name?: string }>
	}
}

const fieldValue = (
	fields: Record<string, unknown> | undefined,
	name: string,
): string | undefined => {
	const raw = fields?.[name]
	if (typeof raw === "string") return raw || undefined
	if (raw && typeof raw === "object" && "value" in raw) {
		const value = (raw as { value?: unknown }).value
		if (typeof value === "string") return value || undefined
		if (typeof value === "number") return String(value)
	}
	return undefined
}

const toNumber = (value: unknown, fallback: number): number => {
	const n =
		typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
	return Number.isFinite(n) && n > 0 ? n : fallback
}

function mapImage(media: RawMedia | undefined, alt: string): Image | undefined {
	const url = mediaUrl(media?.url)
	if (!url) return undefined
	return {
		url,
		alt: media?.alternateText ?? alt,
		title: media?.title,
		isPlaceholder: isPlaceholderImage(media?.url),
	}
}

function mapAvailability(raw: RawProduct): ProductAvailability {
	// Inventory is not returned by the product endpoint on every org config;
	// "unknown" is honest and keeps it out of structured data.
	const stock = fieldValue(raw.fields, "StockKeepingUnit")
	void stock
	return "unknown"
}

export function mapProductSummary(raw: RawProduct): ProductSummary {
	const id = raw.id ?? ""
	const name = raw.name ?? fieldValue(raw.fields, "Name") ?? ""
	const slug = resolveSlug(raw as Record<string, unknown>, name, id)

	if (id) rememberSlug("product", id, slug)

	return {
		id,
		slug,
		name,
		sku: fieldValue(raw.fields, "StockKeepingUnit"),
		image: mapImage(raw.defaultImage, name),
		availability: mapAvailability(raw),
	}
}

function mapProduct(raw: RawProduct): Product {
	const summary = mapProductSummary(raw)

	const gallery = (raw.mediaGroups ?? [])
		.flatMap((group) => group.mediaItems ?? [])
		.map((item) => mapImage(item, summary.name))
		.filter((img): img is Image => Boolean(img))

	const images = summary.image
		? [summary.image, ...gallery.filter((i) => i.url !== summary.image?.url)]
		: gallery

	const attributes = Object.values(raw.variationAttributeSet?.attributes ?? {})
		.filter((attr) => attr.label && attr.value)
		.map((attr) => ({
			label: attr.label as string,
			value: attr.value as string,
		}))

	const categoryPath = (raw.primaryProductCategoryPath?.path ?? [])
		.filter((c) => c.id && c.name)
		.map((c) => ({
			id: c.id as string,
			name: c.name as string,
			slug: resolveSlug(
				c as Record<string, unknown>,
				c.name as string,
				c.id as string,
			),
		}))

	return {
		...summary,
		description:
			fieldValue(raw.fields, "Description") ??
			fieldValue(raw.fields, "ShortDescription"),
		images,
		attributes,
		categoryPath,
		minimumQuantity: toNumber(raw.purchaseQuantityRule?.minimum, 1),
		quantityIncrement: toNumber(raw.purchaseQuantityRule?.increment, 1),
		unitOfMeasure: fieldValue(raw.fields, "QuantityUnitOfMeasure"),
	}
}

export async function getProduct(
	productId: string,
	opts: { signal?: AbortSignal; withPrice?: boolean } = {},
): Promise<Product> {
	const raw = await request<RawProduct>(
		`${webstoreBase()}/products/${encodeURIComponent(productId)}`,
		{ scopeToAccount: true, signal: opts.signal },
	)

	if (!raw?.id) {
		throw new SalesforceNotFoundError(
			`No product found for id "${productId}".`,
			{ status: 404, errorCode: "ITEM_NOT_FOUND" },
		)
	}

	const product = mapProduct(raw)

	if (opts.withPrice !== false) {
		// A pricing failure must not take down the whole PDP — the page is still
		// useful (and still indexable) without a number on it.
		product.price = await getProductPrice(product.id, {
			signal: opts.signal,
		}).catch(() => undefined)
	}

	return product
}

/**
 * Resolve `/p/$slug` to a product.
 *
 * Cache hit → direct fetch. Cache miss → search using the de-slugified term,
 * then confirm by re-slugifying the candidate's own name, so a fuzzy search
 * match can never silently serve the wrong product under a given URL.
 */
export async function getProductBySlug(
	slug: string,
	opts: { signal?: AbortSignal } = {},
): Promise<Product> {
	if (looksLikeSalesforceId(slug)) {
		return getProduct(slug, opts)
	}

	const cached = lookupIdBySlug("product", slug)
	if (cached) return getProduct(cached, opts)

	const results = await searchProducts(
		{ term: slugToSearchTerm(slug), pageSize: 25 },
		opts,
	)
	const match = results.items.find((p) => p.slug === slug)

	if (!match) {
		throw new SalesforceNotFoundError(
			`No product matches the slug "${slug}".`,
			{ status: 404, errorCode: "ITEM_NOT_FOUND" },
		)
	}

	return getProduct(match.id, opts)
}
