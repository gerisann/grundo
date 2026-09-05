import { useInfiniteQuery } from '@tanstack/react-query';
import { type FeedQuery, type FeedResult } from '@/lib/api';
import { activityFeedOptions } from '@/lib/activityQueries';
import { useAuth } from './AuthProvider';

export interface ActivitiesState {
  result: FeedResult | null;
  loading: boolean;
  error: string;
  reload: () => void;
  loadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
}

/** Account- and filter-scoped memory cache survives navigation, including loaded pages. */
export function useActivities(query: FeedQuery | null): ActivitiesState {
  const { user } = useAuth();
  const feed = useInfiniteQuery(activityFeedOptions(user?.uid, query));
  const pages = feed.data?.pages;
  return {
    result: pages ? { ...pages.at(-1), activities: [...new Map(pages.flatMap((page) =>
      page.activities).map((item) => [item.id, item])).values()] } : null,
    loading: feed.isLoading,
    error: feed.error ? 'Nem sikerült betölteni az aktivitásokat. Próbáld újra.' : '',
    reload: () => { void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch()); },
    loadMore: () => { if (feed.hasNextPage && !feed.isFetching) void feed.fetchNextPage(); },
    hasMore: feed.hasNextPage,
    loadingMore: feed.isFetching,
  };
}
