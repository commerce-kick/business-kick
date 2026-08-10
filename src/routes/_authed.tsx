import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

/**
 * Guard for genuinely private routes.
 *
 * Guests browse the catalog freely, so this covers only what belongs to a
 * signed-in buyer: account, orders, saved lists. The session is already in
 * context from the root route's `beforeLoad`, so this costs nothing extra.
 */
export const Route = createFileRoute("/_authed")({
	beforeLoad: ({ context, location }) => {
		if (!context.session) {
			throw redirect({
				to: "/login",
				// `href` is path-absolute and same-origin; `safeRedirect` on the
				// server re-validates it before honouring it, so a hand-crafted
				// value cannot turn login into an open redirect.
				search: { redirect: location.href },
			})
		}
	},
	component: () => <Outlet />,
})
