import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"

import { Button } from "#/components/ui/button"
import { rootCategoriesQuery } from "#/lib/query/catalog"
import { canonicalFor } from "#/lib/seo/canonical"
import { seo } from "#/lib/seo/seo"

export const Route = createFileRoute("/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(rootCategoriesQuery()),

	head: () => ({
		...seo({
			titleOverride: "Meridian — B2B industrial supply",
			description:
				"Contract pricing, account-based catalogs and fast reordering for procurement teams.",
			canonical: canonicalFor("/"),
			index: true,
		}),
	}),

	component: Home,
})

function Home() {
	const { data: categories } = useSuspenseQuery(rootCategoriesQuery())
	const { session } = Route.useRouteContext()

	return (
		<div className="mx-auto max-w-7xl px-6">
			<section className="py-20 sm:py-28">
				<h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
					Procurement that moves at the speed of your line
				</h1>
				<p className="mt-5 max-w-xl text-lg text-muted-foreground">
					Browse the full catalog. Sign in with your business account to see
					contract pricing, entitlements and fast reordering.
				</p>

				<div className="mt-8 flex flex-wrap gap-3">
					{categories[0] ? (
						<Button
							size="lg"
							nativeButton={false}
							render={
								<Link to="/c/$slug" params={{ slug: categories[0].slug }} />
							}
						>
							Browse catalog
						</Button>
					) : null}

					{!session ? (
						<Button
							size="lg"
							variant="outline"
							nativeButton={false}
							render={<Link to="/login" search={{ redirect: undefined }} />}
						>
							Sign in
						</Button>
					) : null}
				</div>
			</section>

			{categories.length > 0 ? (
				<section className="border-t border-border/60 py-16">
					<h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
						Shop by category
					</h2>
					<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{categories.map((category) => (
							<Link
								key={category.id}
								to="/c/$slug"
								params={{ slug: category.slug }}
								className="group rounded-xl border border-border/60 p-6 transition-colors hover:bg-muted/40"
							>
								<h3 className="font-medium">{category.name}</h3>
								{category.description ? (
									<p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
										{category.description}
									</p>
								) : null}
							</Link>
						))}
					</div>
				</section>
			) : null}
		</div>
	)
}
