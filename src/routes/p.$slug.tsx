import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"

import { Breadcrumbs } from "#/components/catalog/breadcrumbs"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Separator } from "#/components/ui/separator"
import { formatMoney } from "#/lib/format"
import { productPageQuery } from "#/lib/query/catalog"
import { canonicalFor } from "#/lib/seo/canonical"
import { breadcrumbJsonLd, jsonLdScript, productJsonLd } from "#/lib/seo/jsonld"
import { seo } from "#/lib/seo/seo"

export const Route = createFileRoute("/p/$slug")({
	loader: async ({ context, params }) => {
		const product = await context.queryClient.ensureQueryData(
			productPageQuery(params.slug),
		)
		if (!product) throw notFound()
		return product
	},

	head: ({ loaderData, params }) => {
		if (!loaderData) return {}

		const product = loaderData
		const canonical = canonicalFor(`/p/${params.slug}`)

		const trail = [
			{ name: "Home", path: "/" },
			...product.categoryPath.map((c) => ({
				name: c.name,
				path: `/c/${c.slug}`,
			})),
			{ name: product.name, path: `/p/${product.slug}` },
		]

		return {
			...seo({
				title: product.name,
				description:
					product.description ??
					`${product.name}${product.sku ? ` (${product.sku})` : ""} — available to order from Meridian.`,
				image: product.images[0]?.url,
				canonical,
				type: "product",
				index: true,
			}),
			scripts: [
				{
					type: "application/ld+json",
					children: jsonLdScript([
						breadcrumbJsonLd(trail),
						// Price disclosure is gated inside this builder — a
						// negotiated, account-specific price never reaches the page
						// source. See the comment on `productJsonLd`.
						productJsonLd(product, { canonical }),
					]),
				},
			],
		}
	},

	component: ProductPage,
})

function ProductPage() {
	const params = Route.useParams()
	const { session } = Route.useRouteContext()
	const { data: product } = useSuspenseQuery(productPageQuery(params.slug))

	if (!product) return null

	const price = product.price
	const amount =
		price?.negotiatedPrice.amount ?? price?.listPrice.amount ?? null

	const trail = [
		{ name: "Home", path: "/" },
		...product.categoryPath.map((c) => ({
			name: c.name,
			path: `/c/${c.slug}`,
		})),
		{ name: product.name, path: `/p/${product.slug}` },
	]

	return (
		<div className="mx-auto max-w-7xl px-6 py-10">
			<Breadcrumbs trail={trail} />

			<div className="mt-8 grid gap-10 lg:grid-cols-2">
				<ProductGallery images={product.images} name={product.name} />

				<div>
					{product.sku ? (
						<p className="text-sm text-muted-foreground">SKU {product.sku}</p>
					) : null}

					<h1 className="mt-1 text-3xl font-semibold tracking-tight">
						{product.name}
					</h1>

					<div className="mt-6">
						{amount !== null ? (
							<div className="flex items-baseline gap-3">
								<span className="text-3xl font-semibold">
									{formatMoney(amount, price?.listPrice.currencyCode ?? "USD")}
								</span>
								{product.unitOfMeasure ? (
									<span className="text-sm text-muted-foreground">
										per {product.unitOfMeasure}
									</span>
								) : null}
								{price?.origin === "negotiated" ? (
									<Badge variant="secondary">Your contract price</Badge>
								) : null}
							</div>
						) : (
							<div className="rounded-lg border border-border/60 bg-muted/30 p-4">
								<p className="text-sm font-medium">
									Pricing is specific to your account
								</p>
								<p className="mt-1 text-sm text-muted-foreground">
									Sign in with your business account to see contract pricing and
									availability.
								</p>
							</div>
						)}
					</div>

					{product.minimumQuantity > 1 ? (
						<p className="mt-4 text-sm text-muted-foreground">
							Minimum order quantity: {product.minimumQuantity}
							{product.quantityIncrement > 1
								? ` · sold in multiples of ${product.quantityIncrement}`
								: ""}
						</p>
					) : null}

					<div className="mt-8">
						{session ? (
							// Cart is stubbed for this milestone — the button is present
							// but does not pretend to work.
							<Button size="lg" disabled>
								Add to cart (coming soon)
							</Button>
						) : (
							<Button
								size="lg"
								nativeButton={false}
								render={
									<Link
										to="/login"
										search={{ redirect: `/p/${product.slug}` }}
									/>
								}
							>
								Sign in to order
							</Button>
						)}
					</div>

					{product.description ? (
						<>
							<Separator className="my-8" />
							<div className="prose prose-sm max-w-none dark:prose-invert">
								<p>{product.description}</p>
							</div>
						</>
					) : null}

					{product.attributes.length > 0 ? (
						<>
							<Separator className="my-8" />
							<h2 className="text-sm font-semibold">Specifications</h2>
							<dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
								{product.attributes.map((attr) => (
									<div
										key={attr.label}
										className="flex justify-between gap-4 border-b border-border/40 py-2 text-sm"
									>
										<dt className="text-muted-foreground">{attr.label}</dt>
										<dd className="font-medium">{attr.value}</dd>
									</div>
								))}
							</dl>
						</>
					) : null}
				</div>
			</div>
		</div>
	)
}

function ProductGallery({
	images,
	name,
}: {
	images: Array<{ url: string; alt?: string }>
	name: string
}) {
	const primary = images[0]

	return (
		<div>
			<div className="aspect-square overflow-hidden rounded-xl border border-border/60 bg-muted/30">
				{primary ? (
					<img
						src={primary.url}
						alt={primary.alt ?? name}
						className="size-full object-cover"
					/>
				) : (
					<div className="flex size-full items-center justify-center text-sm text-muted-foreground">
						No image available
					</div>
				)}
			</div>

			{images.length > 1 ? (
				<div className="mt-4 grid grid-cols-5 gap-3">
					{images.slice(1, 6).map((image) => (
						<div
							key={image.url}
							className="aspect-square overflow-hidden rounded-lg border border-border/60 bg-muted/30"
						>
							<img
								src={image.url}
								alt={image.alt ?? name}
								loading="lazy"
								className="size-full object-cover"
							/>
						</div>
					))}
				</div>
			) : null}
		</div>
	)
}
