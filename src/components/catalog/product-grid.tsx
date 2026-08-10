import type { ProductSummary } from "#/lib/salesforce/types/product"
import { ProductCard } from "./product-card"

export function ProductGrid({
	products,
	emptyMessage = "No products matched.",
}: {
	products: Array<ProductSummary>
	emptyMessage?: string
}) {
	if (products.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		)
	}

	return (
		<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{products.map((product) => (
				<ProductCard key={product.id} product={product} />
			))}
		</div>
	)
}
