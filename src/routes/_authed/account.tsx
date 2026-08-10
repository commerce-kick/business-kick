import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"

import { Button } from "#/components/ui/button"
import { Separator } from "#/components/ui/separator"
import { seo } from "#/lib/seo/seo"
import { logoutFn } from "#/server/auth.fn"

export const Route = createFileRoute("/_authed/account")({
	head: () => seo({ title: "Your account", index: false }),
	component: AccountPage,
})

function AccountPage() {
	const { session } = Route.useRouteContext()
	const router = useRouter()
	const queryClient = useQueryClient()

	const logout = useMutation({
		mutationFn: () => logoutFn(),
		onSuccess: async () => {
			// Same reasoning as sign-in: cached responses carry this buyer's
			// account-scoped pricing and must not survive into a guest session.
			queryClient.clear()
			await router.invalidate()
			await router.navigate({ to: "/", replace: true })
		},
	})

	return (
		<div className="mx-auto max-w-3xl px-6 py-12">
			<h1 className="text-3xl font-semibold tracking-tight">Your account</h1>

			<dl className="mt-8 grid gap-4">
				<div className="flex justify-between gap-4 border-b border-border/40 py-3">
					<dt className="text-sm text-muted-foreground">Name</dt>
					<dd className="text-sm font-medium">
						{session?.user.displayName ?? "—"}
					</dd>
				</div>
				<div className="flex justify-between gap-4 border-b border-border/40 py-3">
					<dt className="text-sm text-muted-foreground">Email</dt>
					<dd className="text-sm font-medium">
						{session?.user.email ?? session?.user.username ?? "—"}
					</dd>
				</div>
				<div className="flex justify-between gap-4 border-b border-border/40 py-3">
					<dt className="text-sm text-muted-foreground">Buyer account</dt>
					<dd className="font-mono text-sm">
						{session?.effectiveAccountId ?? "—"}
					</dd>
				</div>
			</dl>

			<Separator className="my-8" />

			<section>
				<h2 className="text-sm font-semibold">Order history</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					The orders SDK resource is in place; this view arrives with the cart
					and checkout milestone.
				</p>
			</section>

			<Separator className="my-8" />

			<Button
				variant="outline"
				onClick={() => logout.mutate()}
				disabled={logout.isPending}
			>
				Sign out
			</Button>
		</div>
	)
}
