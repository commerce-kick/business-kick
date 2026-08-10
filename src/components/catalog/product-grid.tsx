import { PackageSearch } from "lucide-react"

import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty"
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
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<PackageSearch />
					</EmptyMedia>
					<EmptyTitle>Nothing to show</EmptyTitle>
					<EmptyDescription>{emptyMessage}</EmptyDescription>
				</EmptyHeader>
			</Empty>
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
