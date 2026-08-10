import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { SiteFooter } from "#/components/layout/footer"
import { SiteHeader } from "#/components/layout/header"
import TanStackQueryDevtools from "#/integrations/tanstack-query/devtools"
import type { Session } from "#/lib/salesforce/auth/session"
import {
	jsonLdScript,
	organizationJsonLd,
	websiteJsonLd,
} from "#/lib/seo/jsonld"
import { seo } from "#/lib/seo/seo"
import { getSessionFn } from "#/server/auth.fn"
import appCss from "#/styles.css?url"

interface RouterContext {
	queryClient: QueryClient
	session: Session | null
}

export const Route = createRootRouteWithContext<RouterContext>()({
	/**
	 * Resolve the session once per navigation and hand it to every route via
	 * context. Components read it synchronously — no client fetch, no loading
	 * waterfall, and no flash of signed-out chrome before hydration catches up.
	 *
	 * This reads a cookie rather than calling Salesforce, so it costs nothing
	 * against the org's API quota.
	 */
	beforeLoad: async () => {
		const session = await getSessionFn().catch(() => null)
		return { session }
	},

	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			...seo({ index: true, type: "website" }).meta,
		],
		links: [{ rel: "stylesheet", href: appCss }],
		scripts: [
			{
				type: "application/ld+json",
				children: jsonLdScript([organizationJsonLd(), websiteJsonLd()]),
			},
		],
	}),

	shellComponent: RootDocument,
	notFoundComponent: NotFound,
	errorComponent: RootError,
})

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
				<SiteHeader />
				<main className="flex-1">{children}</main>
				<SiteFooter />
				{/*
				 * Dev only. `import.meta.env.DEV` is statically replaced at build
				 * time, so the devtools panels are tree-shaken out of the
				 * production bundle entirely rather than merely hidden — they are
				 * a substantial amount of JS to ship to real shoppers.
				 */}
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
							TanStackQueryDevtools,
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	)
}

function NotFound() {
	return (
		<div className="mx-auto max-w-2xl px-6 py-24 text-center">
			<p className="text-sm font-medium text-muted-foreground">404</p>
			<h1 className="mt-3 text-3xl font-semibold tracking-tight">
				We couldn't find that page
			</h1>
			<p className="mt-3 text-muted-foreground">
				The link may be out of date, or the product may no longer be part of
				your catalog.
			</p>
			<a
				href="/"
				className="mt-8 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
			>
				Back to home
			</a>
		</div>
	)
}

/**
 * Raw error text is shown in development only.
 *
 * Salesforce error messages routinely name record Ids, org hosts and internal
 * object names. Rendering them to a shopper leaks infrastructure detail and
 * tells them nothing they can act on — the server log already has the full
 * error with its request id.
 */
function RootError({ error }: { error: Error }) {
	return (
		<div className="mx-auto max-w-2xl px-6 py-24 text-center">
			<h1 className="text-3xl font-semibold tracking-tight">
				Something went wrong
			</h1>
			<p className="mt-3 text-muted-foreground">
				We couldn't load this page. Please try again in a moment.
			</p>
			<a
				href="/"
				className="mt-8 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
			>
				Back to home
			</a>
			<p className="mt-6 font-mono text-sm text-muted-foreground">
				{import.meta.env.DEV ? error.message : null}
			</p>
		</div>
	)
}
