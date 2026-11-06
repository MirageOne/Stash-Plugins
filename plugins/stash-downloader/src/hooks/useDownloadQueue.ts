/**
 * useDownloadQueue - Hook for managing download queue with localStorage persistence
 */

import { useState, useCallback, useRef } from 'react';
import type { IDownloadItem, IImportProfile, IScrapedMetadata } from '@/types';
import { DownloadStatus } from '@/types';
import { generateId, createLogger } from '@/utils';
import { STORAGE_KEYS } from '@/constants';
import { canonicalizeSourceUrl } from '@/utils/importProfiles';

const log = createLogger('DownloadQueue');

/**
 * Serializes queue items for localStorage storage.
 * Converts Date objects to ISO strings.
 */
function serializeQueue(items: IDownloadItem[]): string {
  return JSON.stringify(items, (_key, value) => {
    // Convert Date objects to ISO strings
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    return value;
  });
}

/**
 * Deserializes queue items from localStorage.
 * Converts ISO strings back to Date objects.
 */
function deserializeQueue(json: string): IDownloadItem[] {
  try {
    return JSON.parse(json, (_key, value) => {
      // Convert Date markers back to Date objects
      if (value && typeof value === 'object' && value.__type === 'Date') {
        return new Date(value.value);
      }
      return value;
    });
  } catch (e) {
    log.error('Failed to deserialize queue:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

/**
 * Load queue from localStorage
 */
function loadQueue(): IDownloadItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.QUEUE);
    if (!stored) return [];

    const items = deserializeQueue(stored);

    return items.map(item => {
      if (item.status === DownloadStatus.Downloading || item.status === DownloadStatus.Processing) {
        // Reconcile against Stash jobs after mount; age alone cannot tell whether a job is alive.
        log.info(`Queue item requires Stash job recovery: ${item.url}`);
        return { ...item, progress: undefined, recoveryState: 'pending' as const, lastActivityAt: new Date() };
      }
      return item;
    });
  } catch (e) {
    log.error('Failed to load queue from localStorage:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

export function useDownloadQueue() {
  // Initialize from localStorage
  const [items, setItems] = useState<IDownloadItem[]>(() => loadQueue());
  const itemsRef = useRef(items);

  const replaceItems = useCallback((updater: IDownloadItem[] | ((current: IDownloadItem[]) => IDownloadItem[])) => {
    const nextItems = typeof updater === 'function' ? updater(itemsRef.current) : updater;
    itemsRef.current = nextItems;
    setItems(nextItems);
    try {
      localStorage.setItem(STORAGE_KEYS.QUEUE, serializeQueue(nextItems));
    } catch (e) {
      log.error('Failed to save queue to localStorage:', e instanceof Error ? e.message : String(e));
    }
  }, []);

  /**
   * Check if a URL is already in the queue
   */
  const isUrlInQueue = useCallback((url: string): boolean => {
    const canonicalUrl = canonicalizeSourceUrl(url);
    return itemsRef.current.some((item) => canonicalizeSourceUrl(item.url) === canonicalUrl);
  }, []);

  /**
   * Find an existing item by URL
   */
  const findByUrl = useCallback((url: string): IDownloadItem | undefined => {
    const canonicalUrl = canonicalizeSourceUrl(url);
    return itemsRef.current.find((item) => canonicalizeSourceUrl(item.url) === canonicalUrl);
  }, []);

  /**
   * Add a URL to the queue
   * Returns the item ID if added, null if duplicate
   */
  const addToQueue = useCallback((url: string, metadata?: IScrapedMetadata, importProfile?: IImportProfile): string | null => {
    // Check for duplicate URL in queue
    const canonicalUrl = canonicalizeSourceUrl(url);
    const currentItems = itemsRef.current;
    const existing = currentItems.find((item) => canonicalizeSourceUrl(item.url) === canonicalUrl);
    if (existing) {
      log.debug(`Duplicate URL detected: ${url} (existing ID: ${existing.id})`);
      return null; // Indicate duplicate
    }

    const newItem: IDownloadItem = {
      id: generateId(),
      url,
      status: DownloadStatus.Pending,
      metadata,
      importProfile,
      addedAt: new Date(),
    };

    const nextItems = [...currentItems, newItem];
    replaceItems(nextItems);
    return newItem.id;
  }, [replaceItems]);

  const removeFromQueue = useCallback((id: string) => {
    replaceItems((prev) => prev.filter((item) => item.id !== id));
  }, [replaceItems]);

  const updateItem = useCallback((
    id: string,
    updates: Partial<IDownloadItem> | ((currentItem: IDownloadItem) => Partial<IDownloadItem>)
  ) => {
    replaceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        // Support functional updates to avoid stale closure issues
        const actualUpdates = typeof updates === 'function' ? updates(item) : updates;
        return { ...item, ...actualUpdates };
      })
    );
  }, [replaceItems]);

  const clearCompleted = useCallback(() => {
    replaceItems((prev) =>
      prev.filter((item) => item.status !== DownloadStatus.Complete)
    );
  }, [replaceItems]);

  const clearAll = useCallback(() => {
    replaceItems([]);
  }, [replaceItems]);

  // Statistics
  const stats = {
    total: items.length,
    pending: items.filter((i) => i.status === DownloadStatus.Pending).length,
    downloading: items.filter((i) => i.status === DownloadStatus.Downloading).length,
    processing: items.filter((i) => i.status === DownloadStatus.Processing).length,
    complete: items.filter((i) => i.status === DownloadStatus.Complete).length,
    failed: items.filter((i) => i.status === DownloadStatus.Failed).length,
  };

  return {
    items,
    addToQueue,
    removeFromQueue,
    updateItem,
    clearCompleted,
    clearAll,
    isUrlInQueue,
    findByUrl,
    stats,
  };
}
