import { createFileRoute } from "@tanstack/react-router"

import {
	listChildCategories,
	listRootCategories,
} from "#/lib/salesforce/resources/categories"
import { listCategoryProducts } from "#/lib/salesforce/resources/search"
import type { CategorySummary } from "#/lib/salesforce/types/category"
import { siteOrigin } from "#/lib/seo/canonical"

/**
 * sitemap.xml
 *
 * Enumerates only what is genuinely indexable: the home page, categories, and
 * products. Cart, account and auth routes are excluded — listing a page that
 * carries `noindex` sends a crawler contradictory instructions.
 *
 * Generated with the **guest** token specifically. A sitemap must describe the
 * catalog a crawler can actually see, not a buyer's entitlement-filtered view.
 *
 * Coverage is capped (see the constants below). When the cap truncates the
 * catalog, that is logged rather than silently swallowed — a quietly truncated
 * sitemap looks identical to a complete one, which is how half a catalog goes
 * un-indexed without anyone noticing.
 */

const MAX_CATEGORIES = 500
/** Products enumerated per category. The 50k/file limit is the hard ceiling. */
const MAX_PRODUCTS_PER_CATEGORY = 1_000
const PRODUCT_PAGE_SIZE = 100

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface CachedSitemap {
	xml: string
	expiresAt: number
}

let cache: CachedSitemap | undefined
let inFlight: Promise<string> | undefined

const escapeXml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")

interface UrlEntry {
	loc: string
	changefreq?: string
	priority?: string
}

function renderSitemap(entries: Array<UrlEntry>): string {
	const urls = entries
		.map((entry) =>
			[
				"\t<url>",
				`\t\t<loc>${escapeXml(entry.loc)}</loc>`,
				entry.changefreq
					? `\t\t<changefreq>${entry.changefreq}</changefreq>`
					: "",
				entry.priority ? `\t\t<priority>${entry.priority}</priority>` : "",
				"\t</url>",
			]
				.filter(Boolean)
				.join("\n"),
		)
		.join("\n")

	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Walk the category tree breadth-first, bounded by MAX_CATEGORIES. */
async function collectCategories(): Promise<Array<CategorySummary>> {
	const seen = new Map<string, CategorySummary>()
	let frontier = await listRootCategories()

	for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
		for (const category of frontier) {
			if (seen.size >= MAX_CATEGORIES) return [...seen.values()]
			seen.set(category.id, category)
		}

		const next = await Promise.all(
			frontier.map((c) => listChildCategories(c.id).catch(() => [])),
		)
		frontier = next.flat().filter((c) => !seen.has(c.id))
	}

	return [...seen.values()]
}

async function buildSitemap(): Promise<string> {
	const origin = siteOrigin()
	const entries: Array<UrlEntry> = [
		{ loc: `${origin}/`, changefreq: "daily", priority: "1.0" },
	]

	const categories = await collectCategories()
	if (categories.length >= MAX_CATEGORIES) {
		console.warn(
			`[sitemap] Category cap of ${MAX_CATEGORIES} reached — the sitemap is truncated.`,
		)
	}

	for (const category of categories) {
		entries.push({
			loc: `${origin}/c/${category.slug}`,
			changefreq: "daily",
			priority: "0.8",
		})
	}

	const productSlugs = new Set<string>()

	for (const category of categories) {
		let page = 1
		let collected = 0

		while (collected < MAX_PRODUCTS_PER_CATEGORY) {
			const result = await listCategoryProducts(category.id, {
				page,
				pageSize: PRODUCT_PAGE_SIZE,
				// Prices are irrelevant here and cost an extra call per page.
				withPrices: false,
			}).catch(() => null)

			if (!result || result.items.length === 0) break

			for (const product of result.items) productSlugs.add(product.slug)

			collected += result.items.length
			if (!result.hasMore) break
			page += 1
		}

		if (collected >= MAX_PRODUCTS_PER_CATEGORY) {
			console.warn(
				`[sitemap] Product cap reached for category "${category.slug}" — some products are omitted.`,
			)
		}
	}

	for (const slug of productSlugs) {
		entries.push({
			loc: `${origin}/p/${slug}`,
			changefreq: "weekly",
			priority: "0.6",
		})
	}

	if (entries.length > 50_000) {
		console.warn(
			`[sitemap] ${entries.length} URLs exceeds the 50,000-per-file limit. Split into a sitemap index before launch.`,
		)
	}

	return renderSitemap(entries)
}

async function getSitemap(): Promise<string> {
	const now = Date.now()
	if (cache && cache.expiresAt > now) return cache.xml

	// Crawlers can hit this concurrently; building it once per TTL keeps a
	// full catalog walk from being triggered several times over.
	if (inFlight) return inFlight

	inFlight = buildSitemap()
		.then((xml) => {
			cache = { xml, expiresAt: Date.now() + CACHE_TTL_MS }
			return xml
		})
		.finally(() => {
			inFlight = undefined
		})

	return inFlight
}

export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: async () => {
				try {
					const xml = await getSitemap()
					return new Response(xml, {
						headers: {
							"Content-Type": "application/xml; charset=utf-8",
							"Cache-Control": "public, max-age=3600",
						},
					})
				} catch (error) {
					console.error("[sitemap] Failed to build sitemap", error)
					// Serve a valid, minimal sitemap rather than a 500 — a broken
					// sitemap can cause a crawler to drop known-good URLs.
					return new Response(
						renderSitemap([{ loc: `${siteOrigin()}/`, priority: "1.0" }]),
						{
							status: 200,
							headers: {
								"Content-Type": "application/xml; charset=utf-8",
								"Cache-Control": "public, max-age=300",
							},
						},
					)
				}
			},
		},
	},
})
