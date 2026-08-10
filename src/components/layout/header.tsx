import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, useRouteContext } from "@tanstack/react-router"
import { Search, ShoppingCart, User } from "lucide-react"
import { Suspense } from "react"

import { Button } from "#/components/ui/button"
import { Skeleton } from "#/components/ui/skeleton"
import { rootCategoriesQuery } from "#/lib/query/catalog"

export function SiteHeader() {
	const { session } = useRouteContext({ from: "__root__" })

	return (
		<header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
				<Link to="/" className="font-semibold text-lg tracking-tight">
					Meridian
				</Link>

				<Suspense fallback={<NavSkeleton />}>
					<CategoryNav />
				</Suspense>

				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						nativeButton={false}
						render={<Link to="/search" />}
					>
						<Search />
						<span className="sr-only">Search</span>
					</Button>

					<Button
						variant="ghost"
						size="icon"
						nativeButton={false}
						render={<Link to="/cart" />}
					>
						<ShoppingCart />
						<span className="sr-only">Cart</span>
					</Button>

					{session ? (
						<Button
							variant="ghost"
							size="sm"
							nativeButton={false}
							render={<Link to="/account" />}
						>
							<User />
							<span className="max-w-32 truncate">
								{session.user.displayName ?? session.user.username}
							</span>
						</Button>
					) : (
						<Button
							size="sm"
							nativeButton={false}
							render={<Link to="/login" search={{ redirect: undefined }} />}
						>
							Sign in
						</Button>
					)}
				</div>
			</div>
		</header>
	)
}

function CategoryNav() {
	const { data: categories } = useSuspenseQuery(rootCategoriesQuery())

	if (categories.length === 0) return null

	return (
		<nav className="hidden items-center gap-1 md:flex">
			{categories.slice(0, 5).map((category) => (
				<Link
					key={category.id}
					to="/c/$slug"
					params={{ slug: category.slug }}
					className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
					activeProps={{ className: "bg-accent text-accent-foreground" }}
				>
					{category.name}
				</Link>
			))}
		</nav>
	)
}

function NavSkeleton() {
	return (
		<div className="hidden items-center gap-2 md:flex">
			{["a", "b", "c"].map((k) => (
				<Skeleton key={k} className="h-5 w-20" />
			))}
		</div>
	)
}
