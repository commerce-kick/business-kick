import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router"
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
import { registerFn, verifyRegistrationFn } from "#/server/auth.fn"

export const Route = createFileRoute("/register")({
	beforeLoad: ({ context }) => {
		if (context.session) throw redirect({ to: "/", replace: true })
	},
	head: () => seo({ title: "Create an account", index: false }),
	component: RegisterPage,
})

/**
 * Registration is two steps: create the user, then verify the emailed code.
 *
 * Many B2B orgs disable self-registration in favour of admin-provisioned
 * buyers. When that is the case Salesforce rejects step one, and the error
 * surfaces here rather than silently appearing to succeed.
 */
function RegisterPage() {
	const [identifier, setIdentifier] = useState<string | null>(null)
	const [email, setEmail] = useState("")

	return (
		<div className="mx-auto flex max-w-md flex-col justify-center px-6 py-20">
			<h1 className="text-2xl font-semibold tracking-tight">
				{identifier ? "Check your email" : "Create an account"}
			</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				{identifier
					? `We sent a verification code to ${email}.`
					: "Set up a business account to see contract pricing."}
			</p>

			<div className="mt-8">
				{identifier ? (
					<VerifyStep identifier={identifier} />
				) : (
					<DetailsStep
						onSent={(id, sentTo) => {
							setIdentifier(id)
							setEmail(sentTo)
						}}
					/>
				)}
			</div>

			{!identifier ? (
				<p className="mt-6 text-sm text-muted-foreground">
					Already have an account?{" "}
					<Link
						to="/login"
						search={{ redirect: undefined }}
						className="underline underline-offset-4 hover:text-foreground"
					>
						Sign in
					</Link>
				</p>
			) : null}
		</div>
	)
}

function DetailsStep({
	onSent,
}: {
	onSent: (identifier: string, email: string) => void
}) {
	const [error, setError] = useState<string | null>(null)

	const register = useMutation({
		mutationFn: (data: {
			email: string
			firstName: string
			lastName: string
			password: string
		}) => registerFn({ data }),
		onSuccess: (result, variables) =>
			onSent(result.identifier, variables.email),
		onError: (err: Error) =>
			setError(
				err.message ||
					"We couldn't create that account. Your organization may require an administrator to set it up.",
			),
	})

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		const form = new FormData(event.currentTarget)
		register.mutate({
			email: String(form.get("email") ?? ""),
			firstName: String(form.get("firstName") ?? ""),
			lastName: String(form.get("lastName") ?? ""),
			password: String(form.get("password") ?? ""),
		})
	}

	return (
		<form onSubmit={onSubmit} noValidate>
			<FieldGroup>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field>
						<FieldLabel htmlFor="firstName">First name</FieldLabel>
						<Input
							id="firstName"
							name="firstName"
							autoComplete="given-name"
							required
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="lastName">Last name</FieldLabel>
						<Input
							id="lastName"
							name="lastName"
							autoComplete="family-name"
							required
						/>
					</Field>
				</div>

				<Field>
					<FieldLabel htmlFor="email">Work email</FieldLabel>
					<Input
						id="email"
						name="email"
						type="email"
						autoComplete="email"
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
						autoComplete="new-password"
						required
						minLength={8}
					/>
					<FieldDescription>At least 8 characters.</FieldDescription>
				</Field>

				{error ? <FieldError>{error}</FieldError> : null}

				<Button type="submit" disabled={register.isPending} className="w-full">
					{register.isPending ? <Spinner /> : null}
					Create account
				</Button>
			</FieldGroup>
		</form>
	)
}

function VerifyStep({ identifier }: { identifier: string }) {
	const router = useRouter()
	const queryClient = useQueryClient()
	const [error, setError] = useState<string | null>(null)

	const verify = useMutation({
		mutationFn: (otp: string) =>
			verifyRegistrationFn({ data: { identifier, otp } }),
		onSuccess: async () => {
			queryClient.clear()
			await router.invalidate()
			await router.navigate({ to: "/", replace: true })
		},
		onError: (err: Error) =>
			setError(err.message || "That code wasn't right. Please try again."),
	})

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		const form = new FormData(event.currentTarget)
		verify.mutate(String(form.get("otp") ?? ""))
	}

	return (
		<form onSubmit={onSubmit} noValidate>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="otp">Verification code</FieldLabel>
					<Input
						id="otp"
						name="otp"
						inputMode="numeric"
						autoComplete="one-time-code"
						required
					/>
				</Field>

				{error ? <FieldError>{error}</FieldError> : null}

				<Button type="submit" disabled={verify.isPending} className="w-full">
					{verify.isPending ? <Spinner /> : null}
					Verify and continue
				</Button>
			</FieldGroup>
		</form>
	)
}
