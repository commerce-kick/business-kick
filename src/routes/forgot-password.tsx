import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "#/components/ui/button"
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "#/components/ui/field"
import { Input } from "#/components/ui/input"
import { Spinner } from "#/components/ui/spinner"
import { seo } from "#/lib/seo/seo"
import { forgotPasswordFn, resetPasswordFn } from "#/server/auth.fn"

export const Route = createFileRoute("/forgot-password")({
	head: () => seo({ title: "Reset your password", index: false }),
	component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
	const [sentTo, setSentTo] = useState<string | null>(null)
	const [identifier, setIdentifier] = useState<string | undefined>()

	return (
		<div className="mx-auto flex max-w-md flex-col justify-center px-6 py-20">
			<h1 className="text-2xl font-semibold tracking-tight">
				{sentTo ? "Set a new password" : "Reset your password"}
			</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				{sentTo
					? `Enter the code we sent to ${sentTo} and choose a new password.`
					: "We'll email you a code to reset your password."}
			</p>

			<div className="mt-8">
				{sentTo ? (
					<ResetStep username={sentTo} identifier={identifier} />
				) : (
					<RequestStep
						onSent={(email, id) => {
							setSentTo(email)
							setIdentifier(id)
						}}
					/>
				)}
			</div>

			<p className="mt-6 text-sm text-muted-foreground">
				<Link
					to="/login"
					search={{ redirect: undefined }}
					className="underline underline-offset-4 hover:text-foreground"
				>
					Back to sign in
				</Link>
			</p>
		</div>
	)
}

function RequestStep({
	onSent,
}: {
	onSent: (email: string, identifier?: string) => void
}) {
	const request = useMutation({
		mutationFn: (username: string) => forgotPasswordFn({ data: { username } }),
		onSuccess: (result, username) => onSent(username, result.identifier),
	})

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		request.mutate(String(form.get("username") ?? ""))
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
					/>
					<FieldDescription>
						{/* Always phrased conditionally: confirming whether an address
						    has an account would make this an enumeration oracle. */}
						If an account exists for this address, we'll send a code.
					</FieldDescription>
				</Field>

				<Button type="submit" disabled={request.isPending} className="w-full">
					{request.isPending ? <Spinner /> : null}
					Send reset code
				</Button>
			</FieldGroup>
		</form>
	)
}

function ResetStep({
	username,
	identifier,
}: {
	username: string
	identifier?: string
}) {
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)

	const reset = useMutation({
		mutationFn: (data: { otp: string; newPassword: string }) =>
			resetPasswordFn({ data: { ...data, username, identifier } }),
		onSuccess: () =>
			router.navigate({ to: "/login", search: { redirect: undefined } }),
		onError: (err: Error) =>
			setError(err.message || "We couldn't reset your password. Try again."),
	})

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		const form = new FormData(event.currentTarget)
		reset.mutate({
			otp: String(form.get("otp") ?? ""),
			newPassword: String(form.get("newPassword") ?? ""),
		})
	}

	return (
		<form onSubmit={onSubmit} noValidate>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="otp">Reset code</FieldLabel>
					<Input
						id="otp"
						name="otp"
						inputMode="numeric"
						autoComplete="one-time-code"
						required
					/>
				</Field>

				<Field>
					<FieldLabel htmlFor="newPassword">New password</FieldLabel>
					<Input
						id="newPassword"
						name="newPassword"
						type="password"
						autoComplete="new-password"
						required
						minLength={8}
					/>
					<FieldDescription>At least 8 characters.</FieldDescription>
				</Field>

				{error ? <FieldError>{error}</FieldError> : null}

				<Button type="submit" disabled={reset.isPending} className="w-full">
					{reset.isPending ? <Spinner /> : null}
					Set new password
				</Button>
			</FieldGroup>
		</form>
	)
}
