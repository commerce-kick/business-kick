/**
 * Error taxonomy for the Salesforce Connect REST API.
 *
 * Server function results cross a serialization boundary, so the *class* does
 * not survive the trip to the client — only plain data does. Every error
 * therefore carries a stable string `code` that routes can branch on after
 * deserialization. Use `errorCodeOf()` on the client side, never `instanceof`.
 */

export type SalesforceErrorCode =
	| "SF_AUTH"
	| "SF_NOT_FOUND"
	| "SF_VALIDATION"
	| "SF_RATE_LIMIT"
	| "SF_API"
	| "SF_NETWORK"

/** Shape Salesforce returns on error: an array of these. */
export interface SalesforceErrorDetail {
	errorCode?: string
	message?: string
	fields?: Array<string>
}

export class SalesforceApiError extends Error {
	readonly code: SalesforceErrorCode = "SF_API"
	readonly status: number
	readonly errorCode?: string
	readonly details: Array<SalesforceErrorDetail>
	readonly requestId?: string

	constructor(
		message: string,
		opts: {
			status: number
			errorCode?: string
			details?: Array<SalesforceErrorDetail>
			requestId?: string
			cause?: unknown
		},
	) {
		super(message, { cause: opts.cause })
		this.name = new.target.name
		this.status = opts.status
		this.errorCode = opts.errorCode
		this.details = opts.details ?? []
		this.requestId = opts.requestId
	}

	/** Plain, serializable projection — what actually reaches the client. */
	toJSON() {
		return {
			code: this.code,
			status: this.status,
			errorCode: this.errorCode,
			message: this.message,
			requestId: this.requestId,
		}
	}
}

/** 401 / invalid_grant / expired or revoked token. */
export class SalesforceAuthError extends SalesforceApiError {
	override readonly code = "SF_AUTH" as const
}

/** 404, or a 400 carrying ITEM_NOT_FOUND / INVALID_ID_FIELD. */
export class SalesforceNotFoundError extends SalesforceApiError {
	override readonly code = "SF_NOT_FOUND" as const
}

/** 400 with field-level problems — surfaced back into forms. */
export class SalesforceValidationError extends SalesforceApiError {
	override readonly code = "SF_VALIDATION" as const
}

/** 429 or REQUEST_LIMIT_EXCEEDED — the org's API quota is exhausted. */
export class SalesforceRateLimitError extends SalesforceApiError {
	override readonly code = "SF_RATE_LIMIT" as const

	readonly retryAfterSeconds?: number

	constructor(
		message: string,
		opts: ConstructorParameters<typeof SalesforceApiError>[1] & {
			retryAfterSeconds?: number
		},
	) {
		super(message, opts)
		this.retryAfterSeconds = opts.retryAfterSeconds
	}
}

/** Transport-level failure: DNS, TLS, socket, abort. Never reached the org. */
export class SalesforceNetworkError extends SalesforceApiError {
	override readonly code = "SF_NETWORK" as const
}

const NOT_FOUND_CODES = new Set([
	"ITEM_NOT_FOUND",
	"NOT_FOUND",
	"INVALID_ID_FIELD",
	"INVALID_PRODUCT",
])

const AUTH_CODES = new Set([
	"INVALID_SESSION_ID",
	"INVALID_AUTH_HEADER",
	"invalid_grant",
	"invalid_token",
])

/**
 * Map an HTTP response + parsed body onto the taxonomy above.
 *
 * Salesforce is inconsistent about status codes — a missing product can arrive
 * as a 400 carrying ITEM_NOT_FOUND rather than a 404 — so the body's errorCode
 * is consulted before falling back to the status.
 */
export function toSalesforceError(
	status: number,
	body: unknown,
	requestId?: string,
): SalesforceApiError {
	const details = normalizeDetails(body)
	const first = details[0]
	const errorCode = first?.errorCode
	const message =
		first?.message ?? `Salesforce request failed with status ${status}`

	const opts = { status, errorCode, details, requestId }

	if (errorCode && NOT_FOUND_CODES.has(errorCode)) {
		return new SalesforceNotFoundError(message, opts)
	}
	if (errorCode && AUTH_CODES.has(errorCode)) {
		return new SalesforceAuthError(message, opts)
	}
	if (errorCode === "REQUEST_LIMIT_EXCEEDED") {
		return new SalesforceRateLimitError(message, opts)
	}

	switch (status) {
		case 400:
			return new SalesforceValidationError(message, opts)
		case 401:
			return new SalesforceAuthError(message, opts)
		case 403:
			// 403 is genuinely ambiguous here: it is returned both for an
			// unauthorized token and for a buyer lacking entitlement to the
			// record. Treat it as auth so the refresh-then-retry path gets a
			// chance; a second 403 after refresh surfaces to the user.
			return new SalesforceAuthError(message, opts)
		case 404:
			return new SalesforceNotFoundError(message, opts)
		case 429:
			return new SalesforceRateLimitError(message, opts)
		default:
			return new SalesforceApiError(message, opts)
	}
}

function normalizeDetails(body: unknown): Array<SalesforceErrorDetail> {
	if (Array.isArray(body)) return body as Array<SalesforceErrorDetail>
	if (body && typeof body === "object") {
		const obj = body as Record<string, unknown>
		// OAuth endpoints use { error, error_description } instead.
		if (typeof obj.error === "string") {
			return [
				{
					errorCode: obj.error,
					message:
						typeof obj.error_description === "string"
							? obj.error_description
							: obj.error,
				},
			]
		}
		if (typeof obj.message === "string" || typeof obj.errorCode === "string") {
			return [obj as SalesforceErrorDetail]
		}
	}
	return []
}

/** Read the stable code off an error that may have crossed the wire. */
export function errorCodeOf(error: unknown): SalesforceErrorCode | undefined {
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as { code?: unknown }).code
		if (typeof code === "string" && code.startsWith("SF_")) {
			return code as SalesforceErrorCode
		}
	}
	return undefined
}

export function isNotFound(error: unknown): boolean {
	return errorCodeOf(error) === "SF_NOT_FOUND"
}

export function isAuthError(error: unknown): boolean {
	return errorCodeOf(error) === "SF_AUTH"
}
