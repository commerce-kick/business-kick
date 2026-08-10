import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { getContext } from "./integrations/tanstack-query/root-provider"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
	const context = getContext()

	const router = createTanStackRouter({
		routeTree,
		// `session` is a placeholder here; the root route's `beforeLoad` replaces
		// it on every navigation. It is declared so the context type is complete
		// before that first resolution happens.
		context: { ...context, session: null },
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	})

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

	return router
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
