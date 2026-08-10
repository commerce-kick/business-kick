import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { ProductGrid } from "#/components/catalog/product-grid"
import { Input } from "#/components/ui/input"
import { searchQuery } from "#/lib/query/catalog"
import { seo } from "#/lib/seo/seo"

export const Route = createFileRoute("/search")({
	// Optional rather than defaulted, so visiting `/search` does not bounce
	// through `/search?q=&page=1`. See the note on `catalogSearchSchema`.
	validateSearch: z.object({
		q: z.string().optional().catch(undefined),
		page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
		sort: z.string().optional().catch(undefined),
		refine: z.array(z.string()).optional().catch(undefined),
	}),

	loaderDeps: ({ search }) => ({
		q: search.q ?? "",
		page: search.page ?? 1,
		sort: search.sort,
		refine: search.refine,
	}),

	loader: ({ context, deps }) =>
		context.queryClient.ensureQueryData(searchQuery(deps)),

	/**
	 * Never indexed. Internal search results are the textbook thin/duplicate
	 * content case — they compete with the category pages that should rank, and
	 * an unbounded query string is an unbounded number of crawlable URLs.
	 */
	head: ({ match }) =>
		seo({
			title: match.search.q ? `Search: ${match.search.q}` : "Search",
			index: false,
		}),

	component: SearchPage,
})

function SearchPage() {
	const search = Route.useSearch()
	const navigate = Route.useNavigate()
	const query = search.q ?? ""
	const { data: results } = useSuspenseQuery(
		searchQuery({
			q: query,
			page: search.page ?? 1,
			sort: search.sort,
			refine: search.refine,
		}),
	)

	return (
		<div className="mx-auto max-w-7xl px-6 py-10">
			<h1 className="text-3xl font-semibold tracking-tight">Search</h1>

			<form
				className="mt-6 max-w-xl"
				onSubmit={(event) => {
					event.preventDefault()
					const value = String(new FormData(event.currentTarget).get("q") ?? "")
					// `undefined` removes the param entirely, keeping `/search?q=bolt`
					// clean rather than `/search?q=bolt&page=1`.
					navigate({
						search: (prev) => ({
							...prev,
							q: value || undefined,
							page: undefined,
						}),
					})
				}}
			>
				<Input
					name="q"
					defaultValue={query}
					placeholder="Search products or SKUs"
					aria-label="Search products"
				/>
			</form>

			{query ? (
				<>
					<p className="mt-6 text-sm text-muted-foreground">
						{results.total} {results.total === 1 ? "result" : "results"} for “
						{query}”
					</p>
					<div className="mt-6">
						<ProductGrid
							products={results.items}
							emptyMessage={`Nothing matched “${query}”.`}
						/>
					</div>
				</>
			) : (
				<p className="mt-6 text-sm text-muted-foreground">
					Enter a product name or SKU to begin.
				</p>
			)}
		</div>
	)
}
