import type { CategorySummary } from "#/lib/salesforce/types/category"
import type { Product, ProductSummary } from "#/lib/salesforce/types/product"
import { absoluteUrl } from "./canonical"
import { SITE_NAME } from "./seo"

/**
 * JSON-LD builders.
 *
 * Injected through a route's `head()` as `scripts: [{ type:
 * "application/ld+json", children: jsonLdScript(...) }]`.
 */

type Json = Record<string, unknown>

/**
 * Serialize for embedding in a `<script>` tag.
 *
 * `<` is escaped because a product description containing `</script>` would
 * otherwise close the tag early and inject arbitrary markup into the page —
 * catalog copy is attacker-influenced content in exactly the way user input is.
 */
export function jsonLdScript(data: Json | Array<Json>): string {
	return JSON.stringify(data).replace(/</g, "\\u003c")
}

export function organizationJsonLd(): Json {
	return {
		"@context": "https://schema.org",
		"@type": "Organization",
		name: SITE_NAME,
		url: absoluteUrl("/"),
	}
}

export function websiteJsonLd(): Json {
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: SITE_NAME,
		url: absoluteUrl("/"),
		potentialAction: {
			"@type": "SearchAction",
			target: {
				"@type": "EntryPoint",
				urlTemplate: `${absoluteUrl("/search")}?q={search_term_string}`,
			},
			"query-input": "required name=search_term_string",
		},
	}
}

export function breadcrumbJsonLd(
	trail: Array<{ name: string; path: string }>,
): Json {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: trail.map((crumb, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: crumb.name,
			item: absoluteUrl(crumb.path),
		})),
	}
}

export function itemListJsonLd(
	products: Array<ProductSummary>,
	opts: { startPosition?: number } = {},
): Json {
	const start = opts.startPosition ?? 1
	return {
		"@context": "https://schema.org",
		"@type": "ItemList",
		numberOfItems: products.length,
		itemListElement: products.map((product, index) => ({
			"@type": "ListItem",
			position: start + index,
			url: absoluteUrl(`/p/${product.slug}`),
			name: product.name,
		})),
	}
}

const AVAILABILITY: Record<string, string | undefined> = {
	in_stock: "https://schema.org/InStock",
	out_of_stock: "https://schema.org/OutOfStock",
	unknown: undefined,
}

/**
 * Product structured data.
 *
 * ── The rule this function exists to enforce ────────────────────────────────
 * An `offers.price` is emitted **only** when the price is generic list pricing.
 *
 * In B2B the same SKU carries a different price for every buyer account, set by
 * contract. Publishing a signed-in buyer's negotiated price into structured
 * data would (a) tell a crawler something untrue for everyone else, earning a
 * Merchant-listing mismatch penalty, and (b) disclose that account's commercial
 * terms to anyone who views source.
 *
 * Enforcing it here rather than at the call site means no route can get this
 * wrong, including routes written later by someone who never read this comment.
 */
export function productJsonLd(
	product: Product,
	opts: { canonical: string } = { canonical: "" },
): Json {
	const realImages = product.images.filter((img) => !img.isPlaceholder)

	const data: Json = {
		"@context": "https://schema.org",
		"@type": "Product",
		name: product.name,
		url: opts.canonical || absoluteUrl(`/p/${product.slug}`),
		...(product.description ? { description: product.description } : {}),
		...(product.sku ? { sku: product.sku } : {}),
		// Placeholders are excluded: publishing a generic "no image" asset as
		// `Product.image` tells a crawler it is the product's photograph, which
		// is false and can cost a rich result. Omitting the field is honest.
		...(realImages.length > 0
			? { image: realImages.map((img) => absoluteUrl(img.url)) }
			: {}),
	}

	if (product.attributes.length > 0) {
		data.additionalProperty = product.attributes.map((attr) => ({
			"@type": "PropertyValue",
			name: attr.label,
			value: attr.value,
		}))
	}

	const price = product.price
	const availability = AVAILABILITY[product.availability]

	// The gate. `negotiated` and `unavailable` never reach structured data.
	const publishable =
		price?.origin === "list" && price.listPrice.amount !== null

	if (publishable && price) {
		data.offers = {
			"@type": "Offer",
			price: price.listPrice.amount,
			priceCurrency: price.listPrice.currencyCode,
			url: opts.canonical || absoluteUrl(`/p/${product.slug}`),
			...(availability ? { availability } : {}),
		}
	} else if (availability) {
		// Still worth describing the product; simply without a price claim.
		data.offers = {
			"@type": "Offer",
			availability,
			url: opts.canonical || absoluteUrl(`/p/${product.slug}`),
		}
	}

	return data
}

export function categoryTrail(
	category: { name: string; slug: string },
	path: Array<CategorySummary>,
): Array<{ name: string; path: string }> {
	return [
		{ name: "Home", path: "/" },
		...path.map((c) => ({ name: c.name, path: `/c/${c.slug}` })),
		{ name: category.name, path: `/c/${category.slug}` },
	]
}
