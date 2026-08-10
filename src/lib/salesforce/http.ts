import {
	clearSession,
	readAccessToken,
	readEffectiveAccountId,
	readRefreshToken,
	writeTokens,
} from "./auth/session"
import {
	getGuestToken,
	invalidateGuestToken,
	refreshAccessToken,
} from "./auth/tokens"
import {
	SalesforceAuthError,
	SalesforceNetworkError,
	toSalesforceError,
} from "./errors"
import { explainAuthError, log, safeUrl } from "./log"

/**
 * The one place `fetch` is called against Salesforce.
 *
 * Everything above this module works in domain types; everything below it is
 * raw Connect REST. Centralising the call site is what makes token injection,
 * the 401 → refresh → replay dance, retry policy and error mapping consistent
 * rather than something each resource module reimplements slightly differently.
 */

export type AuthMode =
	/** Buyer token when signed in, guest token otherwise. The default. */
	| "auto"
	/** Always the shared guest token — used by the sitemap crawler. */
	| "guest"
	/** Require a signed-in buyer; throws rather than falling back to guest. */
	| "buyer"

export interface RequestOptions {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
	/** Query params; `undefined` and `null` values are dropped. */
	query?: Record<string, string | number | boolean | undefined | null>
	body?: unknown
	auth?: AuthMode
	/**
	 * Append `effectiveAccountId` when a buyer account is known. Required for
	 * anything account-scoped: pricing, entitlements, carts, orders.
	 */
	scopeToAccount?: boolean
	signal?: AbortSignal
	headers?: Record<string, string>
}

const MAX_RETRIES = 2
const RETRY_BASE_MS = 150

interface ResolvedAuth {
	token: string
	kind: "buyer" | "guest"
}

async function resolveAuth(mode: AuthMode): Promise<ResolvedAuth> {
	if (mode === "guest") {
		return { token: await getGuestToken(), kind: "guest" }
	}

	const buyerToken = readAccessToken()
	if (buyerToken) return { token: buyerToken, kind: "buyer" }

	if (mode === "buyer") {
		throw new SalesforceAuthError(
			"This request requires a signed-in buyer, but no session was found.",
			{ status: 401, errorCode: "NO_SESSION" },
		)
	}

	return { token: await getGuestToken(), kind: "guest" }
}

function buildUrl(
	url: string,
	query: RequestOptions["query"],
	scopeToAccount: boolean,
): string {
	const target = new URL(url)

	for (const [key, value] of Object.entries(query ?? {})) {
		if (value === undefined || value === null || value === "") continue
		target.searchParams.set(key, String(value))
	}

	if (scopeToAccount) {
		const accountId = readEffectiveAccountId()
		if (accountId && !target.searchParams.has("effectiveAccountId")) {
			target.searchParams.set("effectiveAccountId", accountId)
		}
	}

	return target.toString()
}

const isRetryableStatus = (status: number) =>
	status >= 500 || status === 429 || status === 408

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Issue a request against an absolute Salesforce URL.
 *
 * Resource modules build the URL from `config.ts` helpers and hand it here.
 */
export async function request<T>(
	url: string,
	options: RequestOptions = {},
): Promise<T> {
	const {
		method = "GET",
		query,
		body,
		auth = "auto",
		scopeToAccount = false,
		signal,
		headers: extraHeaders,
	} = options

	const target = buildUrl(url, query, scopeToAccount)
	// Only idempotent reads are safe to replay after a transport failure.
	const retryable = method === "GET"

	let authInfo = await resolveAuth(auth)
	let attempt = 0
	let hasReauthenticated = false

	log.debug(`${method} ${safeUrl(target)}`, { auth: authInfo.kind })
	const done = log.time(`${method} ${safeUrl(target)}`)

	for (;;) {
		let response: Response
		try {
			response = await fetch(target, {
				method,
				headers: {
					Authorization: `Bearer ${authInfo.token}`,
					Accept: "application/json",
					...(body !== undefined ? { "Content-Type": "application/json" } : {}),
					...extraHeaders,
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal,
			})
		} catch (cause) {
			if (signal?.aborted) throw cause
			if (retryable && attempt < MAX_RETRIES) {
				attempt += 1
				log.warn(`network error, retrying (${attempt}/${MAX_RETRIES})`, {
					url: safeUrl(target),
					cause: cause instanceof Error ? cause.message : String(cause),
				})
				await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
				continue
			}
			log.error("Salesforce unreachable", {
				url: safeUrl(target),
				cause: cause instanceof Error ? cause.message : String(cause),
			})
			throw new SalesforceNetworkError(
				`Could not reach Salesforce at ${target}`,
				{ status: 0, cause },
			)
		}

		if (response.ok) {
			done({ status: response.status, auth: authInfo.kind })
			return await readBody<T>(response)
		}

		const requestId = response.headers.get("x-request-id") ?? undefined
		const payload = await readErrorBody(response)

		const summary = summarizeError(payload)
		log.warn(`${method} ${safeUrl(target)} → HTTP ${response.status}`, {
			auth: authInfo.kind,
			requestId,
			payload: summary,
		})

		const hint = explainAuthError(undefined, summary)
		if (hint) log.error(`how to fix:\n  ${hint}`)

		// --- 401/403: re-authenticate exactly once, then replay once. ---
		if (
			(response.status === 401 || response.status === 403) &&
			!hasReauthenticated
		) {
			hasReauthenticated = true

			if (authInfo.kind === "guest") {
				// The shared guest token was revoked or expired early.
				log.info("guest token rejected, re-acquiring and replaying once")
				invalidateGuestToken()
				authInfo = { token: await getGuestToken(), kind: "guest" }
				continue
			}

			const refreshToken = readRefreshToken()
			if (refreshToken) {
				try {
					log.info("buyer token rejected, refreshing")
					const tokens = await refreshAccessToken(refreshToken)
					writeTokens(tokens)
					authInfo = { token: tokens.accessToken, kind: "buyer" }
					continue
				} catch (cause) {
					// The refresh token is spent or revoked — this session is over.
					log.warn("refresh failed, clearing session", {
						cause: cause instanceof Error ? cause.message : String(cause),
					})
					clearSession()
					throw toSalesforceError(401, payload, requestId)
				}
			}

			// A buyer token that fails with nothing to refresh from.
			log.warn("buyer token rejected with no refresh token; clearing session")
			clearSession()
			throw toSalesforceError(401, payload, requestId)
		}

		if (
			retryable &&
			isRetryableStatus(response.status) &&
			attempt < MAX_RETRIES
		) {
			attempt += 1
			log.warn(
				`HTTP ${response.status}, retrying (${attempt}/${MAX_RETRIES})`,
				{ url: safeUrl(target) },
			)
			const retryAfter = Number(response.headers.get("retry-after"))
			await sleep(
				Number.isFinite(retryAfter) && retryAfter > 0
					? retryAfter * 1000
					: RETRY_BASE_MS * 2 ** (attempt - 1),
			)
			continue
		}

		throw toSalesforceError(response.status, payload, requestId)
	}
}

async function readBody<T>(response: Response): Promise<T> {
	if (response.status === 204) return undefined as T
	const text = await response.text()
	if (!text) return undefined as T
	try {
		return JSON.parse(text) as T
	} catch (cause) {
		throw new SalesforceNetworkError(
			"Salesforce returned a response that was not valid JSON.",
			{ status: response.status, cause },
		)
	}
}

/** Compact a Salesforce error body down to something worth a log line. */
function summarizeError(payload: unknown): string {
	if (!payload) return "<empty>"
	const first = Array.isArray(payload) ? payload[0] : payload
	if (first && typeof first === "object") {
		const obj = first as Record<string, unknown>
		const code = obj.errorCode ?? obj.error
		const message = obj.message ?? obj.error_description
		return [code, message].filter(Boolean).join(": ") || JSON.stringify(first)
	}
	return String(payload)
}

async function readErrorBody(response: Response): Promise<unknown> {
	try {
		const text = await response.text()
		if (!text) return undefined
		try {
			return JSON.parse(text)
		} catch {
			return { message: text }
		}
	} catch {
		return undefined
	}
}
