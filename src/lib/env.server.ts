import { z } from "zod"

/**
 * Server-only environment configuration.
 *
 * This module must never be imported from a file that reaches the browser —
 * it carries the Connected App client secret. Everything here is consumed
 * behind `createServerFn` boundaries or from server routes.
 */

/**
 * `z.url()` alone is too permissive here.
 *
 * WHATWG treats any `scheme:` prefix as valid, so a typo like `hhttps://…`
 * parses cleanly and then fails much later as an unexplained connection error
 * at request time. Pinning the protocol turns that into a precise startup
 * message naming the offending variable.
 */
const httpUrl = (label: string) =>
	z
		.url()
		.refine(
			(value) => /^https?:\/\//i.test(value),
			`${label} must start with http:// or https://`,
		)
		.refine(
			(value) => !value.endsWith("/"),
			`${label} must not have a trailing slash`,
		)

const envSchema = z.object({
	/**
	 * The org's API host — the My Domain URL, e.g.
	 * `https://mycompany.my.salesforce.com`.
	 *
	 * Must NOT be `login.salesforce.com` or `test.salesforce.com`. Those are
	 * login endpoints; the Data API rejects them with the distinctly unhelpful
	 * `URL_NOT_RESET: Destination URL not reset`. Rejecting them here turns a
	 * per-request mystery into a startup message.
	 */
	SF_INSTANCE_URL: httpUrl("SF_INSTANCE_URL").refine(
		(value) => !/^https?:\/\/(login|test)\.salesforce\.com/i.test(value),
		"SF_INSTANCE_URL must be your My Domain host (https://<org>.my.salesforce.com), not a login host like login/test.salesforce.com",
	),
	/** Experience Cloud site base, where the Headless Identity endpoints live. */
	SF_EXPERIENCE_SITE_URL: httpUrl("SF_EXPERIENCE_SITE_URL"),
	/**
	 * 15- or 18-char WebStore record Id.
	 *
	 * The pattern check catches a placeholder left in place from `.env.example`,
	 * which would otherwise surface as a confusing 404 from every catalog call.
	 */
	SF_WEBSTORE_ID: z
		.string()
		.regex(
			/^0ZE[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/,
			"must be a WebStore record Id (starts with 0ZE, 15 or 18 chars)",
		),
	/** Pinned Connect REST version. One constant, never per call site. */
	SF_API_VERSION: z
		.string()
		.regex(/^v\d+\.\d+$/, 'must look like "v63.0"')
		.default("v63.0"),
	SF_CLIENT_ID: z.string().min(1),
	SF_CLIENT_SECRET: z.string().min(1),
	/**
	 * Which identity anonymous catalog traffic runs as.
	 *
	 * `guest_user` is the one you want in production: it runs as the Experience
	 * Cloud guest user, which has minimal permissions and is tied to the store's
	 * guest buyer account. `client_credentials` runs as the app's named Run-As
	 * user — if that user is over-privileged (a System Administrator, say), then
	 * every anonymous visitor, and everything a crawler indexes, inherits their
	 * catalog visibility.
	 *
	 * Defaults to `client_credentials` only because that is the path currently
	 * verified against a live org. Switch once `guest_user` is confirmed.
	 */
	SF_GUEST_MODE: z
		.enum(["client_credentials", "guest_user"])
		.default("client_credentials"),
	/**
	 * Absolute public origin, used for canonicals, OG tags and the sitemap.
	 *
	 * `VITE_`-prefixed because route `head()` functions run on the client too
	 * and need the same value — see `lib/seo/canonical.ts`. One variable, read
	 * from `process.env` here and `import.meta.env` there, so the two can never
	 * disagree.
	 */
	VITE_PUBLIC_SITE_URL: httpUrl("VITE_PUBLIC_SITE_URL"),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | undefined

/**
 * Parse and memoize the environment.
 *
 * Deliberately lazy rather than parsed at import time: a build step should not
 * require production secrets to be present. The first request that touches
 * Salesforce fails loudly with a precise list of what is missing, rather than
 * surfacing later as a confusing 401.
 */
export function getEnv(): Env {
	if (cached) return cached

	const parsed = envSchema.safeParse(process.env)

	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("\n")
		throw new Error(
			`Invalid Salesforce environment configuration:\n${issues}\n\n` +
				"Copy .env.example to .env and fill in the values.",
		)
	}

	cached = parsed.data
	return cached
}

export function isProduction(): boolean {
	return process.env.NODE_ENV === "production"
}
