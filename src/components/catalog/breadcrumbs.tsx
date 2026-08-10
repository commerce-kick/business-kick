import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

/**
 * Visible breadcrumbs.
 *
 * Rendered from the same trail that feeds `BreadcrumbList` JSON-LD, so what a
 * crawler is told and what a person sees cannot drift apart.
 */
export function Breadcrumbs({
	trail,
}: {
	trail: Array<{ name: string; path: string }>
}) {
	if (trail.length === 0) return null

	return (
		<nav aria-label="Breadcrumb">
			<ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
				{trail.map((crumb, index) => {
					const isLast = index === trail.length - 1
					return (
						<li key={crumb.path} className="flex items-center gap-1">
							{isLast ? (
								<span aria-current="page" className="text-foreground">
									{crumb.name}
								</span>
							) : (
								<>
									<Link
										to={crumb.path}
										className="transition-colors hover:text-foreground"
									>
										{crumb.name}
									</Link>
									<ChevronRight className="size-3.5" aria-hidden />
								</>
							)}
						</li>
					)
				})}
			</ol>
		</nav>
	)
}
