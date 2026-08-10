import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, notFound } from "@tanstack/react-router"

import { Breadcrumbs } from "#/components/catalog/breadcrumbs"
import { CategoryPagination } from "#/components/catalog/pagination"
import { ProductGrid } from "#/components/catalog/product-grid"
import { categoryPageQuery } from "#/lib/query/catalog"
import { canonicalFor } from "#/lib/seo/canonical"
import {
	breadcrumbJsonLd,
	categoryTrail,
	itemListJsonLd,
	jsonLdScript,
} from "#/lib/seo/jsonld"
import { seo } from "#/lib/seo/seo"
import { catalogSearchSchema } from "#/server/catalog.fn"

export const Route = createFileRoute("/c/$slug")({
	validateSearch: catalogSearchSchema,

	// Only these params change the data, so only these should re-run the loader.
	// `page` is defaulted here rather than in the schema — see the note on
	// `catalogSearchSchema` for why defaults must not touch the URL.
	loaderDeps: ({ search }) => ({
		page: search.page ?? 1,
		sort: search.sort,
		refine: search.refine,
	}),

	loader: async ({ context, params, deps }) => {
		const data = await context.queryClient.ensureQueryData(
			categoryPageQuery({ slug: params.slug, ...deps }),
		)

		// The server function returns null rather than throwing, because a thrown
		// error class does not survive serialization on a client navigation.
		// `notFound()` is what produces a real 404 status — which is what stops a
		// crawler from indexing a dead URL as a valid empty page.
		if (!data) throw notFound()

		return data
	},

	head: ({ loaderData, params, match }) => {
		if (!loaderData) return {}

		const { category, products } = loaderData
		const page = match.search.page ?? 1
		const canonical = canonicalFor(`/c/${params.slug}`, { page })
		const trail = categoryTrail(category, category.path)

		return {
			...seo({
				title: page > 1 ? `${category.name} — Page ${page}` : category.name,
				description:
					category.description ??
					`Browse ${category.name} at Meridian. ${category.productCount ?? ""} products available for business accounts.`.trim(),
				image: category.image?.url,
				canonical,
				// Category pages are the storefront's main indexable surface.
				index: true,
			}),
			scripts: [
				{
					type: "application/ld+json",
					children: jsonLdScript([
						breadcrumbJsonLd(trail),
						itemListJsonLd(products.items, {
							startPosition: (page - 1) * products.pageSize + 1,
						}),
					]),
				},
			],
		}
	},

	component: CategoryPage,
})

function CategoryPage() {
	const params = Route.useParams()
	const search = Route.useSearch()
	const { data } = useSuspenseQuery(
		categoryPageQuery({
			slug: params.slug,
			page: search.page ?? 1,
			sort: search.sort,
			refine: search.refine,
		}),
	)

	if (!data) return null

	const { category, products } = data
	const trail = categoryTrail(category, category.path)

	return (
		<div className="mx-auto max-w-7xl px-6 py-10">
			<Breadcrumbs trail={trail} />

			<div className="mt-6 flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						{category.name}
					</h1>
					{category.description ? (
						<p className="mt-2 max-w-2xl text-muted-foreground">
							{category.description}
						</p>
					) : null}
				</div>
				<p className="text-sm text-muted-foreground">
					{products.total} {products.total === 1 ? "product" : "products"}
				</p>
			</div>

			{category.children.length > 0 ? (
				<nav className="mt-6 flex flex-wrap gap-2">
					{category.children.map((child) => (
						<a
							key={child.id}
							href={`/c/${child.slug}`}
							className="rounded-full border border-border/60 px-3 py-1.5 text-sm transition-colors hover:bg-muted"
						>
							{child.name}
						</a>
					))}
				</nav>
			) : null}

			<div className="mt-8">
				<ProductGrid
					products={products.items}
					emptyMessage="No products in this category are available to your account."
				/>
			</div>

			<CategoryPagination
				page={products.page}
				pageSize={products.pageSize}
				total={products.total}
				slug={params.slug}
			/>
		</div>
	)
}
