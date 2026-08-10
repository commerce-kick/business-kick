import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

import { LoginForm } from "#/components/auth/login-form"
import { seo } from "#/lib/seo/seo"

export const Route = createFileRoute("/login")({
	validateSearch: z.object({
		redirect: z.string().optional(),
	}),

	beforeLoad: ({ context, search }) => {
		// Someone already signed in has no business on the login page.
		if (context.session) {
			throw redirect({ to: search.redirect ?? "/", replace: true })
		}
	},

	// Public, but there is nothing here worth indexing.
	head: () => seo({ title: "Sign in", index: false }),

	component: LoginPage,
})

function LoginPage() {
	const { redirect: redirectTo } = Route.useSearch()

	return (
		<div className="mx-auto flex max-w-md flex-col justify-center px-6 py-20">
			<h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				Use your business account to see contract pricing and place orders.
			</p>

			<div className="mt-8">
				<LoginForm redirect={redirectTo} />
			</div>
		</div>
	)
}
