import { createFileRoute } from "@tanstack/react-router"

import { siteOrigin } from "#/lib/seo/canonical"

/**
 * robots.txt
 *
 * The disallow list mirrors the `index: false` policy in `seo()`. Both exist
 * because they do different jobs: the meta tag keeps a page out of the index
 * once crawled, while this keeps the crawler from spending budget on it at all.
 *
 * `/search` is disallowed by pattern because an unbounded query string is an
 * unbounded set of crawlable URLs — the classic way a storefront burns its
 * crawl budget on pages that should never rank.
 */
export const Route = createFileRoute("/robots.txt")({
	server: {
		handlers: {
			GET: () => {
				const body = [
					"User-agent: *",
					"Allow: /",
					"Disallow: /cart",
					"Disallow: /account",
					"Disallow: /login",
					"Disallow: /register",
					"Disallow: /forgot-password",
					"Disallow: /search",
					"Disallow: /*?*refine=",
					"Disallow: /*?*sort=",
					"",
					`Sitemap: ${siteOrigin()}/sitemap.xml`,
					"",
				].join("\n")

				return new Response(body, {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "public, max-age=3600",
					},
				})
			},
		},
	},
})
