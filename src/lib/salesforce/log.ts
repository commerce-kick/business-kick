/**
 * SDK logging.
 *
 * Server-side only. The point of this module is that a Salesforce failure
 * should be diagnosable from the terminal without attaching a debugger — which
 * matters most for auth, where the useful detail (which host was called, which
 * grant, which `error_description`) is exactly the detail a generic
 * "authentication failed" swallows.
 *
 * Enable with `SF_DEBUG=1` in `.env`. Errors are always logged regardless.
 *
 * ── Redaction ───────────────────────────────────────────────────────────────
 * Tokens, secrets and passwords are scrubbed before anything is printed. Logs
 * end up in terminals, CI output and log aggregators; a client secret or a
 * refresh token that reaches any of those is a credential leak that outlives
 * the debugging session that caused it.
 */

const SENSITIVE_KEYS = new Set([
	"access_token",
	"refresh_token",
	"client_secret",
	// The consumer key is not strictly secret, but it identifies the app and
	// there is no reason to spill 85 characters of it into every log line.
	"client_id",
	"password",
	"code",
	"code_verifier",
	"otp",
	"newpassword",
	"userdata",
	"authorization",
	"token",
	"assertion",
	"id_token",
])

function isDebug(): boolean {
	const flag = process.env.SF_DEBUG
	return flag === "1" || flag === "true"
}

/** Keep enough of a value to correlate it, never enough to use it. */
export function redact(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) return "<empty>"
	if (value.length <= 8) return "<redacted>"
	return `${value.slice(0, 4)}…${value.slice(-4)} (len ${value.length})`
}

/** Scrub a params/body object for logging. */
export function safeParams(
	input: Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (!input) return {}
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(input)) {
		out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
			? redact(String(value))
			: value
	}
	return out
}

/**
 * Strip the query string but keep the path.
 *
 * Salesforce puts `effectiveAccountId` and search terms in the query, and URLs
 * are the most likely place for a token to leak into a log line.
 */
export function safeUrl(url: string): string {
	try {
		const parsed = new URL(url)
		return `${parsed.origin}${parsed.pathname}`
	} catch {
		return url
	}
}

const prefix = "[salesforce]"

export const log = {
	debug(message: string, detail?: Record<string, unknown>) {
		if (!isDebug()) return
		console.log(`${prefix} ${message}`, detail ? safeParams(detail) : "")
	},

	info(message: string, detail?: Record<string, unknown>) {
		if (!isDebug()) return
		console.info(`${prefix} ${message}`, detail ? safeParams(detail) : "")
	},

	warn(message: string, detail?: Record<string, unknown>) {
		console.warn(`${prefix} ${message}`, detail ? safeParams(detail) : "")
	},

	error(message: string, detail?: Record<string, unknown>) {
		console.error(`${prefix} ${message}`, detail ? safeParams(detail) : "")
	},

	/** Timer for a single API call. Returns a function that logs the duration. */
	time(label: string): (extra?: Record<string, unknown>) => void {
		const start = performance.now()
		return (extra) => {
			if (!isDebug()) return
			const ms = Math.round(performance.now() - start)
			console.log(
				`${prefix} ${label} — ${ms}ms`,
				extra ? safeParams(extra) : "",
			)
		}
	},
}

/**
 * Turn a Salesforce auth error into an actionable message.
 *
 * These four `error_description` strings account for nearly every failed
 * headless setup, and each maps to a specific, non-obvious admin action that
 * the raw text does not hint at. Printing the fix next to the error saves
 * working backwards from "invalid_grant".
 */
export function explainAuthError(
	errorCode: string | undefined,
	description: string | undefined,
): string | undefined {
	const text = `${errorCode ?? ""} ${description ?? ""}`.toLowerCase()

	if (text.includes("no client credentials user enabled")) {
		return [
			"The Connected App has the Client Credentials flow enabled but no Run-As user.",
			"Fix: Setup → App Manager → your Connected App → Edit Policies →",
			"  OAuth Policies → 'Enable Client Credentials Flow' must be checked, and",
			"  'Run As' must name a user with access to the store's catalog.",
			"Note: after saving, Salesforce can take several minutes to propagate.",
		].join("\n  ")
	}

	if (
		text.includes("url_not_reset") ||
		text.includes("destination url not reset")
	) {
		return [
			"SF_INSTANCE_URL points at a LOGIN host (login.salesforce.com or",
			"test.salesforce.com) rather than the org's API host. Those hosts",
			"authenticate; they do not serve the Data API.",
			"Fix: set SF_INSTANCE_URL to the My Domain URL, e.g.",
			"  https://<mydomain>.my.salesforce.com",
			"It is the `instance_url` returned in the token response.",
		].join("\n  ")
	}

	if (
		text.includes("api_currently_disabled") ||
		text.includes("api is disabled")
	) {
		return [
			"This user lacks the 'API Enabled' permission.",
			"Minimum Access profiles do not include it — and neither does",
			"'Customer Community Plus Login User', so BUYERS need it granted too,",
			"not just the integration/Run-As user.",
			"Fix: Setup → Permission Sets → your storefront set → System Permissions",
			"  → tick 'API Enabled', and confirm the set is assigned to the user.",
			"Also confirm the user is a member of the Experience site, or the",
			"commerce endpoints will 404 once this is granted.",
		].join("\n  ")
	}

	if (text.includes("guest flow not enabled")) {
		return [
			"SF_GUEST_MODE=guest_user, but the app does not allow the guest flow.",
			"Fix: External Client App Manager → your app → Policies → Edit →",
			"  OAuth Flows → tick 'Enable Code and Credentials Flow for Guest Users'.",
			"Toggling 'Enable Client Credentials Flow' can clear this one, so",
			"re-check it after any change to the other flow.",
		].join("\n  ")
	}

	if (text.includes("invalid_iss")) {
		return [
			"A guest JWT was sent to the org host. Guest tokens are issued by the",
			"Experience Cloud site and are only valid against it.",
			"Fix: commerce calls must target SF_EXPERIENCE_SITE_URL when",
			"  SF_GUEST_MODE=guest_user. `instanceUrl()` in config.ts handles this.",
		].join("\n  ")
	}

	if (text.includes("can't access this account")) {
		return [
			"Most likely: the buyer user is missing Salesforce's preconfigured",
			"**Buyer** permission set. Object-level read access and buyer-group",
			"membership are NOT sufficient on their own — B2B Commerce requires the",
			"Buyer permission set (and its Commerce permission set license) before a",
			"named user can transact against a store.",
			"Fix: Setup → Permission Sets → 'Buyer' → Manage Assignments → add the user.",
			"",
			"If that is already assigned, check in order:",
			"  1. Sign out and back in — clears a stale `sf_ea` cookie.",
			"  2. The buyer's Account is enabled as a Buyer Account and sits in a",
			"     Buyer Group that is assigned to the WebStore with an entitlement policy.",
			"",
			"Note the asymmetry: guest browsing can work fine while this fails, because",
			"the guest buyer profile is handled by the platform rather than by a",
			"permission set.",
		].join("\n  ")
	}

	if (text.includes("insufficient_access")) {
		return [
			"Authenticated, but this user has no commerce access.",
			"",
			"If the failing call ran as GUEST:",
			"  1. Commerce app → your store → Administration → enable Guest Browsing.",
			"  2. Assign a guest Buyer Group + entitlement policy (and a price book",
			"     if guest prices are wanted).",
			"  3. Guest user profile needs read on Product2, ProductCategory, WebStore.",
			"",
			"If it ran as BUYER (check the `auth` field on the log line above):",
			"  1. The buyer's Account must be a Buyer Account, in a Buyer Group that",
			"     is assigned to the WebStore, with an entitlement policy.",
			"  2. The buyer's profile needs the same object read access.",
		].join("\n  ")
	}

	if (text.includes("no valid scopes defined")) {
		return [
			"The app's Selected OAuth Scopes contain nothing valid for this flow.",
			"'Full access (full)' is NOT accepted for the Client Credentials flow —",
			"it needs an explicit scope. The `scope` request parameter is rejected",
			"outright, so this can only be fixed on the app itself.",
			"Fix: External Client App Manager → your app → OAuth Settings → Edit →",
			"  add 'Manage user data via APIs (api)' to Selected OAuth Scopes, and",
			"  add 'Perform requests at any time (refresh_token, offline_access)'",
			"  so the org will issue refresh tokens for the buyer login flow.",
		].join("\n  ")
	}

	if (
		text.includes("invalid_app_access") ||
		text.includes("not admin approved")
	) {
		return [
			"Permitted Users is set to 'Admin approved users are pre-authorized',",
			"but the Run-As user has not been granted access to the app.",
			"",
			"Either grant access (recommended — this setting is the stricter one):",
			"  External Client App Manager → your app → Policies → Plugin Policies",
			"  → note Permitted Users, then assign the Run-As user's Profile or a",
			"  Permission Set to the app under 'Manage Profiles' / 'Manage",
			"  Permission Sets'.",
			"",
			"Or relax it:",
			"  set Permitted Users back to 'All users can self-authorize'.",
		].join("\n  ")
	}

	if (text.includes("invalid_client") || text.includes("invalid client")) {
		return "SF_CLIENT_ID / SF_CLIENT_SECRET do not match a Connected App on this host. Check you are pointing at the right org and that the consumer secret was copied in full."
	}

	if (text.includes("inactive user") || text.includes("user is inactive")) {
		return "The Run-As user (or the buyer signing in) is inactive in this org."
	}

	if (text.includes("ip restricted") || text.includes("ip address")) {
		return "The Connected App's IP relaxation policy is blocking this server. Set 'Relax IP restrictions' on the Connected App, or allowlist the server's IP."
	}

	if (text.includes("unsupported_grant_type")) {
		return "This grant type is not enabled on the Connected App. Client Credentials and Refresh Token must both be permitted under OAuth Policies."
	}

	return undefined
}
