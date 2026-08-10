/**
 * Slug ↔ Salesforce Id resolution.
 *
 * Connect REST is Id-addressed, but `/c/industrial-fasteners` is worth far more
 * than `/c/0ZGxx0000000001GAA` to a crawler and to a human reading a link. This
 * module bridges the two.
 *
 * Strategy, in order:
 *   1. A URL-friendly field on the record, when the org populates one.
 *   2. Otherwise, derive the slug from the record name.
 *
 * Either way the mapping is memoized as records flow through the resource
 * layer, so listing a category also warms every product slug on that page.
 * Deep links that miss the cache fall back to a search lookup.
 *
 * NOTE: `SLUG_FIELD_CANDIDATES` is the one thing to confirm against the live
 * org — orgs differ on whether they populate a URL field at all. If none is
 * present, derivation from name is used and everything still works.
 */

/**
 * Where a URL-friendly name may live.
 *
 * Confirmed against a live org: categories expose it as a **top-level**
 * `urlName`, not inside `fields`. Both locations are checked, because the
 * top-level form is what Connect REST actually returns while the `fields`
 * variants cover orgs carrying a custom SEO field.
 */
const SLUG_FIELD_CANDIDATES = [
	"urlName",
	"UrlName",
	"Url_Name__c",
	"Slug__c",
	"SeoUrlName__c",
] as const

/** Kebab-case an arbitrary display name into a URL-safe segment. */
export function slugify(input: string): string {
	return (
		input
			.normalize("NFKD")
			// Strip diacritics so "Bâti" and "Bati" produce the same segment.
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 96)
	)
}

/** Pull a slug off a raw record, preferring an explicit field over the name. */
export function resolveSlug(
	record: Record<string, unknown> | undefined,
	fallbackName: string,
	id: string,
): string {
	const fields = record?.fields as Record<string, unknown> | undefined

	// Top level first (that is where Connect REST puts `urlName`), then inside
	// `fields` for orgs that carry a custom SEO field instead.
	for (const source of [record, fields]) {
		if (!source) continue
		for (const candidate of SLUG_FIELD_CANDIDATES) {
			const value = readFieldValue(source[candidate])
			if (value) return slugify(value)
		}
	}

	const derived = slugify(fallbackName)
	// A name of only punctuation would slugify to "" — fall back to the Id so
	// the URL stays addressable rather than collapsing to `/p/`.
	return derived || id.toLowerCase()
}

function readFieldValue(field: unknown): string | undefined {
	if (typeof field === "string") return field || undefined
	if (field && typeof field === "object" && "value" in field) {
		const value = (field as { value?: unknown }).value
		if (typeof value === "string") return value || undefined
	}
	return undefined
}

// --------------------------------------------------------------------------
// Bidirectional cache
// --------------------------------------------------------------------------

type Kind = "product" | "category"

interface Entry {
	id: string
	slug: string
	expiresAt: number
}

const TTL_MS = 30 * 60_000
/** Bound the map so a crawler walking a large catalog cannot grow it forever. */
const MAX_ENTRIES = 20_000

const bySlug = new Map<string, Entry>()
const byId = new Map<string, Entry>()

const key = (kind: Kind, value: string) => `${kind}:${value}`

export function rememberSlug(kind: Kind, id: string, slug: string): void {
	if (bySlug.size >= MAX_ENTRIES) {
		bySlug.clear()
		byId.clear()
	}
	const entry: Entry = { id, slug, expiresAt: Date.now() + TTL_MS }
	bySlug.set(key(kind, slug), entry)
	byId.set(key(kind, id), entry)
}

export function lookupIdBySlug(kind: Kind, slug: string): string | undefined {
	const entry = bySlug.get(key(kind, slug))
	if (!entry) return undefined
	if (entry.expiresAt < Date.now()) {
		bySlug.delete(key(kind, slug))
		byId.delete(key(kind, entry.id))
		return undefined
	}
	return entry.id
}

export function lookupSlugById(kind: Kind, id: string): string | undefined {
	const entry = byId.get(key(kind, id))
	if (!entry || entry.expiresAt < Date.now()) return undefined
	return entry.slug
}

/**
 * Best-effort reversal of `slugify`, used to build a search term when a deep
 * link misses the cache. Lossy by nature — the search result is matched back
 * against its own slug before being accepted.
 */
export function slugToSearchTerm(slug: string): string {
	return slug.replace(/-/g, " ").trim()
}

/** Salesforce record Ids are 15 or 18 characters of [a-zA-Z0-9]. */
export function looksLikeSalesforceId(value: string): boolean {
	return /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(value)
}
