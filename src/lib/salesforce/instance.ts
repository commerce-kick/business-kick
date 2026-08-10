/**
 * The org's real API host, discovered at runtime.
 *
 * Every OAuth token response carries an `instance_url` naming the host that
 * token is actually valid against. Trusting it beats trusting configuration,
 * because a plausible-looking but wrong `SF_INSTANCE_URL` is easy to set and
 * produces a confusing failure:
 *
 *   - `https://login.salesforce.com` / `https://test.salesforce.com` are *login*
 *     hosts. Calling the Data API against them returns
 *     `URL_NOT_RESET: Destination URL not reset` rather than anything that
 *     points at the real cause.
 *   - A sandbox refresh changes the My Domain host, silently invalidating a
 *     hardcoded value.
 *
 * Discovery wins over config; config remains the fallback for the window before
 * the first token is issued.
 *
 * This module holds no credentials, so both `config.ts` and `auth/tokens.ts`
 * can depend on it without creating an import cycle between them.
 */

const LOGIN_HOSTS = new Set(["login.salesforce.com", "test.salesforce.com"])

let discovered: string | undefined

/** Record the `instance_url` from a token response. */
export function setDiscoveredInstanceUrl(url: string | undefined): void {
	if (!url) return
	try {
		const parsed = new URL(url)
		// Salesforce should never report a login host here, but refuse it anyway
		// rather than caching the exact value that causes URL_NOT_RESET.
		if (LOGIN_HOSTS.has(parsed.hostname)) return
		discovered = `${parsed.origin}`
	} catch {
		// Unparseable — keep whatever we had.
	}
}

export function getDiscoveredInstanceUrl(): string | undefined {
	return discovered
}
