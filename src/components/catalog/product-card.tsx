import { Link } from "@tanstack/react-router"

import { Badge } from "#/components/ui/badge"
import { formatMoney } from "#/lib/format"

import type { ProductSummary } from "#/lib/salesforce/types/product"

/**
 * A product tile.
 *
 * Pricing is deliberately conditional: a guest may see list pricing or nothing
 * at all, and "Sign in to see pricing" is the honest B2B answer rather than a
 * placeholder zero.
 */
export function ProductCard({ product }: { product: ProductSummary }) {
	const price = product.price
	const amount =
		price?.negotiatedPrice.amount ?? price?.listPrice.amount ?? null

	return (
		<Link
			to="/p/$slug"
			params={{ slug: product.slug }}
			className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-shadow hover:shadow-md"
		>
			<div className="aspect-square overflow-hidden bg-muted/40">
				{product.image ? (
					<img
						src={product.image.url}
						alt={product.image.alt ?? product.name}
						loading="lazy"
						className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
					/>
				) : (
					<div className="flex size-full items-center justify-center text-xs text-muted-foreground">
						No image
					</div>
				)}
			</div>

			<div className="flex flex-1 flex-col gap-2 p-4">
				{product.sku ? (
					<span className="text-xs text-muted-foreground">{product.sku}</span>
				) : null}

				<h3 className="line-clamp-2 text-sm font-medium leading-snug">
					{product.name}
				</h3>

				<div className="mt-auto pt-2">
					{amount !== null ? (
						<div className="flex items-baseline gap-2">
							<span className="text-base font-semibold">
								{formatMoney(amount, price?.listPrice.currencyCode ?? "USD")}
							</span>
							{price?.origin === "negotiated" ? (
								<Badge variant="secondary" className="text-[10px]">
									Your price
								</Badge>
							) : null}
						</div>
					) : (
						<span className="text-sm text-muted-foreground">
							Sign in to see pricing
						</span>
					)}
				</div>
			</div>
		</Link>
	)
}
