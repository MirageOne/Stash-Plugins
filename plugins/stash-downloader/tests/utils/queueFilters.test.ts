import { describe, expect, it } from 'vitest';
import { DownloadStatus, type IDownloadItem } from '@/types';
import { countQueueStatuses, filterQueueItems } from '@/utils/queueFilters';

function item(id: string, status: DownloadStatus, fields: Partial<IDownloadItem> = {}): IDownloadItem {
  return { id, url: `https://example.test/${id}`, status, ...fields };
}

describe('queue filters', () => {
  const items = [
    item('pending', DownloadStatus.Pending, { metadata: { title: 'Studio scene', performers: ['Avery'], tags: ['solo'] } as IDownloadItem['metadata'] }),
    item('downloading', DownloadStatus.Downloading),
    item('processing', DownloadStatus.Processing),
    item('failed', DownloadStatus.Failed, { error: 'Proxy connection failed' }),
    item('cancelled', DownloadStatus.Cancelled),
    item('complete', DownloadStatus.Complete),
  ];

  it('counts statuses into all, pending, active, review, and complete groups', () => {
    expect(countQueueStatuses(items)).toEqual({ all: 6, pending: 1, active: 2, review: 2, complete: 1 });
  });

  it('filters active downloads and includes failures and cancellations in review', () => {
    expect(filterQueueItems(items, 'active', '').map(entry => entry.id)).toEqual(['downloading', 'processing']);
    expect(filterQueueItems(items, 'review', '').map(entry => entry.id)).toEqual(['failed', 'cancelled']);
  });

  it('searches case-insensitively across source URLs, scraped metadata, tags, and errors', () => {
    expect(filterQueueItems(items, 'all', 'AVERY').map(entry => entry.id)).toEqual(['pending']);
    expect(filterQueueItems(items, 'all', 'PROXY CONNECTION').map(entry => entry.id)).toEqual(['failed']);
    expect(filterQueueItems(items, 'complete', 'pending').map(entry => entry.id)).toEqual([]);
  });
});
