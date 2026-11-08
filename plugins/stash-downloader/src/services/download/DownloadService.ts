/**
 * DownloadService - Handles file downloads
 *
 * In Stash environment:
 * 1. Server-side download via Stash plugin task (uses yt-dlp on server)
 * 2. Direct URL download (if videoUrl/imageUrl provided by scraper)
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Python plugin task results have dynamic structure */

import type { IDownloadProgress, IGalleryProgress } from '@/types';
import type { IServerDownloadTracking } from '@/types';
import { ContentType } from '@/types';
import { fetchWithTimeout, createLogger } from '@/utils';
import { getStashService } from '@/services/stash/StashGraphQLService';
import { PLUGIN_ID } from '@/constants';

const log = createLogger('DownloadService');

export interface IDownloadProgressWithActivity extends IDownloadProgress {
  lastActivityAt?: Date;
  statusMessage?: string;
}

export interface IDownloadOptions {
  onProgress?: (progress: IDownloadProgressWithActivity) => void;
  /** Called when the Stash job starts, with the jobId for potential cancellation */
  onJobStart?: (jobId: string) => void;
  signal?: AbortSignal;
  outputDir?: string;
  filename?: string;
  quality?: 'best' | '1080p' | '720p' | '480p';
  /** Fallback URL for yt-dlp if direct download fails (e.g., original page URL) */
  fallbackUrl?: string;
  /** Persisted Stash task IDs used only when recovering an interrupted import. */
  resumeTracking?: IServerDownloadTracking;
  onTrackingIds?: (tracking: IServerDownloadTracking) => void;
  /** Persist the finished server file path before the temporary task result is cleaned up. */
  onServerFileSaved?: (filePath: string, fileSize?: number) => void;
  onActivity?: () => void;
  /** Continue an import from a server file that was already downloaded. */
  resumeFilePath?: string;
}

export interface IServerDownloadResult {
  success: boolean;
  file_path?: string;
  file_size?: number;
  library_path?: string;
  error?: string;
  jobId?: string;
}

export interface IServerYtDlpStatus {
  available: boolean;
  version?: string;
  resolutionMethod?: string;
  managedEnvironmentPath?: string;
  canManage?: boolean;
}

export interface IServerYtDlpManageResult {
  success: boolean;
  version?: string;
  action?: 'install' | 'update';
  managedEnvironmentPath?: string;
  error?: string;
}

export interface IGalleryDownloadResult {
  success: boolean;
  filePaths: string[];
  totalImages: number;
  error?: string;
}

export class DownloadService {
  /**
   * Check if we're running in Stash environment
   */
  isStashEnvironment(): boolean {
    try {
      const stashService = getStashService();
      return stashService.isStashEnvironment();
    } catch {
      return false;
    }
  }

  /**
   * Download using server-side plugin task (no CORS issues)
   * This uses Stash's runPluginTask to execute the Python backend
   */
  async downloadServerSide(
    url: string,
    options: IDownloadOptions = {},
    mediaType: 'video' | 'image' = 'video'
  ): Promise<IServerDownloadResult> {
    log.info('Attempting server-side download via plugin task');
    let progressPollInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const stashService = getStashService();

      if (!stashService.isStashEnvironment()) {
        return { success: false, error: 'Not in Stash environment' };
      }

      if (options.resumeFilePath) {
        options.onServerFileSaved?.(options.resumeFilePath);
        return { success: true, file_path: options.resumeFilePath };
      }

      // Persist IDs before task creation so a page reload can reconnect to this exact job.
      const uniqueId = options.resumeTracking?.progressId || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const resultId = options.resumeTracking?.resultId || `download-${uniqueId}`;
      const progressId = options.resumeTracking?.progressId || uniqueId; // Progress file will be "progress-{uniqueId}"
      options.onTrackingIds?.({ jobId: options.resumeTracking?.jobId, progressId, resultId });
      log.debug('Result ID:', resultId);
      log.debug('Progress ID:', progressId);

      // Run the download task and wait for completion
      log.info('Starting download task with parameters:', JSON.stringify({
        host: new URL(url).hostname,
        quality: options.quality || 'best',
      }));

      // Start progress polling in background
      let pollCount = 0;
      if (options.onProgress) {
        log.debug(`Starting progress polling with progressId: ${progressId}`);
        progressPollInterval = setInterval(async () => {
          pollCount++;
          try {
            const progressResult = await stashService.runPluginOperation(PLUGIN_ID, {
              mode: 'read_result',
              result_id: `progress-${progressId}`,
            }) as any;

            // Log every 5th poll to avoid spam
            if (pollCount % 5 === 1 || progressResult?.retrieved) {
              log.debug(`Progress poll #${pollCount}: retrieved=${progressResult?.retrieved}, status=${progressResult?.status}, pct=${progressResult?.percentage}`);
            }

            // Check if we got progress data (retrieved=true means file was found)
            if (progressResult?.retrieved) {
              const status = progressResult.status;
              // Update progress for downloading or starting status
              if (status === 'downloading' || status === 'starting') {
                const progress: IDownloadProgressWithActivity = {
                  bytesDownloaded: progressResult.downloaded_bytes || 0,
                  totalBytes: progressResult.total_bytes || 0,
                  percentage: progressResult.percentage || 0,
                  speed: progressResult.speed || 0,
                  timeRemaining: progressResult.eta,
                  // Include heartbeat timestamp for stale detection
                  lastActivityAt: progressResult.last_updated ? new Date(progressResult.last_updated * 1000) : new Date(),
                  statusMessage: progressResult.message,
                };
                log.debug(`Progress update: ${progress.percentage.toFixed(1)}% - ${progress.bytesDownloaded}/${progress.totalBytes} bytes (activity: ${progress.lastActivityAt?.toISOString()})`);
                options.onProgress!(progress);
              }
            }
            // not_found is expected early in download - silently ignore
          } catch (err) {
            // Log error occasionally for debugging
            if (pollCount === 1) {
              log.debug(`Progress poll error (first attempt): ${err}`);
            }
          }
        }, 1000); // Poll every second
      }

      const taskResult = options.resumeTracking
        ? {
            ...(options.resumeTracking.jobId
              ? await stashService.waitForTrackedJob(options.resumeTracking.jobId, {
                  maxWaitMs: 21600000,
                  onProgress: () => options.onActivity?.(),
                })
              : { success: true }),
            jobId: options.resumeTracking.jobId,
          }
        : await stashService.runPluginTaskAndWait(
            PLUGIN_ID,
            'Download Media',
            {
              mode: 'download',
              url: url,
              media_type: mediaType,
              fallback_url: options.fallbackUrl,
              filename: options.filename,
              quality: options.quality || 'best',
              result_id: resultId,
              progress_id: progressId,
            },
            {
              maxWaitMs: 21600000,
              onProgress: (_stashJobProgress) => {
                // Media progress comes from the result file poll above.
                options.onActivity?.();
              },
              onJobStart: (jobId) => {
                log.debug(`Download job started with ID: ${jobId}`);
                options.onJobStart?.(jobId);
                options.onTrackingIds?.({ jobId, progressId, resultId });
              },
            }
          );

      // Stop progress polling
      if (progressPollInterval) {
        clearInterval(progressPollInterval);
        progressPollInterval = null;
      }

      // Cleanup progress file
      stashService.runPluginOperation(PLUGIN_ID, {
        mode: 'cleanup_result',
        result_id: `progress-${progressId}`,
      }).catch(() => { /* ignore cleanup errors */ });

      log.debug('Task result:', JSON.stringify(taskResult));

      // Capture jobId for potential cancellation
      const jobId = taskResult.jobId;

      if (!taskResult.success) {
        log.error('Download task failed:', taskResult.error || 'Unknown error');
        return { success: false, error: taskResult.error || 'Download task failed', jobId };
      }

      log.info('Server-side download task completed, reading result...');

      // Read the result to get file_path
      const result = await stashService.runPluginOperation(PLUGIN_ID, {
        mode: 'read_result',
        result_id: resultId,
      }) as any;

      log.debug('Read result response:', JSON.stringify(result));

      if (!result) {
        log.error('Failed to read download result - got null/undefined');
        return { success: false, error: 'Failed to read download result', jobId };
      }

      // Check if result file wasn't found (download may have failed before writing result)
      if (result.retrieved === false || result.not_found) {
        log.error('Download result file not found - download may have failed silently');
        return { success: false, error: 'Download failed - no result file was created. Check Stash logs for details.', jobId };
      }

      // Check for task_error (renamed from result_error/error to avoid GraphQL error interpretation)
      if (result.task_error) {
        log.error('Download task error:', result.task_error);
        return { success: false, error: result.task_error, jobId };
      }

      // Legacy check for error field (shouldn't happen with updated Python script)
      if (result.error) {
        log.error('Download error:', result.error);
        return { success: false, error: result.error, jobId };
      }

      const filePath = result.file_path;
      const fileSize = result.file_size;

      if (!filePath) {
        // Log full result for debugging
        log.error('Download completed but no file_path in result. Full result:', JSON.stringify(result));
        return { success: false, error: 'Download completed but no file_path in result', jobId };
      }

      options.onServerFileSaved?.(filePath, fileSize);

      log.success('Server-side download succeeded', filePath);

      // Cleanup result file
      stashService.runPluginTask(PLUGIN_ID, 'Cleanup Result', {
        mode: 'cleanup_result',
        result_id: resultId,
      }).catch((err) => {
        log.warn('Cleanup error (ignored)', String(err));
      });

      return {
        success: true,
        file_path: filePath,
        file_size: fileSize,
        library_path: result.library_path,
        jobId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`Server-side download failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    } finally {
      if (progressPollInterval) clearInterval(progressPollInterval);
    }
  }

  /**
   * Check if yt-dlp is available on the server and get version
   */
  async checkServerYtDlp(): Promise<IServerYtDlpStatus> {
    try {
      const stashService = getStashService();

      if (!stashService.isStashEnvironment()) {
        return { available: false };
      }

      // Pass ytdlpPath setting if configured
      const result = await stashService.runPluginOperation(PLUGIN_ID, {
        mode: 'check_ytdlp',
      }) as {
        available?: boolean;
        version?: string;
        resolution_method?: string;
        managed_environment_path?: string;
        can_manage?: boolean;
      } | null;

      return {
        available: result?.available === true,
        version: result?.version || undefined,
        resolutionMethod: result?.resolution_method || undefined,
        managedEnvironmentPath: result?.managed_environment_path || undefined,
        canManage: result?.can_manage !== false,
      };
    } catch {
      return { available: false };
    }
  }

  /** Install or update yt-dlp in the downloader's isolated server-side environment. */
  async manageServerYtDlp(action: 'install' | 'update'): Promise<IServerYtDlpManageResult> {
    const stashService = getStashService();
    if (!stashService.isStashEnvironment()) {
      return { success: false, error: 'This action is available only from the Stash server.' };
    }

    const resultId = `ytdlp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const taskResult = await stashService.runPluginTaskAndWait(
      PLUGIN_ID,
      'Manage yt-dlp',
      { mode: 'manage_ytdlp', action, result_id: resultId },
      { pollIntervalMs: 1000, maxWaitMs: 20 * 60 * 1000 }
    );

    if (!taskResult.success) {
      return { success: false, error: taskResult.error || 'The yt-dlp management task failed.' };
    }

    try {
      const result = await stashService.runPluginOperation(PLUGIN_ID, {
        mode: 'read_result',
        result_id: resultId,
      }) as {
        retrieved?: boolean;
        success?: boolean;
        version?: string;
        action?: 'install' | 'update';
        managed_environment_path?: string;
        task_error?: string;
        error?: string;
      } | null;

      if (!result?.retrieved) {
        return { success: false, error: 'The yt-dlp task finished without returning its result. Check the Stash log for details.' };
      }
      if (!result.success || result.task_error || result.error) {
        return { success: false, error: result.task_error || result.error || 'The yt-dlp install/update failed.' };
      }
      if (!result.version) {
        return { success: false, error: 'yt-dlp was installed but no version was reported.' };
      }

      return {
        success: true,
        version: result.version,
        action: result.action || action,
        managedEnvironmentPath: result.managed_environment_path,
      };
    } finally {
      void stashService.runPluginOperation(PLUGIN_ID, {
        mode: 'cleanup_result',
        result_id: resultId,
      }).catch(() => { /* ignore cleanup errors */ });
    }
  }

  /**
   * Check if URL is external (not same-origin)
   * In Stash environment, external URLs must use server-side download to avoid CSP issues
   */
  private isExternalUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const currentOrigin = window.location.origin;
      return urlObj.origin !== currentOrigin;
    } catch {
      // If URL parsing fails, assume it's external
      return true;
    }
  }


  /**
   * Download an image file directly
   */
  async downloadImage(
    imageUrl: string,
    options: IDownloadOptions = {}
  ): Promise<Blob> {
    const { onProgress, signal } = options;

    if (this.isStashEnvironment() && this.isExternalUrl(imageUrl)) {
      const stashService = getStashService();
      const serverResult = await this.downloadServerSide(imageUrl, options, 'image');
      if (!serverResult.success || !serverResult.file_path) {
        throw new Error(serverResult.error || 'Server-side image download failed');
      }
      const libraryPath = serverResult.library_path || await stashService.getImageLibraryPath();
      const scanJobId = await stashService.triggerScanForFile(serverResult.file_path);
      const imageBlob = new Blob([], { type: 'image/*' }) as Blob & {
        __serverFilePath?: string;
        __libraryPath?: string | null;
        __scanJobId?: string | null;
      };
      imageBlob.__serverFilePath = serverResult.file_path;
      imageBlob.__libraryPath = libraryPath;
      imageBlob.__scanJobId = scanJobId;
      return imageBlob;
    }

    log.info('Downloading image from remote host');

    let response: Response;
    try {
      response = await fetchWithTimeout(imageUrl, { signal }, 60000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown network error';
      throw new Error(`Image download failed: ${errorMessage}`);
    }

    if (!response.ok) {
      throw new Error(`Image download failed: ${response.statusText} (${response.status})`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesDownloaded = 0;
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      bytesDownloaded += value.length;

      if (onProgress) {
        const elapsedTime = (Date.now() - startTime) / 1000;
        const speed = bytesDownloaded / elapsedTime;

        onProgress({
          bytesDownloaded,
          totalBytes,
          percentage: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
          speed,
          timeRemaining: totalBytes > 0 ? (totalBytes - bytesDownloaded) / speed : undefined,
        });
      }
    }

    log.success(`Image download complete: ${bytesDownloaded} bytes`);
    return new Blob(chunks as BlobPart[], { type: contentType });
  }

  /**
   * Download a gallery (multiple images from one URL)
   */
  async downloadGallery(
    images: Array<{ url: string; filename?: string }>,
    options: IDownloadOptions = {},
    onGalleryProgress?: (progress: IGalleryProgress) => void
  ): Promise<{ blobs: Blob[]; filePaths: string[] }> {
    const downloadedBlobs: Blob[] = [];
    const filePaths: string[] = [];

    log.info(`Starting gallery download: ${images.length} images`);

    for (let i = 0; i < images.length; i++) {
      const image = images[i]!;

      if (onGalleryProgress) {
        onGalleryProgress({
          totalImages: images.length,
          downloadedImages: i,
          currentImageUrl: image.url,
        });
      }

      try {
        let host = 'remote host';
        try { host = new URL(image.url).hostname; } catch { /* Keep the gallery download attempt safe to log. */ }
        log.info(`Downloading gallery image ${i + 1}/${images.length} from ${host}`);
        const blob = await this.downloadImage(image.url, options);
        downloadedBlobs.push(blob);

        const filename = image.filename ?? this.getFilenameFromUrl(image.url, i);
        filePaths.push(filename);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(`Failed to download gallery image ${i + 1}: ${errorMsg}`);
      }
    }

    if (onGalleryProgress) {
      onGalleryProgress({
        totalImages: images.length,
        downloadedImages: images.length,
        currentImageUrl: undefined,
      });
    }

    log.success(`Gallery download complete: ${downloadedBlobs.length}/${images.length} images`);
    return { blobs: downloadedBlobs, filePaths };
  }

  /**
   * Get filename from URL for gallery images
   */
  private getFilenameFromUrl(url: string, index: number): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop();
      if (filename && filename.includes('.')) {
        return filename;
      }
    } catch {
      // Ignore URL parsing errors
    }
    const ext = this.getFileExtension(url) || 'jpg';
    return `image_${index + 1}.${ext}`;
  }

  /**
   * Download file from URL and return as Blob
   */
  async download(
    url: string,
    options: IDownloadOptions = {},
    videoUrl?: string,
    imageUrl?: string,
    contentType?: ContentType
  ): Promise<Blob> {
    // Route image downloads through simpler path
    if (contentType === ContentType.Image) {
      const targetUrl = imageUrl || url;
      log.info('Routing to image download path');
      return this.downloadImage(targetUrl, options);
    }

    // PRIORITY 1: If we have a direct imageUrl from scraper, use it
    if (imageUrl && imageUrl !== url && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
      log.debug('Using direct imageUrl from scraper');
      try {
        return await this.downloadDirect(imageUrl, options);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warn(`Direct imageUrl download failed: ${errorMessage}`);
        throw error;
      }
    }

    // PRIORITY 2: If we have a direct videoUrl from scraper
    if (videoUrl && videoUrl !== url && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))) {
      log.debug('Using direct videoUrl from scraper');

      // In Stash environment, use server-side download for external URLs to avoid CSP issues
      if (this.isStashEnvironment() && this.isExternalUrl(videoUrl)) {
        log.debug('Using server-side download for external videoUrl (CSP bypass)');
        try {
          const stashService = getStashService();

          // Pass original page URL as fallback for yt-dlp if direct download fails
          const serverResult = await this.downloadServerSide(videoUrl, { ...options, fallbackUrl: url });
          if (serverResult.success && serverResult.file_path) {
            log.debug('Server-side download complete:', serverResult.file_path);
            const libraryPath = serverResult.library_path || await stashService.getVideoLibraryPath();

            let scanJobId: string | null = null;
            if (libraryPath) {
              log.debug('Triggering Stash scan for:', serverResult.file_path);
              scanJobId = await stashService.triggerScanForFile(serverResult.file_path);
              if (scanJobId) {
                log.debug('Scan job started:', scanJobId);
              }
            }

            // Return empty blob with metadata
            const emptyBlob = new Blob([], { type: 'application/octet-stream' });
            (emptyBlob as any).__serverFilePath = serverResult.file_path;
            (emptyBlob as any).__libraryPath = libraryPath;
            (emptyBlob as any).__scanJobId = scanJobId;
            return emptyBlob;
          } else {
            throw new Error(serverResult.error || 'Server-side download failed');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error(`Server-side download failed: ${errorMessage}`);
          throw error;
        }
      }

      // Fallback to direct download (for same-origin URLs or non-Stash environments)
      try {
        return await this.downloadDirect(videoUrl, options);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warn(`Direct videoUrl download failed: ${errorMessage}`);
        // Fall through to server-side download
      }
    }

    // PRIORITY 3: Use server-side download for external URLs in Stash environment
    // This handles both yt-dlp domains and any other external URLs (CSP bypass)
    if (this.isStashEnvironment() && this.isExternalUrl(url)) {
      log.debug('Using server-side download for external URL (CSP bypass)');
      if (options.fallbackUrl) {
        log.debug('Fallback URL available for yt-dlp retry');
      }
      try {
        const stashService = getStashService();

        // Pass fallbackUrl for yt-dlp if direct download fails
        const serverResult = await this.downloadServerSide(url, options);
        if (serverResult.success && serverResult.file_path) {
          log.debug('Server-side download complete:', serverResult.file_path);
          const libraryPath = serverResult.library_path || await stashService.getVideoLibraryPath();

          let scanJobId: string | null = null;
          if (libraryPath) {
            log.debug('Triggering Stash scan for:', serverResult.file_path);
            scanJobId = await stashService.triggerScanForFile(serverResult.file_path);
            if (scanJobId) {
              log.debug('Scan job started:', scanJobId);
            }
          }

          // Return empty blob with metadata
          const emptyBlob = new Blob([], { type: 'application/octet-stream' });
          (emptyBlob as any).__serverFilePath = serverResult.file_path;
          (emptyBlob as any).__libraryPath = libraryPath;
          (emptyBlob as any).__scanJobId = scanJobId;
          return emptyBlob;
        } else {
          throw new Error(serverResult.error || 'Server-side download failed');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Server-side download failed: ${errorMessage}`);
        throw error;
      }
    }

    // Otherwise use regular fetch (for same-origin URLs or non-Stash environments)
    return this.downloadDirect(url, options);
  }

  /**
   * Download file directly from URL
   */
  private async downloadDirect(
    url: string,
    options: IDownloadOptions = {}
  ): Promise<Blob> {
    const { onProgress, signal } = options;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, { signal }, 300000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown network error';
      throw new Error(`Download failed: ${errorMessage}`);
    }

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText} (${response.status})`);
    }

    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type') || 'video/mp4';
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesDownloaded = 0;
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
      bytesDownloaded += value.length;

      if (onProgress) {
        const elapsedTime = (Date.now() - startTime) / 1000;
        const speed = bytesDownloaded / elapsedTime;
        const percentage = totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0;
        const timeRemaining = totalBytes > 0 ? (totalBytes - bytesDownloaded) / speed : undefined;

        onProgress({
          bytesDownloaded,
          totalBytes,
          percentage,
          speed,
          timeRemaining,
        });
      }
    }

    return new Blob(chunks as BlobPart[], { type: contentType });
  }

  /**
   * Download file and convert to data URL
   */
  async downloadAsDataUrl(url: string): Promise<string> {
    const blob = await this.download(url);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Get file extension from URL
   */
  getFileExtension(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([^.]+)$/);
      return match ? match[1]!.toLowerCase() : '';
    } catch {
      return '';
    }
  }

  /**
   * Detect content type from URL
   */
  async detectContentType(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.headers.get('content-type');
    } catch {
      return null;
    }
  }
}

// Singleton instance
let instance: DownloadService | null = null;

export function getDownloadService(): DownloadService {
  if (!instance) {
    instance = new DownloadService();
  }
  return instance;
}
