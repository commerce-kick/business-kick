import { oauth, webstoreBase } from "../config"
import { toSalesforceError } from "../errors"
import { identityFetch } from "../fetch"
import { request } from "../http"

import type { BuyerAccount, BuyerProfile } from "../types/account"

/**
 * Buyer identity and account context.
 *
 * `effectiveAccountId` is the pivot of the whole B2B model: it decides which
 * price book, entitlement policy and cart the session operates against. A buyer
 * with access to several accounts (parent/child hierarchies are routine) picks
 * one, and it is pinned in a cookie for the life of the session.
 */

interface RawUserInfo {
	user_id?: string
	preferred_username?: string
	email?: string
	name?: string
	given_name?: string
	family_name?: string
}

export interface UserInfo {
	userId: string
	username: string
	email?: string
	displayName?: string
}

/**
 * OpenID Connect userinfo — called once at login, not per request.
 *
 * Goes through `identityFetch`, like every other call to an Experience Cloud
 * identity endpoint. Salesforce's headless flows require HTTP/2 and fail in
 * misleading ways over 1.1, so identity calls must not fall back to the global
 * `fetch`. See `lib/salesforce/fetch.ts`.
 */
export async function getUserInfo(
	accessToken: string,
	opts: { signal?: AbortSignal } = {},
): Promise<UserInfo> {
	const response = await identityFetch(oauth.userinfo(), {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
		signal: opts.signal,
	})

	if (!response.ok) {
		// Mapped like every other Salesforce failure so the session-establishment
		// path reports a typed error rather than a bare string.
		throw toSalesforceError(
			response.status,
			await response.json().catch(() => undefined),
			response.headers.get("x-request-id") ?? undefined,
		)
	}

	const raw = (await response.json()) as RawUserInfo

	return {
		userId: raw.user_id ?? "",
		username: raw.preferred_username ?? raw.email ?? "",
		email: raw.email,
		displayName:
			raw.name ??
			[raw.given_name, raw.family_name].filter(Boolean).join(" ") ??
			undefined,
	}
}

interface RawAccountsResponse {
	accounts?: Array<{
		id?: string
		name?: string
		accountNumber?: string
		currencyIsoCode?: string
	}>
}

/**
 * Accounts this buyer may transact on behalf of.
 *
 * Endpoint: GET /accounts  (availability varies by org configuration — treat a
 * failure as "one implicit account" rather than an error, since single-account
 * buyers are the common case and must not be blocked by it.)
 */
export async function listBuyerAccounts(
	opts: { signal?: AbortSignal } = {},
): Promise<Array<BuyerAccount>> {
	const response = await request<RawAccountsResponse>(
		`${webstoreBase()}/accounts`,
		{ auth: "buyer", signal: opts.signal },
	).catch(() => ({ accounts: [] }) as RawAccountsResponse)

	return (response.accounts ?? [])
		.filter((account) => account.id)
		.map((account) => ({
			id: account.id as string,
			name: account.name ?? "",
			accountNumber: account.accountNumber,
			currencyCode: account.currencyIsoCode,
		}))
}

export async function getBuyerProfile(
	accessToken: string,
	opts: { signal?: AbortSignal } = {},
): Promise<BuyerProfile> {
	const [user, accounts] = await Promise.all([
		getUserInfo(accessToken, opts),
		listBuyerAccounts(opts),
	])

	return {
		contact: {
			id: user.userId,
			email: user.email,
			firstName: user.displayName?.split(" ")[0],
			lastName: user.displayName?.split(" ").slice(1).join(" ") || undefined,
		},
		accounts,
		effectiveAccountId: accounts[0]?.id,
	}
}
