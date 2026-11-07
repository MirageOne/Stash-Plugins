import { DownloadStatus, type IDownloadItem } from '@/types';

export type QueueStatusFilter = 'all' | 'pending' | 'active' | 'review' | 'complete';

export const QUEUE_STATUS_FILTERS: ReadonlyArray<{ id: QueueStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
  { id: 'review', label: 'Needs attention' },
  { id: 'complete', label: 'Completed' },
];

export function countQueueStatuses(items: IDownloadItem[]): Record<QueueStatusFilter, number> {
  return {
    all: items.length,
    pending: items.filter(item => item.status === DownloadStatus.Pending).length,
    active: items.filter(item => item.status === DownloadStatus.Downloading || item.status === DownloadStatus.Processing).length,
    review: items.filter(item => item.status === DownloadStatus.Failed || item.status === DownloadStatus.Cancelled).length,
    complete: items.filter(item => item.status === DownloadStatus.Complete).length,
  };
}

export function filterQueueItems(
  items: IDownloadItem[],
  status: QueueStatusFilter,
  search: string,
): IDownloadItem[] {
  const query = search.trim().toLocaleLowerCase();
  return items.filter(item => {
    const matchesStatus = status === 'all' ||
      (status === 'pending' && item.status === DownloadStatus.Pending) ||
      (status === 'active' && (item.status === DownloadStatus.Downloading || item.status === DownloadStatus.Processing)) ||
      (status === 'review' && (item.status === DownloadStatus.Failed || item.status === DownloadStatus.Cancelled)) ||
      (status === 'complete' && item.status === DownloadStatus.Complete);
    if (!matchesStatus || !query) return matchesStatus;

    const searchable = [
      item.url,
      item.metadata?.title,
      item.metadata?.description,
      item.error,
      ...(item.metadata?.performers || []),
      ...(item.metadata?.tags || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return searchable.includes(query);
  });
}
