/**
 * QueuePage - Main download queue page
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { InfoModal } from '@/components/common/InfoModal';
import { ItemLogModal } from '@/components/common/ItemLogModal';
import { RescrapeModal } from '@/components/common/RescrapeModal';
import { AboutModal } from '@/components/common/AboutModal';
import { URLInputForm, type ContentTypeOption } from './URLInputForm';
import { QueueItem } from './QueueItem';
import { BatchImport } from './BatchImport';
import { EditMetadataModal } from './EditMetadataModal';
import { ImportProfilesModal } from './ImportProfilesModal';
import { DuplicateSceneModal, type IDuplicateSceneCandidate } from './DuplicateSceneModal';
import { LogViewer } from '@/components/common';
import { useDownloadQueue, useExternalQueue } from '@/hooks';
import { useToast } from '@/contexts/ToastContext';
import { useLog } from '@/contexts/LogContext';
import { getScraperRegistry } from '@/services/metadata';
import { getStashService, getStashImportService } from '@/services/stash';
import { DownloadStatus } from '@/types';
import type { IDownloadItem, IScrapedMetadata, IEditedMetadata, IImportProfile } from '@/types';
import { createLogger, createImportCallbacks, processConcurrently, getImportProfileForUrl } from '@/utils';
import { useSettings } from '@/hooks';
import { DEFAULT_IMPORT_PROFILE, PLUGIN_ID, PLUGIN_NAME } from '@/constants';
import type { IPluginSettings } from '@/types';
import logoSvg from '@/assets/logo.svg';

const debugLog = createLogger('QueuePage');

export const QueuePage: React.FC = () => {
  const queue = useDownloadQueue();
  const queueItems = queue.items;
  const updateQueueItem = queue.updateItem;
  const toast = useToast();
  const log = useLog();
  const scraperRegistry = getScraperRegistry();
  const { settings, updateSettings } = useSettings();
  const stashService = getStashService();
  const isStashEnvironment = stashService.isStashEnvironment();
  const [editingItem, setEditingItem] = useState<IDownloadItem | null>(null);
  const [viewingLogsForItem, setViewingLogsForItem] = useState<IDownloadItem | null>(null);
  const [urlFieldValue, setUrlFieldValue] = useState('');
  const [showYtDlpWarning, setShowYtDlpWarning] = useState(false);
  const [serverConfigExpanded, setServerConfigExpanded] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [ytDlpVersion, setYtDlpVersion] = useState<string | null>(null);
  const [ytDlpResolutionMethod, setYtDlpResolutionMethod] = useState<string | null>(null);
  const [videoLibraryPath, setVideoLibraryPath] = useState('');
  const [imageLibraryPath, setImageLibraryPath] = useState('');
  const [showImportProfiles, setShowImportProfiles] = useState(false);
  const [duplicateCandidate, setDuplicateCandidate] = useState<{
    scene: IDuplicateSceneCandidate;
    submittedUrl: string;
    contentTypeOption: ContentTypeOption;
    profile: IImportProfile;
  } | null>(null);

  // Batch import state
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const [batchImportProgress, setBatchImportProgress] = useState({ current: 0, total: 0 });
  const batchImportCancelledRef = useRef(false);
  const recoveryStartedRef = useRef(new Set<string>());

  // Re-scrape modal state
  const [rescrapeItem, setRescrapeItem] = useState<IDownloadItem | null>(null);
  const [rescrapeScraperName, setRescrapeScraperName] = useState('');
  const [rescrapeNewMetadata, setRescrapeNewMetadata] = useState<IScrapedMetadata | undefined>(undefined);
  const [rescrapeLoading, setRescrapeLoading] = useState(false);
  const [rescrapeError, setRescrapeError] = useState<string | undefined>(undefined);

  // Ref to hold handleAddUrl for external queue hook
  const handleAddUrlRef = useRef<(url: string, contentType: ContentTypeOption) => void>(() => {});

  // External queue hook - receives URLs from browser extension
  useExternalQueue({
    onUrlReceived: useCallback((url: string, contentType: ContentTypeOption) => {
      handleAddUrlRef.current(url, contentType);
    }, []),
  });

  // Get proxy info for display
  const httpProxy = settings.httpProxy;
  const configuredDownloadPath = String(settings.serverDownloadPath || '').trim();
  const videoDownloadPath = configuredDownloadPath || videoLibraryPath || 'No video-enabled Stash library';
  const imageDownloadPath = configuredDownloadPath || imageLibraryPath || 'No image-enabled Stash library';
  const importProfiles = settings.importProfiles?.length ? settings.importProfiles : [{ ...DEFAULT_IMPORT_PROFILE }];
  const activeImportProfile = importProfiles.find(profile => profile.id === settings.activeImportProfileId) || importProfiles[0]!;
  const profileForCurrentUrl = getImportProfileForUrl(urlFieldValue, importProfiles, activeImportProfile.id);
  const pendingItems = queue.items.filter(item => item.status === DownloadStatus.Pending);
  const autoImportPending = pendingItems.length > 0 && pendingItems.every(item => (item.importProfile || activeImportProfile).autoImport);

  // Fetch and sync settings from Stash on mount (once, no polling)
  useEffect(() => {
    if (!isStashEnvironment) return;

    let mounted = true;

    const syncSettingsFromStash = async () => {
      try {
        const graphqlSettings = await stashService.getPluginSettings(PLUGIN_ID);
        if (!mounted) return;

        if (graphqlSettings && Object.keys(graphqlSettings).length > 0) {
          debugLog.debug('Loaded server settings from Stash:', Object.keys(graphqlSettings).join(', '));

          // Merge Stash settings into local settings (Stash settings take priority)
          updateSettings(graphqlSettings as Partial<IPluginSettings>);

          // Report only that a proxy is configured; never log its credentials.
          if (graphqlSettings.httpProxy) {
            debugLog.debug('HTTP/SOCKS proxy configured');
          }
        }

        const [videoPath, imagePath] = await Promise.all([
          stashService.getVideoLibraryPath(),
          stashService.getImageLibraryPath(),
        ]);
        if (mounted) {
          setVideoLibraryPath(videoPath || '');
          setImageLibraryPath(imagePath || '');
        }
        debugLog.debug(videoPath || imagePath ? 'Loaded image/video library destinations' : 'No image/video Stash library is configured');
      } catch (error) {
        debugLog.warn('Could not fetch settings from Stash:', String(error));
      }
    };

    syncSettingsFromStash();

    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStashEnvironment]);

  // Resume persisted Stash downloads by their saved job/result IDs. Never infer
  // that a task is dead from elapsed time alone.
  useEffect(() => {
    if (!isStashEnvironment) return;
    const recover = async (item: IDownloadItem) => {
      if (recoveryStartedRef.current.has(item.id)) return;
      recoveryStartedRef.current.add(item.id);
      updateQueueItem(item.id, { recoveryState: 'checking', progress: undefined, lastActivityAt: new Date() });

      const editedMetadata = item.editedMetadata || (item.metadata ? {
        title: item.metadata.title,
        description: item.metadata.description,
        date: item.metadata.date,
        performerNames: item.metadata.performers || [],
        tagNames: item.metadata.tags || [],
        studioName: item.metadata.studio,
      } : undefined);

      const canResumeSavedFile = !!item.filePath;
      const canResumeStashJob = !!item.downloadResultId && !!item.downloadProgressId;
      if (!editedMetadata || !item.metadata || (!canResumeSavedFile && !canResumeStashJob)) {
        updateQueueItem(item.id, {
          status: DownloadStatus.Failed,
          recoveryState: 'interrupted',
          error: 'Stash cannot resume this older queue item because its download result was not saved. Check Stash for the file, then retry if needed.',
        });
        return;
      }

      try {
        const callbacks = createImportCallbacks({ itemId: item.id, updateItem: updateQueueItem, debugLog });
        const result = await getStashImportService().importToStash({ ...item, editedMetadata }, callbacks, { resumeDownload: true });
        updateQueueItem(item.id, {
          status: DownloadStatus.Complete,
          stashId: result.id,
          completedAt: new Date(),
          progress: undefined,
          stashJobId: undefined,
          recoveryState: undefined,
          error: undefined,
        });
        log.addLog('success', 'download', `Recovered import: ${item.metadata.title || item.url}`, `Stash ID: ${result.id}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const couldNotReachStash = /graphql|failed to fetch|fetch failed|networkerror|network error|load failed/i.test(errorMessage);
        if (couldNotReachStash) {
          updateQueueItem(item.id, {
            recoveryState: 'checking',
            error: 'Waiting for Stash connection to verify this running job. Reload the downloader to reconnect.',
          });
          debugLog.warn(`Could not reconnect queue item ${item.id}:`, errorMessage);
          return;
        }
        updateQueueItem(item.id, {
          status: DownloadStatus.Failed,
          recoveryState: 'interrupted',
          stashJobId: undefined,
          progress: undefined,
          error: `Recovered import stopped: ${errorMessage}`,
        });
        log.addLog('error', 'download', `Could not recover import: ${item.metadata.title || item.url}`, errorMessage);
      }
    };

    const pendingRecovery = queueItems.filter(item => item.recoveryState === 'pending');
    if (pendingRecovery.length > 0) {
      void (async () => {
        for (const item of pendingRecovery) await recover(item);
      })();
    }
  }, [isStashEnvironment, queueItems, updateQueueItem, log]);

  // Fetch yt-dlp version on mount
  useEffect(() => {
    if (!isStashEnvironment) return;

    const checkYtDlp = async () => {
      try {
        const { getDownloadService } = await import('@/services/download');
        const downloadService = getDownloadService();
        const result = await downloadService.checkServerYtDlp();
        if (result.available && result.version) {
          setYtDlpVersion(result.version);
          setYtDlpResolutionMethod(result.resolutionMethod || null);
          debugLog.debug(`yt-dlp version: ${result.version}${result.resolutionMethod ? ` (${result.resolutionMethod})` : ''}`);
        } else {
          setYtDlpVersion(null);
          setYtDlpResolutionMethod(null);
        }
      } catch (error) {
        debugLog.warn('Could not check yt-dlp:', String(error));
        setYtDlpVersion(null);
      }
    };

    checkYtDlp();
  }, [isStashEnvironment]);

  const enqueueUrl = (url: string, contentTypeOption: ContentTypeOption, profile: IImportProfile, existsInStash?: { id: string; title?: string }) => {
    const itemId = queue.addToQueue(url, undefined, profile);
    if (!itemId) {
      toast.showToast('warning', 'Duplicate URL', 'This URL is already in the queue.');
      return;
    }
    if (existsInStash) queue.updateItem(itemId, { existsInStash });
    log.addLog('info', 'scrape', `Added URL to queue using profile "${profile.name}": ${url}`);

    void (async () => {
      try {
        const preferredContentType = contentTypeOption === 'auto' ? undefined : contentTypeOption;
        const metadata = await scraperRegistry.scrapeWithEnhancement(url, preferredContentType);
        queue.updateItem(itemId, { metadata });
        const details = [
          `Title: ${metadata.title || 'N/A'}`,
          `Content Type: ${metadata.contentType}`,
          `Description: ${metadata.description ? `${metadata.description.substring(0, 100)}...` : 'N/A'}`,
          `Thumbnail: ${metadata.thumbnailUrl ? 'Available' : 'N/A'}`,
          ...(metadata.videoUrl ? [`Video URL: ${metadata.videoUrl.substring(0, 80)}`] : []),
          ...(metadata.imageUrl ? [`Image URL: ${metadata.imageUrl.substring(0, 80)}`] : []),
          ...(metadata.quality ? [`Quality: ${metadata.quality}`] : []),
          ...(metadata.availableQualities?.length ? [`Available Qualities: ${metadata.availableQualities.join(', ')}`] : []),
          ...(metadata.duration ? [`Duration: ${Math.floor(metadata.duration / 60)}m ${metadata.duration % 60}s`] : []),
          `Performers: ${metadata.performers?.length || 0}`,
          `Tags: ${metadata.tags?.length || 0}`,
          ...(metadata.studio ? [`Studio: ${metadata.studio}`] : []),
          ...(metadata.artist ? [`Artist: ${metadata.artist}`] : []),
          ...(metadata.sourceId ? [`Source ID: ${metadata.sourceId}`] : []),
          ...(metadata.sourceRating ? [`Rating: ${metadata.sourceRating}`] : []),
          ...(metadata.sourceScore !== undefined ? [`Score: ${metadata.sourceScore}`] : []),
          ...(metadata.galleryImages?.length ? [`Gallery Images: ${metadata.galleryImages.length}`] : []),
          ...(metadata.capabilities ? [`Capabilities: ${Object.entries(metadata.capabilities).filter(([, enabled]) => enabled).map(([name]) => name.replace(/^has/, '').toLowerCase()).join(', ')}`] : []),
        ];
        log.addLog('success', 'scrape', `Successfully scraped metadata: ${metadata.title || url}`, details.join('\n'));
        toast.showToast('success', 'Metadata Scraped', `Successfully scraped metadata for ${metadata.title || url}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        debugLog.error('Metadata scrape failed:', errorMessage);
        log.addLog('error', 'scrape', `Failed to scrape metadata: ${errorMessage}`);
        toast.showToast('warning', 'Scrape Failed', `Failed to scrape metadata: ${errorMessage}. Item added without metadata.`);
        queue.updateItem(itemId, { error: `Scraping failed: ${errorMessage}` });
      }
    })();
  };

  const handleAddUrl = async (url: string, contentTypeOption: ContentTypeOption = 'auto') => {
    setUrlFieldValue('');
    const profile = getImportProfileForUrl(url, importProfiles, activeImportProfile.id);

    if (queue.isUrlInQueue(url)) {
      const existing = queue.findByUrl(url);
      log.addLog('warning', 'scrape', `Duplicate URL: ${url} (already queued as "${existing?.metadata?.title || 'Pending'}")`);
      toast.showToast('warning', 'Already Queued', `This URL is already in the queue${existing?.metadata?.title ? ` as “${existing.metadata.title}”` : ''}.`);
      return;
    }

    if (isStashEnvironment) {
      try {
        const existingScene = await stashService.findSceneByURL(url);
        if (existingScene) {
          setDuplicateCandidate({
            scene: { id: existingScene.id, title: existingScene.title, url: existingScene.url || url },
            submittedUrl: url,
            contentTypeOption,
            profile,
          });
          return;
        }
      } catch (error) {
        // Keep import available if duplicate lookup is temporarily unavailable.
        debugLog.warn('Failed to check for existing scene:', String(error));
      }
    }

    enqueueUrl(url, contentTypeOption, profile);
  };

  const updateActiveProfile = (updates: Partial<IImportProfile>) => {
    const nextProfiles = importProfiles.map(profile => profile.id === activeImportProfile.id ? { ...profile, ...updates } : profile);
    updateSettings({ importProfiles: nextProfiles });
  };

// Update ref when handleAddUrl changes
  useEffect(() => {
    handleAddUrlRef.current = handleAddUrl;
  });
  const handleBatchImport = async (urls: string[]) => {
    log.addLog('info', 'scrape', `Starting batch import of ${urls.length} URLs (rate-limited to avoid overwhelming Stash)`);
    toast.showToast('info', 'Batch Import Started', `Processing ${urls.length} URLs...`);

    let successCount = 0;
    let errorCount = 0;

    // Process URLs one at a time with a small delay to prevent overwhelming Stash
    // This ensures yt-dlp tasks don't all start simultaneously
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i] as string; // Safe cast - loop bounds guarantee valid index
      try {
        await handleAddUrl(url);
        successCount++;

        // Add a small delay between URLs to let Stash process tasks
        // This prevents "Stash is busy" warnings
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        }
      } catch {
        errorCount++;
      }
    }

    const message = `${successCount} added to queue${errorCount > 0 ? `, ${errorCount} failed` : ''}`;
    log.addLog('success', 'scrape', `Batch complete: ${message}`);
    toast.showToast(
      errorCount > 0 ? 'warning' : 'success',
      'Batch Complete',
      message
    );
  };

  const handleCompleteImport = (itemId: string, stashId: string) => {
    queue.updateItem(itemId, {
      status: DownloadStatus.Complete,
      stashId,
      completedAt: new Date(),
      stashJobId: undefined,
      recoveryState: undefined,
    });

    // Auto-advance to next pending item immediately (modal stays open)
    const pendingItems = queue.items.filter(
      (i) => i.status === DownloadStatus.Pending && i.id !== itemId
    );
    const nextItem = pendingItems[0];
    if (nextItem) {
      setEditingItem(nextItem);
    } else {
      // No more pending items - close modal
      setEditingItem(null);
    }
  };

  // Skip to next pending item
  const handleSkipToNext = () => {
    if (!editingItem) return;

    const pendingItems = queue.items.filter(
      (i) => i.status === DownloadStatus.Pending
    );
    const currentIndex = pendingItems.findIndex((i) => i.id === editingItem.id);

    if (currentIndex >= 0 && currentIndex < pendingItems.length - 1) {
      // Move to next item
      const nextItem = pendingItems[currentIndex + 1];
      if (nextItem) setEditingItem(nextItem);
    } else if (currentIndex === pendingItems.length - 1) {
      // Wrap to first item if at end
      const firstItem = pendingItems[0];
      if (firstItem) setEditingItem(firstItem);
    }
  };

  // Calculate queue position for modal
  const getQueuePosition = (): { position: number; total: number } | null => {
    if (!editingItem) return null;

    const pendingItems = queue.items.filter(
      (i) => i.status === DownloadStatus.Pending
    );
    const currentIndex = pendingItems.findIndex((i) => i.id === editingItem.id);

    if (currentIndex >= 0) {
      return { position: currentIndex + 1, total: pendingItems.length };
    }
    return null;
  };

  const queuePosition = getQueuePosition();

  // Handle re-scrape click - opens the modal and starts scraping
  const handleRescrapeClick = async (itemId: string, scraperName: string) => {
    const item = queue.items.find((i) => i.id === itemId);
    if (!item) return;

    // Reset modal state and open it
    setRescrapeItem(item);
    setRescrapeScraperName(scraperName);
    setRescrapeNewMetadata(undefined);
    setRescrapeError(undefined);
    setRescrapeLoading(true);

    try {
      const metadata = await scraperRegistry.scrapeWithScraper(item.url, scraperName);
      setRescrapeNewMetadata(metadata);
      setRescrapeLoading(false);
      log.addLog('success', 'scrape', `Re-scrape with ${scraperName} completed: ${metadata.title || item.url}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setRescrapeError(errorMsg);
      setRescrapeLoading(false);
      log.addLog('error', 'scrape', `Re-scrape failed with ${scraperName}: ${errorMsg}`);
    }
  };

  // Handle applying merged metadata from re-scrape modal
  const handleRescrapeApply = (mergedMetadata: IScrapedMetadata) => {
    if (!rescrapeItem) return;

    queue.updateItem(rescrapeItem.id, { metadata: mergedMetadata, error: undefined });
    toast.showToast('success', 'Metadata Updated', `Applied merged metadata from ${rescrapeScraperName}`);
    log.addLog('success', 'scrape', `Applied merged metadata for: ${mergedMetadata.title || rescrapeItem.url}`);

    // Close modal
    setRescrapeItem(null);
  };

  // Handle closing the re-scrape modal
  const handleRescrapeClose = () => {
    setRescrapeItem(null);
    setRescrapeNewMetadata(undefined);
    setRescrapeError(undefined);
    setRescrapeLoading(false);
  };

  // Handle retry for failed items
  const handleRetry = async (itemId: string) => {
    const item = queue.items.find((i) => i.id === itemId);
    if (!item) return;

    toast.showToast('info', 'Retry', 'Retrying download...');

    // Reset item status to Pending and clear error
    queue.updateItem(itemId, {
      status: DownloadStatus.Pending,
      error: undefined,
      progress: undefined,
      stashJobId: undefined,
      downloadProgressId: undefined,
      downloadResultId: undefined,
      filePath: undefined,
      fileSize: undefined,
      recoveryState: undefined,
    });

    // If we already have metadata, we don't need to re-scrape - just need to trigger download again
    // The download will be triggered when user clicks Edit & Import
    if (item.metadata) {
      log.addLog('success', 'retry', `Item reset to pending: ${item.metadata.title || item.url}`);
      toast.showToast('success', 'Ready to Retry', 'Item reset to pending. Click "Edit" to retry the download.');
      return;
    }

    // No metadata - need to re-scrape
    debugLog.debug(`Retrying scrape for: ${item.url}`);

    try {
      // No preferred content type since we don't have metadata
      const metadata = await scraperRegistry.scrapeWithEnhancement(item.url, undefined);

      queue.updateItem(itemId, {
        metadata,
        error: undefined,
      });

      log.addLog('success', 'retry', `Retry successful: ${metadata.title || item.url}`);
      toast.showToast('success', 'Retry Successful', `Scraped metadata: ${metadata.title || 'Unknown'}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      queue.updateItem(itemId, {
        error: `Retry failed: ${errorMessage}`,
        status: DownloadStatus.Failed,
      });

      log.addLog('error', 'retry', `Retry failed: ${errorMessage}`);
      toast.showToast('error', 'Retry Failed', errorMessage);
    }
  };

  // Handle cancel for active downloads
  const handleCancel = async (itemId: string) => {
    const item = queue.items.find((i) => i.id === itemId);
    if (!item || !item.stashJobId) {
      toast.showToast('warning', 'Cannot Cancel', 'No active job to cancel');
      return;
    }

    debugLog.debug(`Cancelling download job: ${item.stashJobId}`);
    toast.showToast('info', 'Cancelling', 'Cancelling download...');

    try {
      const success = await stashService.stopJob(item.stashJobId);

      if (success) {
        queue.updateItem(itemId, {
          status: DownloadStatus.Cancelled,
          error: 'Download cancelled by user',
          stashJobId: undefined,
          recoveryState: undefined,
        });

        log.addLog('warning', 'download', `Download cancelled: ${item.metadata?.title || item.url}`);
        toast.showToast('success', 'Cancelled', 'Download cancelled successfully');
      } else {
        toast.showToast('warning', 'Cancel Failed', 'Could not cancel the job - it may have already completed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog.error('Cancel error:', errorMessage);
      toast.showToast('error', 'Cancel Error', errorMessage);
    }
  };

  // Handle batch auto-import - imports all pending items without edit modal
  // Stash processes jobs sequentially, so we import one at a time
  const handleBatchAutoImport = async () => {
    // Prevent double-clicks
    if (isBatchImporting) return;

    const pendingItems = queue.items.filter(
      (item) => item.status === DownloadStatus.Pending && item.metadata
    );

    if (pendingItems.length === 0) {
      toast.showToast('warning', 'No Items', 'No pending items with metadata to import');
      return;
    }

    setIsBatchImporting(true);
    setBatchImportProgress({ current: 0, total: pendingItems.length });
    batchImportCancelledRef.current = false;

    log.addLog('info', 'batch-import', `Starting batch auto-import of ${pendingItems.length} items`);
    toast.showToast('info', 'Batch Import Started', `Importing ${pendingItems.length} items...`);

    const importService = getStashImportService();
    let completedCount = 0;

    try {
      // Process items concurrently using the shared utility
      const { successCount, failCount } = await processConcurrently(
        pendingItems,
        async (item) => {
          // Check for cancellation before starting each item
          if (batchImportCancelledRef.current) {
            throw new Error('Batch import cancelled');
          }

          if (!item.metadata) throw new Error('No metadata');

          // Build editedMetadata from scraped metadata (required for import)
          const editedMetadata: IEditedMetadata = {
            title: item.metadata.title,
            description: item.metadata.description,
            date: item.metadata.date,
            performerNames: item.metadata.performers || [],
            tagNames: item.metadata.tags || [],
            studioName: item.metadata.studio,
          };

          // Build item for import with default settings
          const itemForImport: IDownloadItem = {
            ...item,
            editedMetadata,
            postImportAction: item.postImportAction || item.importProfile?.postImportAction || 'none',
          };

          // Persist import metadata and task intent for queue recovery after reload.
          queue.updateItem(item.id, {
            editedMetadata,
            postImportAction: itemForImport.postImportAction,
            status: DownloadStatus.Processing,
            startedAt: new Date(),
            stashJobId: undefined,
            downloadProgressId: undefined,
            downloadResultId: undefined,
            filePath: undefined,
            fileSize: undefined,
            recoveryState: undefined,
          });

          try {
            // Use shared callback factory
            const callbacks = createImportCallbacks({
              itemId: item.id,
              updateItem: queue.updateItem,
              debugLog,
            });

            const result = await importService.importToStash(itemForImport, callbacks);

            // Mark as complete and update progress
            queue.updateItem(item.id, {
              status: DownloadStatus.Complete,
              stashId: result.id,
              completedAt: new Date(),
              stashJobId: undefined,
              recoveryState: undefined,
            });

            completedCount++;
            setBatchImportProgress((prev) => ({ ...prev, current: completedCount }));

            debugLog.debug(`Batch import: completed ${item.metadata.title || item.url}`);
            return result;
          } catch (importError) {
            // Check if this was a cancellation
            if (batchImportCancelledRef.current) {
              queue.updateItem(item.id, {
                status: DownloadStatus.Cancelled,
                error: 'Batch import cancelled',
              });
              throw importError;
            }

            const errorMessage = importError instanceof Error ? importError.message : 'Unknown error';
            debugLog.error(`Batch import failed for ${item.url}:`, errorMessage);

            queue.updateItem(item.id, {
              status: DownloadStatus.Failed,
              error: `Import failed: ${errorMessage}`,
            });

            completedCount++;
            setBatchImportProgress((prev) => ({ ...prev, current: completedCount }));

            throw importError;
          }
        },
        1 // Stash processes jobs sequentially - no benefit to queuing multiple
      );

      // Show summary
      const wasCancelled = batchImportCancelledRef.current;
      const summaryMessage = wasCancelled
        ? `Cancelled after ${successCount} imported${failCount > 0 ? `, ${failCount} failed` : ''}`
        : `${successCount} imported${failCount > 0 ? `, ${failCount} failed` : ''}`;
      log.addLog(wasCancelled ? 'warning' : failCount > 0 ? 'warning' : 'success', 'batch-import', `Batch import ${wasCancelled ? 'cancelled' : 'complete'}: ${summaryMessage}`);
      toast.showToast(
        wasCancelled ? 'warning' : failCount > 0 ? 'warning' : 'success',
        wasCancelled ? 'Batch Import Cancelled' : 'Batch Import Complete',
        summaryMessage
      );
    } finally {
      setIsBatchImporting(false);
      setBatchImportProgress({ current: 0, total: 0 });
    }
  };

  // Cancel all active batch imports
  const handleCancelBatchImport = async () => {
    if (!isBatchImporting) return;

    batchImportCancelledRef.current = true;
    toast.showToast('info', 'Cancelling', 'Cancelling batch import...');

    // Cancel all plugin jobs in Stash's queue (running + waiting)
    const cancelledJobCount = await stashService.cancelAllPluginJobs(PLUGIN_ID);
    debugLog.info(`Cancelled ${cancelledJobCount} jobs in Stash queue`);

    // Update UI state for all active/processing items
    const activeItems = queue.items.filter(
      (item) => item.status === DownloadStatus.Downloading || item.status === DownloadStatus.Processing
    );

    for (const item of activeItems) {
      queue.updateItem(item.id, {
        status: DownloadStatus.Cancelled,
        error: 'Batch import cancelled by user',
        stashJobId: undefined,
        recoveryState: undefined,
      });
    }

    log.addLog('warning', 'batch-import', `Cancelled batch import (${cancelledJobCount} Stash jobs, ${activeItems.length} queue items)`);
  };

  // Handle clearing all items - cancel active jobs first
  const handleClearAll = async () => {
    // Check for active items
    const activeItems = queue.items.filter(
      (item) => item.status === DownloadStatus.Downloading || item.status === DownloadStatus.Processing
    );

    // If there are active items, cancel all plugin jobs in Stash's queue
    if (activeItems.length > 0) {
      log.addLog('info', 'queue', `Cancelling active job(s) before clearing queue...`);
      const cancelledJobCount = await stashService.cancelAllPluginJobs(PLUGIN_ID);
      toast.showToast('info', 'Jobs Cancelled', `Cancelled ${cancelledJobCount} job(s)`);
    }

    // Now clear the queue
    queue.clearAll();
    log.addLog('info', 'queue', 'Queue cleared');
    toast.showToast('success', 'Queue Cleared', 'All items have been removed from the queue');
  };

  return (
    <div className="d-flex flex-column min-vh-100">
      <div className="container-lg py-4">
        <div className="d-flex flex-column gap-3">
          <header className="ld-header">
            <div className="ld-brand-row">
              <a className="ld-back" href="/scenes" aria-label="Back to Stash scenes">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
                <span>Stash</span>
              </a>
              <span className="ld-brand-divider" aria-hidden="true" />
              <img src={logoSvg} alt="" className="ld-brand-logo" />
              <span className="ld-brand-name">{PLUGIN_NAME}</span>
            </div>
            <div className="ld-header-actions">
            <button
              type="button"
              className="ld-button ld-button-secondary"
              onClick={() => setShowAboutModal(true)}
              title={`About ${PLUGIN_NAME}`}
            >
              <svg height="18" width="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 14.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13z" />
                <path d="M8 6a1 1 0 110-2 1 1 0 010 2zm1.5 5.5a.5.5 0 01-.5.5H7a.5.5 0 010-1h.5V8H7a.5.5 0 010-1h1.5a.5.5 0 01.5.5v3.5h.5a.5.5 0 010 1z" />
              </svg>
              About
            </button>
            </div>
          </header>

          <section className="ld-intro" aria-labelledby="downloaderTitle">
            <div>
              <p className="ld-eyebrow">DOWNLOAD &amp; IMPORT</p>
              <h1 id="downloaderTitle">Bring media into your library.</h1>
              <p className="ld-subtitle">Queue a source URL, review its metadata, and save the finished media to Stash.</p>
            </div>
            <div className="ld-workflow-note">
              <span className="ld-workflow-dot" aria-hidden="true" />
              <span>Choose a profile · Review · Import</span>
            </div>
          </section>

          {/* Proxy and Server Status */}
          {isStashEnvironment && (
            <div className="card text-light mb-3 ld-server-card" style={{ backgroundColor: 'var(--glass-bg, rgba(39, 39, 39, 0.90))', borderColor: 'var(--glass-border, rgba(255, 255, 255, 0.09))' }}>
              <div
                className="card-header d-flex justify-content-between align-items-center ld-server-card-header"
                style={{ backgroundColor: 'var(--mica-elevated, #292929)', borderColor: 'var(--glass-border, rgba(255, 255, 255, 0.09))', cursor: 'pointer' }}
                onClick={() => setServerConfigExpanded(!serverConfigExpanded)}
              >
                <h6 className="mb-0">Server Configuration</h6>
                <button
                  type="button"
                  className="btn btn-sm btn-link text-light p-0"
                  style={{ textDecoration: 'none' }}
                >
                  {serverConfigExpanded ? '▲' : '▼'}
                </button>
              </div>
              {serverConfigExpanded && (
                <div className="card-body">
                  <div className="d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-center">
                      <span style={{ color: 'var(--text-muted, rgba(255, 255, 255, 0.66))' }}>yt-dlp:</span>
                      {ytDlpVersion ? (
                        <div className="d-flex align-items-center gap-2">
                          <span
                            className="badge bg-success"
                            title="The version check passed. Site support and server access are tested when you process a URL."
                          >
                            Available
                          </span>
                          <code className="text-light" style={{ fontSize: '0.85em' }}>{ytDlpVersion}</code>
                          {ytDlpResolutionMethod && (
                            <small style={{ color: 'var(--text-muted, rgba(255, 255, 255, 0.66))' }}>({ytDlpResolutionMethod})</small>
                          )}
                        </div>
                      ) : (
                        <div className="d-flex align-items-center gap-2">
                          <span className="badge bg-danger">Not Found</span>
                          <small style={{ color: 'var(--text-muted, rgba(255, 255, 255, 0.66))' }}>Install the plugin requirements in Stash's Python environment, or set the executable path in plugin settings.</small>
                        </div>
                      )}
                    </div>
                    <div className="d-flex justify-content-between align-items-center">
                      <span style={{ color: 'var(--text-muted, rgba(255, 255, 255, 0.66))' }}>Video download path:</span>
                      <code className="text-light">{videoDownloadPath}</code>
                    </div>
                    <div className="d-flex justify-content-between align-items-center">
                      <span style={{ color: 'var(--text-muted, rgba(255, 255, 255, 0.66))' }}>Image download path:</span>
                      <code className="text-light">{imageDownloadPath}</code>
                    </div>
                    <div className="d-flex justify-content-between align-items-center">
                      <span style={{ color: 'var(--text-muted, rgba(255, 255, 255, 0.66))' }}>HTTP/SOCKS Proxy:</span>
                      {httpProxy ? (
                        <div className="d-flex align-items-center gap-2">
                          <span className="badge bg-success">Enabled</span>
                          <code className="text-light" style={{ fontSize: '0.85em' }}>
                            {httpProxy.replace(/:\/\/[^@]+@/, '://***@')}
                          </code>
                        </div>
                      ) : (
                        <span className="badge bg-secondary">Not Configured</span>
                      )}
                    </div>
                    {httpProxy && (
                      <>
                        <div className="d-flex gap-2 mt-2">
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const { testHttpProxy } = await import('@/utils/systemCheck');
                              const result = await testHttpProxy(httpProxy);
                              if (result.success) {
                                toast.showToast('success', 'Proxy Test', result.message);
                                log.addLog('success', 'proxy', result.message, result.details);
                              } else {
                                toast.showToast('error', 'Proxy Test Failed', result.message);
                                log.addLog('error', 'proxy', result.message, result.details);
                              }
                            }}
                          >
                            Test Proxy
                          </button>
                        </div>
                        <small style={{ color: 'var(--text-muted, rgba(255, 255, 255, 0.66))' }}>
                          Proxy will be used for server-side downloads and metadata extraction. TLS certificate verification remains enabled.
                        </small>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <URLInputForm
            onSubmit={handleAddUrl}
            initialValue={urlFieldValue}
            onValueChange={setUrlFieldValue}
          />

          <div className="card text-light ld-profile-panel" style={{ backgroundColor: 'var(--glass-bg, rgba(39, 39, 39, 0.90))' }}>
            <div className="card-body d-flex flex-wrap align-items-center gap-2 py-2">
              <label htmlFor="importProfileSelect" className="form-label mb-0">Import profile</label>
              <select
                id="importProfileSelect"
                className="form-select form-select-sm"
                value={activeImportProfile.id}
                onChange={event => updateSettings({ activeImportProfileId: event.target.value })}
                style={{ width: 'auto', minWidth: '150px', backgroundColor: 'var(--stash-input-bg)', borderColor: 'var(--stash-border)', color: 'var(--stash-text)' }}
              >
                {importProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowImportProfiles(true)}>Manage profiles</button>
              {urlFieldValue.trim() && profileForCurrentUrl.id !== activeImportProfile.id && (
                <small className="text-muted">This URL will use “{profileForCurrentUrl.name}” by domain.</small>
              )}
              {!urlFieldValue.trim() && <small className="text-muted">Queued items keep a snapshot of their profile.</small>}
            </div>
          </div>

          {/* Batch Import */}
          <div className="mb-3 ld-batch-area">
            <BatchImport
              onImport={handleBatchImport}
              onSingleUrl={(url) => {
                setUrlFieldValue(url);
              }}
            />
          </div>

          {/* Queue Statistics */}
          <section className="ld-summary" aria-label="Download queue summary">
            <article className="ld-stat-card"><span className="ld-stat-label">In queue</span><strong>{queue.stats.total}</strong><span className="ld-stat-caption">all queue items</span></article>
            <article className="ld-stat-card"><span className="ld-stat-label">Downloading</span><strong>{queue.stats.downloading + queue.stats.processing}</strong><span className="ld-stat-caption">active Stash work</span></article>
            <article className="ld-stat-card"><span className="ld-stat-label">Completed</span><strong>{queue.stats.complete}</strong><span className="ld-stat-caption">saved to Stash</span></article>
            <article className="ld-stat-card"><span className="ld-stat-label">Needs review</span><strong>{queue.stats.failed}</strong><span className="ld-stat-caption">failed or interrupted</span></article>
          </section>

          {/* Bulk Actions */}
          {queue.items.length > 0 && (
            <div className="d-flex gap-2 mb-3 ld-queue-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (autoImportPending) {
                    // Auto-import: process all pending items without edit modal
                    handleBatchAutoImport();
                  } else {
                    // Manual: open edit modal for first pending item
                    const firstPending = queue.items.find(item => item.status === DownloadStatus.Pending);
                    if (firstPending) setEditingItem(firstPending);
                  }
                }}
                disabled={queue.stats.pending === 0 || isBatchImporting}
                title={autoImportPending
                  ? 'Download and import all pending items without editing'
                  : 'Review and import each item individually'
                }
              >
                {isBatchImporting
                  ? `⏳ Importing ${batchImportProgress.current}/${batchImportProgress.total}...`
                  : autoImportPending
                    ? `⚡ Import All (${queue.stats.pending} items)`
                    : `📝 Edit & Import (${queue.stats.pending} items)`
                }
              </button>
              {isBatchImporting && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={handleCancelBatchImport}
                  title="Cancel all active downloads"
                >
                  ⏹️ Cancel All
                </button>
              )}
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={queue.clearCompleted}
                disabled={queue.stats.complete === 0}
              >
                Clear Completed
              </button>
              <button
                className="btn btn-outline-danger btn-sm"
                onClick={handleClearAll}
                disabled={isBatchImporting}
                title="Cancel active jobs and clear all items from queue"
              >
                Clear All
              </button>
            </div>
          )}

          {/* Queue Toolbar - Preview toggle, Auto-import toggle, and Log level */}
          <div className="d-flex justify-content-between align-items-center mb-2 px-2 ld-queue-toolbar">
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className={`btn btn-sm ${settings.showThumbnailPreviews ? 'btn-success' : 'btn-outline-secondary'}`}
                onClick={() => updateSettings({ showThumbnailPreviews: !settings.showThumbnailPreviews })}
                style={{ minWidth: '140px' }}
              >
                {settings.showThumbnailPreviews ? '🖼️ Thumbnails On' : '🖼️ Thumbnails Off'}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeImportProfile.autoImport ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => updateActiveProfile({ autoImport: !activeImportProfile.autoImport })}
                title={activeImportProfile.autoImport
                  ? `Auto-import is on for the ${activeImportProfile.name} profile`
                  : `Auto-import is off for the ${activeImportProfile.name} profile`
                }
                style={{ minWidth: '140px' }}
              >
                {activeImportProfile.autoImport ? '⚡ Auto-Import On' : '⚡ Auto-Import Off'}
              </button>
            </div>
            <div className="d-flex align-items-center gap-2">
              <label className="form-label mb-0 text-light" htmlFor="logLevelSelect" style={{ fontSize: '0.85em' }}>
                Log Level:
              </label>
              <select
                id="logLevelSelect"
                className="form-select form-select-sm"
                style={{ backgroundColor: 'var(--mica-elevated, #292929)', borderColor: 'var(--glass-border, rgba(255, 255, 255, 0.09))', color: 'var(--text, rgba(255, 255, 255, 0.94))', width: 'auto' }}
                value={settings.logLevel}
                onChange={(e) => updateSettings({ logLevel: e.target.value as IPluginSettings['logLevel'] })}
              >
                <option value="off">Off</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
            </div>
          </div>

          {/* Queue Items */}
          {queue.items.length === 0 ? (
            <div className="ld-empty-state">
              <div className="ld-empty-art" aria-hidden="true">
                <svg viewBox="0 0 96 96" fill="none"><path d="M22 16h35l18 18v43a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5V21a5 5 0 0 1 5-5Z" /><path d="M57 17v18h17M34 51h28M34 62h19" /><circle cx="65" cy="66" r="16" /><path d="m76 78 9 9m-20-22v8m-4-4h8" /></svg>
              </div>
              <p className="ld-eyebrow">READY WHEN YOU ARE</p>
              <h2>No downloads in your queue yet.</h2>
              <p>Add a media URL above to scrape its details, choose an import profile, and prepare it for Stash.</p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-2 ld-queue-list">
              {queue.items.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  onRemove={queue.removeFromQueue}
                  onEdit={(id) => {
                    // Find item and open edit modal
                    const itemToEdit = queue.items.find((i) => i.id === id);
                    if (itemToEdit) {
                      setEditingItem(itemToEdit);
                    }
                  }}
                  onViewLogs={(id) => {
                    // Find item and open logs modal
                    const itemToView = queue.items.find((i) => i.id === id);
                    if (itemToView) {
                      setViewingLogsForItem(itemToView);
                    }
                  }}
                  onRescrapeClick={handleRescrapeClick}
                  onRetry={handleRetry}
                  onCancel={handleCancel}
                  availableScrapers={scraperRegistry.getAvailableScrapersForUrl(item.url, item.metadata?.contentType)}
                  showThumbnail={settings.showThumbnailPreviews}
                />
              ))}
            </div>
          )}

          {/* Activity Log */}
          <LogViewer />
        </div>
      </div>

      {/* Edit Metadata Modal */}
      <EditMetadataModal
        item={editingItem}
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        onComplete={handleCompleteImport}
        onUpdateItem={queue.updateItem}
        queuePosition={queuePosition?.position}
        totalPending={queuePosition?.total}
        onSkip={handleSkipToNext}
      />

      {showImportProfiles && (
        <ImportProfilesModal
          profiles={importProfiles}
          activeProfileId={activeImportProfile.id}
          onClose={() => setShowImportProfiles(false)}
          onSave={(profiles, nextActiveProfileId) => {
            updateSettings({ importProfiles: profiles, activeImportProfileId: nextActiveProfileId });
            setShowImportProfiles(false);
            toast.showToast('success', 'Profiles Saved', `${profiles.length} import profile${profiles.length === 1 ? '' : 's'} saved.`);
          }}
        />
      )}

      {duplicateCandidate && (
        <DuplicateSceneModal
          scene={duplicateCandidate.scene}
          onSkip={() => setDuplicateCandidate(null)}
          onOpen={() => {
            window.open(`/scenes/${encodeURIComponent(duplicateCandidate.scene.id)}`, '_blank', 'noopener,noreferrer');
            setDuplicateCandidate(null);
          }}
          onAddAnyway={() => {
            enqueueUrl(
              duplicateCandidate.submittedUrl,
              duplicateCandidate.contentTypeOption,
              duplicateCandidate.profile,
              { id: duplicateCandidate.scene.id, title: duplicateCandidate.scene.title }
            );
            setDuplicateCandidate(null);
          }}
        />
      )}

      {/* yt-dlp Warning Modal */}
      <InfoModal
        open={showYtDlpWarning}
        onClose={() => setShowYtDlpWarning(false)}
        title="yt-dlp Not Installed"
        severity="warning"
        maxWidth="md"
      >
        <div className="d-flex flex-column gap-3">
          <div className="alert alert-info">
            <strong>yt-dlp</strong> is a powerful video extraction tool that provides the highest quality downloads from hundreds of sites.
          </div>

          <p className="mb-0">
            <strong>What's happening:</strong>
          </p>
          <div>
            • yt-dlp was not detected via Python module or system PATH<br />
            • The app will fall back to built-in scrapers<br />
            • Built-in scrapers may only extract <strong>lower quality videos</strong> (360p-480p)<br />
            • Some sites may not work at all without yt-dlp
          </div>

          <p className="mb-0 mt-2">
            <strong>Option 1: Install dependencies in Stash's Python environment</strong>
          </p>
          <p className="mb-0">
            Use the interpreter configured for Stash. For Docker installs, add these packages to the image or startup process so they remain available after a container is recreated.
          </p>
          <pre className="bg-dark text-light p-3 rounded" style={{ overflow: 'auto' }}>
            <code>python -m pip install yt-dlp &quot;requests[socks]&quot;</code>
          </pre>

          <p className="mb-0 mt-2">
            <strong>Option 2: Set custom path in plugin settings</strong>
          </p>
          <div>
            If yt-dlp is installed but not detected, set the <strong>yt-dlp Path</strong> setting
            in Stash &rarr; Settings &rarr; Plugins &rarr; Stash Downloader to the full path
            (e.g., <code>/usr/local/bin/yt-dlp</code> or <code>C:\tools\yt-dlp.exe</code>).
          </div>

          <div className="alert alert-success mt-2">
            <small>
              <strong>How detection works:</strong> The plugin first tries <code>python -m yt_dlp</code> (same Python environment),
              then falls back to the <code>yt-dlp</code> CLI on PATH. A custom path in settings overrides both.
            </small>
          </div>
        </div>
      </InfoModal>

      {/* Item Log Modal */}
      <ItemLogModal
        open={!!viewingLogsForItem}
        onClose={() => setViewingLogsForItem(null)}
        title={viewingLogsForItem?.metadata?.title || viewingLogsForItem?.url || ''}
        logs={viewingLogsForItem?.logs || []}
      />

      {/* Re-scrape Comparison Modal */}
      <RescrapeModal
        open={!!rescrapeItem}
        onClose={handleRescrapeClose}
        originalMetadata={rescrapeItem?.metadata}
        newMetadata={rescrapeNewMetadata}
        scraperName={rescrapeScraperName}
        onApply={handleRescrapeApply}
        isLoading={rescrapeLoading}
        error={rescrapeError}
      />

      {/* About Modal */}
      <AboutModal
        open={showAboutModal}
        onClose={() => setShowAboutModal(false)}
      />
    </div>
  );
};
