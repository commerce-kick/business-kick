import { createHash, randomBytes, randomUUID } from "node:crypto"

import { getEnv } from "#/lib/env.server"
import { oauth } from "#/lib/salesforce/config"
import {
	SalesforceAuthError,
	SalesforceNetworkError,
	toSalesforceError,
} from "#/lib/salesforce/errors"
import { identityFetch } from "#/lib/salesforce/fetch"
import type { TokenSet } from "./session"
import { exchangeAuthorizationCode } from "./tokens"

/**
 * Salesforce Headless Identity API.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERIFY AGAINST THE ORG BEFORE TRUSTING THIS FILE.
 *
 * Every wire-format detail of the headless flows lives here, deliberately, and
 * nowhere else. These endpoints, header names and grant-type URNs have shifted
 * between Salesforce releases, and the exact shapes below reflect the commonly
 * documented contract rather than a response captured from *your* org.
 *
 * When a flow misbehaves, the fix belongs in this file — no caller above it
 * knows anything about `Auth-Request-Type` or base64-encoded inputs.
 *
 * Endpoints used:
 *   POST /services/oauth2/authorize                    (login, code_credentials)
 *   POST /services/auth/headless/init/registration     (registration)
 *   POST /services/auth/headless/forgot_password       (forgot)
 *   POST /services/auth/headless/reset_password        (reset)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * PKCE is required by the headless login flow and is worth keeping even though
 * the exchange happens server-to-server: it binds the authorization code to
 * this specific request, so a leaked code alone is not usable.
 */
interface Pkce {
	verifier: string
	challenge: string
}

function createPkce(): Pkce {
	const verifier = randomBytes(64).toString("base64url")
	const challenge = createHash("sha256").update(verifier).digest("base64url")
	return { verifier, challenge }
}

/**
 * The headless flows never actually redirect a browser here, but Salesforce
 * still validates the value against the Connected App's callback allowlist —
 * so it must be registered there even though nothing is ever served from it.
 */
function redirectUri(): string {
	return `${getEnv().VITE_PUBLIC_SITE_URL.replace(/\/+$/, "")}/auth/callback`
}

async function postHeadless<T>(
	url: string,
	body: unknown,
	headers: Record<string, string>,
	form = false,
): Promise<T> {
	let response: Response
	try {
		response = await identityFetch(url, {
			method: "POST",
			// `manual` is essential, not a detail. The authorize endpoint answers
			// with a 302 carrying `?code=…` in the Location header; following it
			// would send the authorization code to the callback URL and leave us
			// with an empty body and no way to read it back.
			redirect: "manual",
			headers: {
				"Content-Type": form
					? "application/x-www-form-urlencoded"
					: "application/json",
				Accept: "application/json",
				...headers,
			},
			body: form
				? new URLSearchParams(body as Record<string, string>).toString()
				: JSON.stringify(body),
		})
	} catch (cause) {
		throw new SalesforceNetworkError(
			`Could not reach the Salesforce identity endpoint at ${url}`,
			{ status: 0, cause },
		)
	}

	// A 3xx here is success: the authorization code rides in the Location query
	// string rather than a JSON body. Normalise it into the same shape callers
	// expect from the JSON responses.
	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location")
		const code = location
			? new URL(location, url).searchParams.get("code")
			: null

		if (code) {
			return {
				code,
				sfdc_community_url:
					new URL(location as string, url).searchParams.get(
						"sfdc_community_url",
					) ?? undefined,
			} as T
		}

		throw toSalesforceError(response.status, {
			errorCode: "NO_AUTHORIZATION_CODE",
			message: `Salesforce redirected without an authorization code (${location ?? "no location header"}).`,
		})
	}

	const text = await response.text()
	let parsed: unknown = {}
	if (text) {
		try {
			parsed = JSON.parse(text)
		} catch {
			parsed = { message: text }
		}
	}

	if (!response.ok) {
		throw toSalesforceError(
			response.status,
			parsed,
			response.headers.get("x-request-id") ?? undefined,
		)
	}

	return parsed as T
}

// --------------------------------------------------------------------------
// Login
// --------------------------------------------------------------------------

interface AuthorizeResponse {
	code?: string
	sfdc_community_url?: string
	sfdc_community_id?: string
	error?: string
	error_description?: string
}

/**
 * Headless Login: username + password exchanged for an authorization code,
 * then immediately for tokens. The buyer never leaves the storefront.
 */
export async function headlessLogin(input: {
	username: string
	password: string
}): Promise<TokenSet> {
	const env = getEnv()
	const pkce = createPkce()

	const authorize = await postHeadless<AuthorizeResponse>(
		oauth.authorize(),
		{
			response_type: "code_credentials",
			client_id: env.SF_CLIENT_ID,
			redirect_uri: redirectUri(),
			username: input.username,
			password: input.password,
			code_challenge: pkce.challenge,
		},
		{ "Auth-Request-Type": "Named-User" },
		// This endpoint expects form encoding, unlike the /headless/* endpoints.
		true,
	)

	if (!authorize.code) {
		// Deliberately generic: distinguishing "no such user" from "wrong
		// password" here would turn the login form into an account enumerator.
		throw new SalesforceAuthError("That email or password is not correct.", {
			status: 401,
			errorCode: authorize.error ?? "INVALID_CREDENTIALS",
		})
	}

	return exchangeAuthorizationCode({
		code: authorize.code,
		codeVerifier: pkce.verifier,
		redirectUri: redirectUri(),
	})
}

// --------------------------------------------------------------------------
// Guest user
// --------------------------------------------------------------------------

/**
 * A stable "unique visitor id" for this server process.
 *
 * Salesforce's guest flow models the caller as a visitor. Because this token is
 * a single process-wide credential shared by every anonymous request — not a
 * per-person session — one id per process is the honest representation. Minting
 * a fresh id per request would inflate Salesforce's visitor metrics and defeat
 * the token cache.
 */
let processUvid: string | undefined

function guestUvid(): string {
	if (!processUvid) processUvid = randomUUID()
	return processUvid
}

/**
 * Obtain a token as the Experience Cloud **guest user**.
 *
 * Preferred over Client Credentials for anonymous catalog traffic:
 *
 *   - It runs as the site's purpose-built guest user, which carries minimal
 *     permissions. Client Credentials runs as a named Run-As user, and if that
 *     user is over-privileged then every anonymous request — and everything a
 *     crawler indexes — inherits their visibility.
 *   - The guest user is tied to the store's guest buyer account, so guest
 *     pricing can resolve instead of 403-ing.
 *
 * Requires "Enable Code and Credentials Flow for Guest Users" on the app.
 *
 * ── The contract, confirmed against the docs and a live org ─────────────────
 * The UVID is carried as `Uvid-Hint`, NOT as a `uvid` parameter — that mistake
 * costs a long detour, because Salesforce answers every wrong shape with the
 * same `invalid_request: uvid invalid`, including when the value is omitted
 * entirely. So the error says nothing about which part is wrong.
 *
 * Specifics that matter:
 *   - `Auth-Request-Type: guest` (lowercase).
 *   - Authorize step: `Uvid-Hint: UVID <v4-uuid>` — the literal `UVID ` prefix
 *     is required, and marks the value as a raw id rather than a JWT.
 *   - Token step: `Uvid-Hint: <v4-uuid>` — same id, **no** prefix.
 *   - `scope` is required; `openid` is the documented minimum.
 *   - The UVID is generated by this app, never by Salesforce, and nothing is
 *     persisted org-side. The resulting token carries `sub: uvid:<value>`.
 *
 * @see https://help.salesforce.com/s/articleView?id=sf.remoteaccess_headless_guest_private_client.htm
 */
export async function guestUserLogin(): Promise<TokenSet> {
	const env = getEnv()
	const pkce = createPkce()
	const uvid = guestUvid()

	const authorize = await postHeadless<AuthorizeResponse>(
		oauth.authorize(),
		{
			response_type: "code_credentials",
			client_id: env.SF_CLIENT_ID,
			redirect_uri: redirectUri(),
			code_challenge: pkce.challenge,
			// `api` — NOT `openid`, which the docs suggest. The scope must be one
			// the app actually carries in Selected OAuth Scopes; anything else is
			// rejected with `invalid_scope`. Verified against a live org: `api`
			// and `refresh_token` are accepted, while `openid`, `web` and even
			// `full` are not.
			scope: "api",
		},
		{
			"Auth-Request-Type": "guest",
			"Uvid-Hint": `UVID ${uvid}`,
		},
		true,
	)

	if (!authorize.code) {
		throw new SalesforceAuthError(
			"Salesforce did not return a guest authorization code.",
			{
				status: 401,
				errorCode: authorize.error ?? "GUEST_AUTHORIZE_FAILED",
			},
		)
	}

	return exchangeAuthorizationCode({
		code: authorize.code,
		codeVerifier: pkce.verifier,
		redirectUri: redirectUri(),
		// Note the asymmetry: the token step wants the bare id, while the
		// authorize step above wants it prefixed with `UVID `.
		headers: {
			"Auth-Request-Type": "guest",
			"Uvid-Hint": uvid,
		},
	})
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

export interface RegistrationInput {
	email: string
	firstName: string
	lastName: string
	password?: string
}

export interface RegistrationInitResult {
	/** Opaque handle threaded into the verification step. */
	identifier: string
}

/**
 * Step 1 of registration: create the user and dispatch a verification code.
 *
 * Self-registration must be enabled on the Experience Cloud site, and B2B orgs
 * frequently disable it in favour of admin-provisioned buyers — in which case
 * this returns an error and the UI should point people at a "request access"
 * path instead.
 */
export async function headlessRegisterInit(
	input: RegistrationInput,
): Promise<RegistrationInitResult> {
	const response = await postHeadless<{ identifier?: string }>(
		oauth.headless("init/registration"),
		{
			requestType: "Register",
			// Salesforce expects the profile payload base64-encoded.
			userData: Buffer.from(
				JSON.stringify({
					email: input.email,
					firstName: input.firstName,
					lastName: input.lastName,
					...(input.password ? { password: input.password } : {}),
				}),
				"utf8",
			).toString("base64"),
		},
		{
			"Auth-Request-Type": "user-registration",
			"Auth-Verification-Type": "email",
		},
	)

	if (!response.identifier) {
		throw new SalesforceAuthError(
			"Salesforce did not return a registration identifier.",
			{ status: 502, errorCode: "REGISTRATION_INIT_FAILED" },
		)
	}

	return { identifier: response.identifier }
}

/**
 * Step 2 of registration: exchange the emailed one-time code for tokens, so a
 * newly registered buyer lands signed in rather than at the login form.
 */
export async function headlessVerifyOtp(input: {
	identifier: string
	otp: string
}): Promise<TokenSet> {
	const env = getEnv()

	const raw = await postHeadless<{
		access_token?: string
		refresh_token?: string
		expires_in?: number | string
	}>(
		oauth.token(),
		{
			grant_type: "urn:ietf:params:oauth:grant-type:otp",
			client_id: env.SF_CLIENT_ID,
			client_secret: env.SF_CLIENT_SECRET,
			identifier: input.identifier,
			otp: Buffer.from(input.otp, "utf8").toString("base64"),
		},
		{},
		true,
	)

	if (!raw.access_token) {
		throw new SalesforceAuthError("That verification code is not valid.", {
			status: 401,
			errorCode: "INVALID_OTP",
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
// Forgot / reset password
// --------------------------------------------------------------------------

export async function headlessForgotPassword(input: {
	username: string
}): Promise<{ identifier?: string }> {
	const env = getEnv()
	return postHeadless<{ identifier?: string }>(
		oauth.headless("forgot_password"),
		{ username: input.username, clientid: env.SF_CLIENT_ID },
		{},
	)
}

export async function headlessResetPassword(input: {
	username: string
	newPassword: string
	otp: string
	identifier?: string
}): Promise<void> {
	const env = getEnv()
	await postHeadless(
		oauth.headless("reset_password"),
		{
			username: input.username,
			newpassword: Buffer.from(input.newPassword, "utf8").toString("base64"),
			otp: input.otp,
			clientid: env.SF_CLIENT_ID,
			...(input.identifier ? { identifier: input.identifier } : {}),
		},
		{},
	)
}
