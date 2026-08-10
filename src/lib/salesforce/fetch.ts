import { Agent, fetch as undiciFetch } from "undici"

/**
 * HTTP/2-capable fetch for Salesforce **identity** endpoints.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * Salesforce's headless guest flow only works over HTTP/2. Node's global
 * `fetch` speaks HTTP/1.1 by default, and over 1.1 the token exchange fails
 * with `invalid_request: uvid invalid` — an error that points at the UVID and
 * says nothing about the transport. The same request over HTTP/2 succeeds with
 * byte-identical headers and body.
 *
 * Verified directly:
 *
 *   curl --http2    → 200, access token issued
 *   curl --http1.1  → 400, "uvid invalid"
 *
 * So this is not a nicety. Without `allowH2`, guest browsing cannot work, and
 * the failure is actively misleading about its own cause.
 *
 * Scoped to identity calls deliberately: the Connect REST Data API is happy
 * over HTTP/1.1, and keeping the blast radius small means a future undici
 * change can't silently break catalog reads too.
 */

const dispatcher = new Agent({
	allowH2: true,
	// Identity calls are low-volume (one guest token per process, refreshes on
	// expiry), so a small pool is plenty.
	connections: 4,
	keepAliveTimeout: 30_000,
})

type FetchInit = Parameters<typeof undiciFetch>[1]

/**
 * `fetch` over HTTP/2, returning a standard `Response`.
 *
 * undici's Response is structurally compatible with the global one for the
 * subset used here (status, headers.get, text, json).
 */
export function identityFetch(
	url: string,
	init?: FetchInit,
): Promise<Response> {
	return undiciFetch(url, {
		...init,
		dispatcher,
	}) as unknown as Promise<Response>
}
