import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { activityFeedOptions } from './activityQueries';
import { api } from './api';
vi.mock('./api', () => ({ apiConfigured: true, api: { activities: vi.fn() } }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => { client.clear(); vi.clearAllMocks(); });

describe('activity feed cache', () => {
  it('reuses a fresh page after navigation and separates accounts and filters', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [], nextCursor: null });
    await client.fetchInfiniteQuery(activityFeedOptions('one', { scope: 'mine' }));
    await client.fetchInfiniteQuery(activityFeedOptions('one', { scope: 'mine' }));
    expect(api.activities).toHaveBeenCalledTimes(1);
    await client.fetchInfiniteQuery(activityFeedOptions('two', { scope: 'mine' }));
    await client.fetchInfiniteQuery(activityFeedOptions('one', { scope: 'world' }));
    expect(api.activities).toHaveBeenCalledTimes(3);
    await client.invalidateQueries({ queryKey: ['activities'] });
    await client.fetchInfiniteQuery(activityFeedOptions('one', { scope: 'mine' }));
    expect(api.activities).toHaveBeenCalledTimes(4);
  });
  it('loads only the next ten and keeps cached pages when that request fails', async () => {
    vi.mocked(api.activities).mockResolvedValueOnce({ activities: [], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ activities: [], nextCursor: null });
    const observer = new InfiniteQueryObserver(client, activityFeedOptions('one', { scope: 'world' }));
    await observer.refetch();
    await observer.fetchNextPage();
    expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
    expect(observer.getCurrentResult().isFetchNextPageError).toBe(true);
    await observer.fetchNextPage();
    expect(api.activities).toHaveBeenLastCalledWith({ scope: 'world', limit: 10, cursor: 'next' });
    expect(observer.getCurrentResult().data?.pages).toHaveLength(2);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
    observer.destroy();
  });
});
