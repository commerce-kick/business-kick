/**
 * Domain types owned by this application.
 *
 * Connect REST payloads are mapped into these at the resource boundary and
 * never travel further. That mapping is the seam that keeps a Salesforce API
 * version bump — or a field rename in the org — from cascading into UI files.
 */

export interface Money {
	/** Numeric amount. `null` when the buyer is not entitled to see a price. */
	amount: number | null
	currencyCode: string
}

export interface Image {
	url: string
	alt?: string
	title?: string
	/**
	 * True when this is a stock "no image" asset rather than real product media.
	 *
	 * Resolved once at the SDK boundary and carried on the domain object, so
	 * consumers never need to sniff URLs — and, critically, so `lib/seo` can
	 * exclude placeholders from structured data without importing anything from
	 * `lib/salesforce`, which is server-only.
	 */
	isPlaceholder?: boolean
}

export interface Paged<T> {
	items: Array<T>
	/** Total matching records, when the API reports one. */
	total: number
	page: number
	pageSize: number
	hasMore: boolean
}
