/**
 * Display formatting.
 *
 * Isomorphic: used by both SSR and client renders, so it must not depend on a
 * browser locale that the server does not share — a mismatch would trip React's
 * hydration check. `en-US` is pinned for that reason; swap it for a
 * request-derived locale only once that locale is threaded through to both
 * sides consistently.
 */

const LOCALE = "en-US"

export function formatMoney(
	amount: number | null | undefined,
	currencyCode = "USD",
): string {
	if (amount === null || amount === undefined) return "—"
	try {
		return new Intl.NumberFormat(LOCALE, {
			style: "currency",
			currency: currencyCode,
		}).format(amount)
	} catch {
		// An unrecognised currency code should degrade, not throw mid-render.
		return `${amount.toFixed(2)} ${currencyCode}`
	}
}

export function formatDate(iso: string): string {
	if (!iso) return "—"
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return "—"
	return new Intl.DateTimeFormat(LOCALE, {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(date)
}
