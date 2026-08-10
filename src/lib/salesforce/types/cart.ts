import type { Money } from "./common"
import type { ProductSummary } from "./product"

export interface CartItem {
	id: string
	product: ProductSummary
	quantity: number
	unitPrice: Money
	totalPrice: Money
}

export interface Cart {
	id: string
	status: "active" | "checkout" | "closed" | "unknown"
	items: Array<CartItem>
	itemCount: number
	subtotal: Money
	tax: Money
	total: Money
	currencyCode: string
}

export interface OrderSummary {
	id: string
	orderNumber: string
	/** ISO 8601. */
	placedAt: string
	status: string
	total: Money
	itemCount: number
}
