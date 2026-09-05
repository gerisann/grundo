import { infiniteQueryOptions } from '@tanstack/react-query';
import { api, apiConfigured, type FeedQuery, type FeedResult } from './api';

export function activityFeedOptions(uid: string | undefined, query: FeedQuery | null) {
  return infiniteQueryOptions({
    queryKey: ['activities', uid, 'feed', query],
    enabled: query !== null && !!uid,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiConfigured && query
      ? api.activities({ ...query, limit: 10, cursor: pageParam })
      : Promise.resolve<FeedResult>({ activities: [] }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
