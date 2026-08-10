import { getEnv } from "#/lib/env.server"
import { oauth } from "#/lib/salesforce/config"
import {
	SalesforceNetworkError,
	toSalesforceError,
} from "#/lib/salesforce/errors"
import { identityFetch } from "#/lib/salesforce/fetch"
import {
	getDiscoveredInstanceUrl,
	setDiscoveredInstanceUrl,
} from "#/lib/salesforce/instance"
import { explainAuthError, log, safeUrl } from "#/lib/salesforce/log"

import type { TokenSet } from "./session"

/**
 * Token acquisition and caching.
 *
 * Two independent concerns live here, and they are cached very differently:
 *
 *   - The **guest token** is process-wide. Every anonymous visitor shares one,
 *     held in memory with its expiry. It is never written to a cookie — it is
 *     an application credential, not a user credential.
 *
 *   - **User token refresh** is per refresh-token, and is guarded against
 *     stampedes. A single SSR render fans out several loader calls; without a
 *     guard they all see 401 simultaneously and each POSTs a refresh. Since
 *     Salesforce may rotate refresh tokens, the first response invalidates the
 *     token the others are still using and the buyer is logged out mid-render.
 */

interface RawTokenResponse {
	access_token?: string
	refresh_token?: string
	expires_in?: number | string
	issued_at?: string
	instance_url?: string
	id?: string
	error?: string
	error_description?: string
}

async function postForm(
	url: string,
	body: Record<string, string>,
	headers: Record<string, string> = {},
): Promise<RawTokenResponse> {
	const done = log.time(`token ${body.grant_type ?? "?"}`)
	// `log.*` redacts on the way out — passing the raw body here is correct.
	// Pre-redacting would double-scrub and print nonsense like "4908… 64) (len 18)".
	log.debug("token request", {
		url: safeUrl(url),
		...body,
	})

	let response: Response
	try {
		response = await identityFetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
				...headers,
			},
			body: new URLSearchParams(body).toString(),
		})
	} catch (cause) {
		log.error("token endpoint unreachable", {
			url: safeUrl(url),
			grant_type: body.grant_type,
			cause: cause instanceof Error ? cause.message : String(cause),
		})
		throw new SalesforceNetworkError(
			`Could not reach the Salesforce token endpoint at ${url}`,
			{ status: 0, cause },
		)
	}

	const text = await response.text()
	const parsed: unknown = text ? safeJsonParse(text) : {}

	if (!response.ok) {
		const failure = (parsed ?? {}) as {
			error?: string
			error_description?: string
		}

		log.error(`token request failed (HTTP ${response.status})`, {
			url: safeUrl(url),
			grant_type: body.grant_type,
			error: failure.error,
			error_description: failure.error_description,
		})

		// Print the specific admin action this error maps to, rather than
		// leaving "invalid_grant" to be reverse-engineered.
		const hint = explainAuthError(failure.error, failure.error_description)
		if (hint) log.error(`how to fix:\n  ${hint}`)

		throw toSalesforceError(
			response.status,
			parsed,
			response.headers.get("x-request-id") ?? undefined,
		)
	}

	done({ status: response.status })

	const raw = (parsed ?? {}) as RawTokenResponse

	// Salesforce is authoritative about which host this token is valid against.
	// Recording it here means every subsequent Data API call goes to the right
	// place even if SF_INSTANCE_URL is wrong or points at a login host.
	if (raw.instance_url) {
		const before = getDiscoveredInstanceUrl()
		setDiscoveredInstanceUrl(raw.instance_url)
		const after = getDiscoveredInstanceUrl()
		if (after && after !== before) {
			log.info("using instance_url reported by Salesforce", { instance: after })
		}
	}

	return raw
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return { message: text }
	}
}

function toTokenSet(raw: RawTokenResponse): TokenSet {
	if (!raw.access_token) {
		throw toSalesforceError(502, {
			errorCode: "INVALID_TOKEN_RESPONSE",
			message: "Salesforce returned a token response with no access_token.",
		})
	}
	const expiresIn =
		typeof raw.expires_in === "string"
			? Number.parseInt(raw.expires_in, 10)
			: raw.expires_in

	return {
		accessToken: raw.access_token,
		refreshToken: raw.refresh_token,
		expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
	}
}

// --------------------------------------------------------------------------
// Guest token
// --------------------------------------------------------------------------

interface CachedGuestToken {
	accessToken: string
	/** Epoch ms after which this token must not be used. */
	expiresAt: number
}

let guestToken: CachedGuestToken | undefined
let guestTokenInFlight: Promise<string> | undefined

/** Refresh this far before actual expiry, to absorb clock skew and latency. */
const GUEST_TOKEN_SKEW_MS = 60_000
/** Fallback lifetime when the org does not report `expires_in`. */
const GUEST_TOKEN_FALLBACK_MS = 15 * 60_000

/**
 * Client Credentials flow, bound to the Connected App's Run-As user.
 *
 * This is what powers guest catalog browsing, and therefore everything that
 * makes the storefront indexable. If it fails, public PLP/PDP pages cannot
 * render for a crawler.
 */
export async function getGuestToken(): Promise<string> {
	const now = Date.now()

	if (guestToken && guestToken.expiresAt > now) {
		return guestToken.accessToken
	}

	// Collapse concurrent misses onto one network call.
	if (guestTokenInFlight) return guestTokenInFlight

	guestTokenInFlight = (async () => {
		const env = getEnv()
		const mode = env.SF_GUEST_MODE

		log.info(`acquiring guest token (${mode})`, {
			host: safeUrl(oauth.token()),
			client_id: env.SF_CLIENT_ID,
		})

		let tokens: TokenSet

		if (mode === "guest_user") {
			// Runs as the Experience Cloud guest user: minimal permissions, and
			// tied to the store's guest buyer account so pricing can resolve.
			// Lazily imported to keep the headless wire formats out of this
			// module's dependency graph until they are actually used.
			const { guestUserLogin } = await import("./headless")
			tokens = await guestUserLogin()
		} else {
			tokens = toTokenSet(
				await postForm(oauth.token(), {
					grant_type: "client_credentials",
					client_id: env.SF_CLIENT_ID,
					client_secret: env.SF_CLIENT_SECRET,
				}),
			)
		}

		log.info("guest token acquired", { mode, expires_in: tokens.expiresIn })

		guestToken = {
			accessToken: tokens.accessToken,
			expiresAt:
				Date.now() +
				(tokens.expiresIn
					? tokens.expiresIn * 1000 - GUEST_TOKEN_SKEW_MS
					: GUEST_TOKEN_FALLBACK_MS),
		}
		return tokens.accessToken
	})()

	try {
		return await guestTokenInFlight
	} finally {
		guestTokenInFlight = undefined
	}
}

/** Drop the cached guest token — called when the org rejects it mid-flight. */
export function invalidateGuestToken(): void {
	guestToken = undefined
}

// --------------------------------------------------------------------------
// User token refresh
// --------------------------------------------------------------------------

const refreshInFlight = new Map<string, Promise<TokenSet>>()

/**
 * Exchange a refresh token for a new access token.
 *
 * Concurrent callers presenting the same refresh token share one request, so a
 * rotating refresh token is only ever spent once per render.
 */
export function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
	const existing = refreshInFlight.get(refreshToken)
	if (existing) return existing

	const env = getEnv()
	const promise = postForm(oauth.token(), {
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: env.SF_CLIENT_ID,
		client_secret: env.SF_CLIENT_SECRET,
	})
		.then(toTokenSet)
		.finally(() => {
			refreshInFlight.delete(refreshToken)
		})

	refreshInFlight.set(refreshToken, promise)
	return promise
}

/** Authorization-code exchange, used at the end of the headless login flow. */
export async function exchangeAuthorizationCode(opts: {
	code: string
	codeVerifier: string
	redirectUri: string
	/** Extra headers — the guest flow requires `Auth-Request-Type` + `Uvid-Hint`. */
	headers?: Record<string, string>
}): Promise<TokenSet> {
	const env = getEnv()
	const raw = await postForm(
		oauth.token(),
		{
			grant_type: "authorization_code",
			code: opts.code,
			code_verifier: opts.codeVerifier,
			client_id: env.SF_CLIENT_ID,
			client_secret: env.SF_CLIENT_SECRET,
			redirect_uri: opts.redirectUri,
		},
		opts.headers,
	)
	return toTokenSet(raw)
}

export async function revokeToken(token: string): Promise<void> {
	try {
		await postForm(oauth.revoke(), { token })
	} catch {
		// A failed revoke must not block logout. Cookies are cleared regardless,
		// so the buyer is logged out of this app either way.
	}
}

export { postForm as postTokenForm }
