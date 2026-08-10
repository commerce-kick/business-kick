import { webstoreBase } from "../config"
import { request } from "../http"
import type { OrderSummary } from "../types/cart"
import type { Paged } from "../types/common"

/**
 * Order history.
 *
 * Endpoint: GET /order-summaries
 *
 * Backed by Order Management, so an order placed through the storefront appears
 * here only once OM has processed it — a short delay after checkout is normal
 * and not a bug worth chasing.
 */

interface RawOrderSummary {
	orderSummaryId?: string
	orderNumber?: string
	createdDate?: string
	orderedDate?: string
	status?: string
	grandTotalAmount?: string | number
	totalProductCount?: string | number
	currencyIsoCode?: string
}

interface RawOrdersResponse {
	orderSummaries?: Array<RawOrderSummary>
	count?: number
	total?: number
	nextPageUrl?: string | null
}

const num = (value: unknown): number | null => {
	if (value === undefined || value === null || value === "") return null
	const n = typeof value === "number" ? value : Number.parseFloat(String(value))
	return Number.isFinite(n) ? n : null
}

export async function listOrders(
	params: { page?: number; pageSize?: number } = {},
	opts: { signal?: AbortSignal } = {},
): Promise<Paged<OrderSummary>> {
	const page = Math.max(1, params.page ?? 1)
	const pageSize = params.pageSize ?? 10

	const response = await request<RawOrdersResponse>(
		`${webstoreBase()}/order-summaries`,
		{
			auth: "buyer",
			scopeToAccount: true,
			signal: opts.signal,
			query: { pageSize, page: page - 1 },
		},
	)

	const items: Array<OrderSummary> = (response.orderSummaries ?? [])
		.filter((order) => order.orderSummaryId)
		.map((order) => ({
			id: order.orderSummaryId as string,
			orderNumber: order.orderNumber ?? (order.orderSummaryId as string),
			placedAt: order.orderedDate ?? order.createdDate ?? "",
			status: order.status ?? "Unknown",
			itemCount: num(order.totalProductCount) ?? 0,
			total: {
				amount: num(order.grandTotalAmount),
				currencyCode: order.currencyIsoCode ?? "USD",
			},
		}))

	const total = response.total ?? response.count ?? items.length

	return {
		items,
		total,
		page,
		pageSize,
		hasMore: Boolean(response.nextPageUrl) || page * pageSize < total,
	}
}
