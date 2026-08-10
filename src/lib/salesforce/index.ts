/**
 * Salesforce B2B Commerce SDK — server-only.
 *
 * Nothing under `lib/salesforce/` may be imported from a module that reaches
 * the browser. Access tokens are httpOnly and the Connected App secret lives in
 * this process; the only sanctioned path from the client is a `createServerFn`
 * boundary in `src/server/`.
 *
 * Layering, bottom-up:
 *   config → errors → http (transport) → resources → domain types
 */

export * from "./errors"
export * as account from "./resources/account"
export * as cart from "./resources/cart"
export * as categories from "./resources/categories"
export * as orders from "./resources/orders"
export * as pricing from "./resources/pricing"
export * as products from "./resources/products"
export * as search from "./resources/search"
export * from "./types/account"
export * from "./types/cart"
export * from "./types/category"
export * from "./types/common"
export * from "./types/product"
