import { Link } from "@tanstack/react-router"

export function SiteFooter() {
	return (
		<footer className="border-t border-border/60 bg-muted/30">
			<div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
				<p>© {new Date().getFullYear()} Meridian. All rights reserved.</p>
				<nav className="flex items-center gap-6">
					<Link to="/" className="transition-colors hover:text-foreground">
						Home
					</Link>
					<Link
						to="/search"
						className="transition-colors hover:text-foreground"
					>
						Search
					</Link>
					<Link to="/login" className="transition-colors hover:text-foreground">
						Sign in
					</Link>
				</nav>
			</div>
		</footer>
	)
}
