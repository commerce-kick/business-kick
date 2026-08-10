import { readAccessToken } from "../auth/session"
import { webstoreBase } from "../config"
import { request } from "../http"

import type { ProductPrice } from "../types/product"

/**
 * Pricing.
 *
 * Endpoints:
 *   GET  /pricing/products/{productId}
 *   POST /pricing/products          (batch)
 *
 * This is the heart of B2B: the same product returns a different number for
 * different buyer accounts, driven by entitlement policies and contract price
 * books. Two consequences ripple outward from here:
 *
 *   - Pricing is always `scopeToAccount: true`.
 *   - The `origin` flag records whether a price is generic list pricing or
 *     account-negotiated. `jsonld.ts` refuses to publish the latter.
 */

interface RawPricingResult {
	productId?: string
	listPrice?: string | number | null
	unitPrice?: string | number | null
	negotiatedPrice?: string | number | null
	currencyIsoCode?: string
	success?: boolean
	error?: unknown
}

interface RawPricingBatchResponse {
	pricingLineItemResults?: Array<RawPricingResult>
	currencyIsoCode?: string
}

const toAmount = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null
	const n = typeof value === "number" ? value : Number.parseFloat(String(value))
	return Number.isFinite(n) ? n : null
}

function mapPrice(
	raw: RawPricingResult,
	fallbackCurrency: string,
): ProductPrice {
	const currencyCode = raw.currencyIsoCode ?? fallbackCurrency
	const list = toAmount(raw.listPrice)
	const negotiated =
		toAmount(raw.negotiatedPrice) ?? toAmount(raw.unitPrice) ?? list

	// Signed-in buyers receive account-scoped pricing by definition. Guests can
	// only ever be shown generic list pricing — which is precisely the pricing
	// that is safe to publish in structured data.
	const isBuyer = Boolean(readAccessToken())

	let origin: ProductPrice["origin"]
	if (negotiated === null && list === null) {
		origin = "unavailable"
	} else if (isBuyer) {
		origin = "negotiated"
	} else {
		origin = "list"
	}

	return {
		listPrice: { amount: list, currencyCode },
		negotiatedPrice: { amount: negotiated, currencyCode },
		origin,
	}
}

export async function getProductPrice(
	productId: string,
	opts: { signal?: AbortSignal } = {},
): Promise<ProductPrice> {
	const raw = await request<RawPricingResult>(
		`${webstoreBase()}/pricing/products/${encodeURIComponent(productId)}`,
		{ scopeToAccount: true, signal: opts.signal },
	)
	return mapPrice(raw, raw.currencyIsoCode ?? "USD")
}

/**
 * Batch pricing for a product grid.
 *
 * One call per PLP rather than one per tile — the difference between 1 and 24
 * API calls per page view, which matters against the org's request quota.
 */
export async function getProductPrices(
	productIds: Array<string>,
	opts: { signal?: AbortSignal } = {},
): Promise<Map<string, ProductPrice>> {
	const result = new Map<string, ProductPrice>()
	if (productIds.length === 0) return result

	const response = await request<RawPricingBatchResponse>(
		`${webstoreBase()}/pricing/products`,
		{
			method: "POST",
			scopeToAccount: true,
			signal: opts.signal,
			body: {
				pricingLineItems: productIds.map((productId) => ({ productId })),
			},
		},
	)

	const fallbackCurrency = response.currencyIsoCode ?? "USD"
	for (const item of response.pricingLineItemResults ?? []) {
		if (!item.productId) continue
		result.set(item.productId, mapPrice(item, fallbackCurrency))
	}

	return result
}
