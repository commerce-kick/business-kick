import { QueryClient } from "@tanstack/react-query"

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// Catalog data is not per-request volatile. A non-zero staleTime
				// stops the client refetching what SSR already delivered, and
				// keeps Connect REST calls off the org's API quota.
				staleTime: 60_000,
				gcTime: 5 * 60_000,
				refetchOnWindowFocus: false,
				retry: (failureCount, error) => {
					// Never retry what won't succeed on a second try.
					const code = (error as { code?: string })?.code
					if (
						code === "SF_NOT_FOUND" ||
						code === "SF_AUTH" ||
						code === "SF_VALIDATION"
					) {
						return false
					}
					return failureCount < 2
				},
			},
		},
	})

	return { queryClient }
}
