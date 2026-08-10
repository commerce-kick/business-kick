import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "#/components/ui/button"
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "#/components/ui/field"
import { Input } from "#/components/ui/input"
import { Spinner } from "#/components/ui/spinner"
import { loginFn } from "#/server/auth.fn"

export function LoginForm({ redirect }: { redirect?: string }) {
	const router = useRouter()
	const queryClient = useQueryClient()
	const [error, setError] = useState<string | null>(null)

	const login = useMutation({
		mutationFn: (data: { username: string; password: string }) =>
			loginFn({ data: { ...data, redirect } }),

		onSuccess: async (result) => {
			// Every cached catalog response was fetched as a guest and carries
			// guest pricing. Signing in changes what this buyer is entitled to
			// see and what it costs, so the whole cache is stale by definition.
			queryClient.clear()
			await router.invalidate()
			await router.navigate({ to: result.redirect, replace: true })
		},

		onError: (err: Error) => {
			setError(err.message || "We couldn't sign you in. Please try again.")
		},
	})

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		const form = new FormData(event.currentTarget)
		login.mutate({
			username: String(form.get("username") ?? ""),
			password: String(form.get("password") ?? ""),
		})
	}

	return (
		<form onSubmit={onSubmit} noValidate>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="username">Work email</FieldLabel>
					<Input
						id="username"
						name="username"
						type="email"
						autoComplete="username"
						required
						placeholder="you@company.com"
					/>
				</Field>

				<Field>
					<FieldLabel htmlFor="password">Password</FieldLabel>
					<Input
						id="password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
					/>
				</Field>

				{error ? <FieldError>{error}</FieldError> : null}

				<Button type="submit" disabled={login.isPending} className="w-full">
					{login.isPending ? <Spinner /> : null}
					Sign in
				</Button>
			</FieldGroup>

			<div className="mt-6 flex items-center justify-between text-sm">
				<Link
					to="/forgot-password"
					className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
				>
					Forgot password?
				</Link>
				<Link
					to="/register"
					className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
				>
					Request an account
				</Link>
			</div>
		</form>
	)
}
