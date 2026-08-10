import {
	deleteCookie,
	getCookie,
	setCookie,
} from "@tanstack/react-start/server"

import { isProduction } from "#/lib/env.server"

/**
 * Cookie-backed session.
 *
 * Every cookie here is httpOnly, including the user projection — the client
 * never reads auth state from `document.cookie`. Session reaches the UI through
 * router context instead (see the root route's `beforeLoad`), which avoids both
 * a loading waterfall and a flash of logged-out chrome on first paint.
 */

export const COOKIE = {
	accessToken: "sf_at",
	refreshToken: "sf_rt",
	effectiveAccount: "sf_ea",
	user: "sf_u",
} as const

/** Non-sensitive projection of the buyer, safe to hand to the UI. */
export interface SessionUser {
	userId: string
	username: string
	email?: string
	displayName?: string
}

export interface Session {
	user: SessionUser
	/** B2B buyer account this session transacts as. */
	effectiveAccountId?: string
}

export interface TokenSet {
	accessToken: string
	refreshToken?: string
	/** Seconds until the access token expires, when the org reports it. */
	expiresIn?: number
}

function baseCookieOptions() {
	return {
		httpOnly: true,
		// Conditioned so local http://localhost development still works.
		secure: isProduction(),
		sameSite: "lax" as const,
		path: "/",
	}
}

export function readAccessToken(): string | undefined {
	return getCookie(COOKIE.accessToken)
}

export function readRefreshToken(): string | undefined {
	return getCookie(COOKIE.refreshToken)
}

export function readEffectiveAccountId(): string | undefined {
	return getCookie(COOKIE.effectiveAccount)
}

export function readSession(): Session | null {
	const raw = getCookie(COOKIE.user)
	if (!raw) return null

	// A token without a user projection is not a usable session.
	if (!readAccessToken()) return null

	try {
		const user = JSON.parse(
			Buffer.from(raw, "base64url").toString("utf8"),
		) as SessionUser
		if (!user?.userId) return null
		return { user, effectiveAccountId: readEffectiveAccountId() }
	} catch {
		// Corrupt or truncated cookie — treat as logged out rather than 500.
		return null
	}
}

export function writeTokens(tokens: TokenSet): void {
	const opts = baseCookieOptions()

	// Access token cookie deliberately outlives the token itself by a margin:
	// expiry is discovered via a 401 and handled by the refresh path, which is
	// more reliable than trusting clock skew between the org and this server.
	setCookie(COOKIE.accessToken, tokens.accessToken, {
		...opts,
		maxAge: tokens.expiresIn ? tokens.expiresIn + 300 : undefined,
	})

	// Salesforce may rotate the refresh token; only overwrite when a new one
	// actually arrives, otherwise a refresh response without one logs the
	// buyer out on their next request.
	if (tokens.refreshToken) {
		setCookie(COOKIE.refreshToken, tokens.refreshToken, {
			...opts,
			maxAge: 60 * 60 * 24 * 90,
		})
	}
}

export function writeSession(
	user: SessionUser,
	effectiveAccountId?: string,
): void {
	const opts = baseCookieOptions()

	setCookie(
		COOKIE.user,
		Buffer.from(JSON.stringify(user), "utf8").toString("base64url"),
		{ ...opts, maxAge: 60 * 60 * 24 * 90 },
	)

	if (effectiveAccountId) {
		setCookie(COOKIE.effectiveAccount, effectiveAccountId, {
			...opts,
			maxAge: 60 * 60 * 24 * 90,
		})
	}
}

export function clearSession(): void {
	const opts = baseCookieOptions()
	for (const name of Object.values(COOKIE)) {
		deleteCookie(name, opts)
	}
}
