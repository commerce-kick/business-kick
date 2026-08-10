export interface BuyerAccount {
	id: string
	name: string
	accountNumber?: string
	currencyCode?: string
}

export interface BuyerContact {
	id: string
	firstName?: string
	lastName?: string
	email?: string
	phone?: string
}

/**
 * A buyer may transact on behalf of several accounts (parent/child hierarchies
 * are routine in B2B). The chosen one becomes `effectiveAccountId` and scopes
 * pricing, entitlement and carts for the whole session.
 */
export interface BuyerProfile {
	contact: BuyerContact
	accounts: Array<BuyerAccount>
	effectiveAccountId?: string
}
