import { Link } from "@tanstack/react-router"

import { Button } from "#/components/ui/button"

/**
 * Pagination for a category.
 *
 * Rendered as real `<a href>` links rather than buttons, so a crawler can walk
 * deeper pages and the whole catalog stays reachable. Client-side navigation
 * still applies — `Link` upgrades them without removing the href.
 */
export function CategoryPagination({
	page,
	pageSize,
	total,
	slug,
}: {
	page: number
	pageSize: number
	total: number
	slug: string
}) {
	const lastPage = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
	if (lastPage <= 1) return null

	return (
		<nav
			aria-label="Pagination"
			className="mt-10 flex items-center justify-between gap-4"
		>
			<div>
				{page > 1 ? (
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/c/$slug"
								params={{ slug }}
								// Page 1 drops the param so the first page has exactly one
								// URL — the same one `canonicalFor` emits.
								search={(prev) => ({
									...prev,
									page: page - 1 <= 1 ? undefined : page - 1,
								})}
								rel="prev"
							/>
						}
					>
						Previous
					</Button>
				) : null}
			</div>

			<p className="text-sm text-muted-foreground">
				Page {page} of {lastPage}
			</p>

			<div>
				{page < lastPage ? (
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/c/$slug"
								params={{ slug }}
								search={(prev) => ({ ...prev, page: page + 1 })}
								rel="next"
							/>
						}
					>
						Next
					</Button>
				) : null}
			</div>
		</nav>
	)
}
