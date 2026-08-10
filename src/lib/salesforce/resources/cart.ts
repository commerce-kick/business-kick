import { webstoreBase } from "../config"
import { request } from "../http"
import type { Cart, CartItem } from "../types/cart"
import type { Money } from "../types/common"
import { mapProductSummary, type RawProduct } from "./products"

/**
 * Carts.
 *
 * Endpoints:
 *   GET    /carts/{cartStateOrId}                 ("current" is a valid alias)
 *   POST   /carts/{cartStateOrId}/cart-items
 *   PATCH  /carts/{cartStateOrId}/cart-items/{id}
 *   DELETE /carts/{cartStateOrId}/cart-items/{id}
 *   DELETE /carts/{cartStateOrId}
 *
 * Carts are per buyer account, so every call is `auth: "buyer"` — a guest has
 * nowhere to put a cart. The UI keeps cart entry points behind a sign-in prompt
 * rather than letting these throw.
 */

const CURRENT = "current"

interface RawCartItem {
	cartItemId?: string
	quantity?: string | number
	salesPrice?: string | number
	totalListPrice?: string | number
	totalPrice?: string | number
	productDetails?: RawProduct
}

interface RawCart {
	cartId?: string
	status?: string
	currencyIsoCode?: string
	totalProductCount?: string | number
	grandTotalAmount?: string | number
	totalProductAmount?: string | number
	totalTaxAmount?: string | number
	cartItems?: Array<{ cartItem?: RawCartItem }>
}

const num = (value: unknown, fallback = 0): number => {
	const n =
		typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
	return Number.isFinite(n) ? n : fallback
}

const money = (value: unknown, currencyCode: string): Money => ({
	amount: value === undefined || value === null ? null : num(value),
	currencyCode,
})

function mapStatus(status: string | undefined): Cart["status"] {
	switch (status?.toLowerCase()) {
		case "active":
			return "active"
		case "checkout":
			return "checkout"
		case "closed":
			return "closed"
		default:
			return "unknown"
	}
}

function mapCart(raw: RawCart): Cart {
	const currencyCode = raw.currencyIsoCode ?? "USD"

	const items: Array<CartItem> = (raw.cartItems ?? [])
		.map((entry) => entry.cartItem)
		.filter((item): item is RawCartItem => Boolean(item?.cartItemId))
		.map((item) => ({
			id: item.cartItemId as string,
			quantity: num(item.quantity, 1),
			unitPrice: money(item.salesPrice, currencyCode),
			totalPrice: money(item.totalPrice ?? item.totalListPrice, currencyCode),
			product: mapProductSummary(item.productDetails ?? {}),
		}))

	return {
		id: raw.cartId ?? "",
		status: mapStatus(raw.status),
		items,
		itemCount: num(raw.totalProductCount, items.length),
		subtotal: money(raw.totalProductAmount, currencyCode),
		tax: money(raw.totalTaxAmount, currencyCode),
		total: money(raw.grandTotalAmount, currencyCode),
		currencyCode,
	}
}

export async function getCart(
	opts: { signal?: AbortSignal } = {},
): Promise<Cart> {
	const raw = await request<RawCart>(`${webstoreBase()}/carts/${CURRENT}`, {
		auth: "buyer",
		scopeToAccount: true,
		signal: opts.signal,
	})
	return mapCart(raw)
}

export async function addCartItem(
	input: { productId: string; quantity: number },
	opts: { signal?: AbortSignal } = {},
): Promise<Cart> {
	await request(`${webstoreBase()}/carts/${CURRENT}/cart-items`, {
		method: "POST",
		auth: "buyer",
		scopeToAccount: true,
		signal: opts.signal,
		body: {
			productId: input.productId,
			quantity: String(input.quantity),
		},
	})
	return getCart(opts)
}

export async function updateCartItem(
	input: { cartItemId: string; quantity: number },
	opts: { signal?: AbortSignal } = {},
): Promise<Cart> {
	await request(
		`${webstoreBase()}/carts/${CURRENT}/cart-items/${encodeURIComponent(input.cartItemId)}`,
		{
			method: "PATCH",
			auth: "buyer",
			scopeToAccount: true,
			signal: opts.signal,
			body: { quantity: String(input.quantity) },
		},
	)
	return getCart(opts)
}

export async function removeCartItem(
	cartItemId: string,
	opts: { signal?: AbortSignal } = {},
): Promise<Cart> {
	await request(
		`${webstoreBase()}/carts/${CURRENT}/cart-items/${encodeURIComponent(cartItemId)}`,
		{
			method: "DELETE",
			auth: "buyer",
			scopeToAccount: true,
			signal: opts.signal,
		},
	)
	return getCart(opts)
}

export async function clearCart(
	opts: { signal?: AbortSignal } = {},
): Promise<void> {
	await request(`${webstoreBase()}/carts/${CURRENT}`, {
		method: "DELETE",
		auth: "buyer",
		scopeToAccount: true,
		signal: opts.signal,
	})
}
