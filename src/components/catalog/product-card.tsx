import { Link } from "@tanstack/react-router"

import { Badge } from "#/components/ui/badge"
import { Card, CardContent } from "#/components/ui/card"
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
			className="group block focus-visible:outline-none"
		>
			<Card className="h-full gap-0 transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring">
				<div className="aspect-square overflow-hidden bg-muted">
					{product.image ? (
						<img
							src={product.image.url}
							alt={product.image.alt ?? product.name}
							loading="lazy"
							className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
						/>
					) : null}
				</div>

				<CardContent className="flex flex-1 flex-col gap-2 pt-4">
					{product.sku ? (
						<span className="text-muted-foreground text-xs">{product.sku}</span>
					) : null}

					<h3 className="line-clamp-2 font-medium leading-snug">
						{product.name}
					</h3>

					<div className="mt-auto pt-2">
						{amount !== null ? (
							<div className="flex items-baseline gap-2">
								<span className="font-semibold text-base">
									{formatMoney(amount, price?.listPrice.currencyCode ?? "USD")}
								</span>
								{price?.origin === "negotiated" ? (
									<Badge variant="secondary">Your price</Badge>
								) : null}
							</div>
						) : (
							<span className="text-muted-foreground text-sm">
								Sign in to see pricing
							</span>
						)}
					</div>
				</CardContent>
			</Card>
		</Link>
	)
}
