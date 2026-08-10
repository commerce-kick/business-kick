import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import {
	headlessForgotPassword,
	headlessLogin,
	headlessRegisterInit,
	headlessResetPassword,
	headlessVerifyOtp,
} from "#/lib/salesforce/auth/headless"
import type { Session } from "#/lib/salesforce/auth/session"
import {
	clearSession,
	readAccessToken,
	readRefreshToken,
	readSession,
	writeSession,
	writeTokens,
} from "#/lib/salesforce/auth/session"
import { revokeToken } from "#/lib/salesforce/auth/tokens"
import {
	getUserInfo,
	listBuyerAccounts,
} from "#/lib/salesforce/resources/account"

/**
 * Auth server functions — the only door between the browser and the SDK.
 *
 * The browser POSTs to this app's own origin; credentials, tokens and the
 * Connected App secret never leave the server.
 */

/**
 * Only same-origin, path-absolute destinations may be redirected to after
 * login. Without this check `?redirect=https://evil.example` turns the login
 * form into an open redirect — a phishing primitive, and one that inherits the
 * trust of a page users have just typed a password into.
 */
function safeRedirect(target: string | undefined, fallback = "/"): string {
	if (!target) return fallback
	// Reject scheme-relative ("//host") and absolute ("https://host") targets.
	if (!target.startsWith("/") || target.startsWith("//")) return fallback
	if (target.includes("\\")) return fallback
	return target
}

const loginSchema = z.object({
	username: z.string().min(1, "Enter your email address."),
	password: z.string().min(1, "Enter your password."),
	redirect: z.string().optional(),
})

const registerSchema = z.object({
	email: z.email("Enter a valid email address."),
	firstName: z.string().min(1, "Enter your first name."),
	lastName: z.string().min(1, "Enter your last name."),
	password: z.string().min(8, "Use at least 8 characters."),
})

const verifySchema = z.object({
	identifier: z.string().min(1),
	otp: z.string().min(4, "Enter the code from your email."),
})

const forgotSchema = z.object({
	username: z.email("Enter a valid email address."),
})

const resetSchema = z.object({
	username: z.email(),
	otp: z.string().min(4, "Enter the code from your email."),
	newPassword: z.string().min(8, "Use at least 8 characters."),
	identifier: z.string().optional(),
})

/**
 * Read the current session from cookies.
 *
 * Cheap by design — it reads a cookie rather than calling Salesforce, so the
 * root route can resolve it on every navigation without spending API quota.
 */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
	async (): Promise<Session | null> => readSession(),
)

/** Establish the buyer's identity and account context after a token exchange. */
async function establishSession(accessToken: string): Promise<Session> {
	const user = await getUserInfo(accessToken)

	// A buyer may act for several accounts; the first is a sane default and the
	// account switcher can repoint it later.
	const accounts = await listBuyerAccounts().catch(() => [])
	const effectiveAccountId = accounts[0]?.id

	writeSession(user, effectiveAccountId)
	return { user, effectiveAccountId }
}

export const loginFn = createServerFn({ method: "POST" })
	.validator(loginSchema)
	.handler(async ({ data }) => {
		const tokens = await headlessLogin({
			username: data.username,
			password: data.password,
		})

		writeTokens(tokens)
		const session = await establishSession(tokens.accessToken)

		return { session, redirect: safeRedirect(data.redirect) }
	})

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
	const accessToken = readAccessToken()
	const refreshToken = readRefreshToken()

	// Revoke the refresh token where possible so the grant dies server-side too,
	// not just in this browser.
	if (refreshToken) await revokeToken(refreshToken)
	else if (accessToken) await revokeToken(accessToken)

	clearSession()
	return { ok: true as const }
})

export const registerFn = createServerFn({ method: "POST" })
	.validator(registerSchema)
	.handler(async ({ data }) => {
		const { identifier } = await headlessRegisterInit(data)
		// The buyer is not signed in yet — a verification code is on its way.
		return { identifier }
	})

export const verifyRegistrationFn = createServerFn({ method: "POST" })
	.validator(verifySchema)
	.handler(async ({ data }) => {
		const tokens = await headlessVerifyOtp(data)
		writeTokens(tokens)
		const session = await establishSession(tokens.accessToken)
		return { session }
	})

export const forgotPasswordFn = createServerFn({ method: "POST" })
	.validator(forgotSchema)
	.handler(async ({ data }) => {
		const result = await headlessForgotPassword(data).catch(() => ({
			identifier: undefined,
		}))
		// Always reports success. Reflecting whether the address exists would
		// make this endpoint an account-enumeration oracle.
		return { identifier: result.identifier, ok: true as const }
	})

export const resetPasswordFn = createServerFn({ method: "POST" })
	.validator(resetSchema)
	.handler(async ({ data }) => {
		await headlessResetPassword({
			username: data.username,
			newPassword: data.newPassword,
			otp: data.otp,
			identifier: data.identifier,
		})
		return { ok: true as const }
	})

/** Repoint the session at a different buyer account. */
export const setEffectiveAccountFn = createServerFn({ method: "POST" })
	.validator(z.object({ accountId: z.string().min(15) }))
	.handler(async ({ data }) => {
		const session = readSession()
		if (!session) {
			throw new Error("You need to be signed in to switch accounts.")
		}
		writeSession(session.user, data.accountId)
		return { ok: true as const }
	})
