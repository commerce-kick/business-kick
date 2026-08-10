import { createFileRoute, Link } from "@tanstack/react-router"
import { ShoppingCart } from "lucide-react"

import { Button } from "#/components/ui/button"
import { seo } from "#/lib/seo/seo"

/**
 * Cart — stubbed for this milestone.
 *
 * The SDK's cart resource (`lib/salesforce/resources/cart.ts`) is complete and
 * typed; what is missing is the UI and the mutation wiring. Kept as an honest
 * placeholder rather than a half-working cart.
 */
export const Route = createFileRoute("/cart")({
	head: () => seo({ title: "Your cart", index: false }),
	component: CartPage,
})

function CartPage() {
	const { session } = Route.useRouteContext()

	return (
		<div className="mx-auto max-w-3xl px-6 py-20 text-center">
			<ShoppingCart className="mx-auto size-8 text-muted-foreground" />
			<h1 className="mt-4 text-2xl font-semibold tracking-tight">Your cart</h1>

			{session ? (
				<p className="mt-3 text-muted-foreground">
					Cart and checkout arrive in the next milestone.
				</p>
			) : (
				<>
					<p className="mt-3 text-muted-foreground">
						Sign in with your business account to build an order.
					</p>
					<Button
						className="mt-8"
						nativeButton={false}
						render={<Link to="/login" search={{ redirect: "/cart" }} />}
					>
						Sign in
					</Button>
				</>
			)}
		</div>
	)
}
