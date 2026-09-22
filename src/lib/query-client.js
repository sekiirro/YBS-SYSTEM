import { QueryClient } from '@tanstack/react-query';

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			// Static / slowly-changing reference data (exercises, foods,
			// packages, workspaces) benefits from a short client-side cache
			// window, while business-critical rows still go stale quickly.
			staleTime: 30 * 1000,
			gcTime: 5 * 60 * 1000,
		},
	},
});