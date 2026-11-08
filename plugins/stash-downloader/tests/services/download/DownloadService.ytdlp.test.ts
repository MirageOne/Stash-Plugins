import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stashService } = vi.hoisted(() => ({
  stashService: {
    isStashEnvironment: vi.fn(),
    runPluginTaskAndWait: vi.fn(),
    runPluginOperation: vi.fn(),
  },
}));

vi.mock('@/services/stash/StashGraphQLService', () => ({
  getStashService: () => stashService,
}));

import { DownloadService } from '@/services/download/DownloadService';

describe('DownloadService yt-dlp management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stashService.isStashEnvironment.mockReturnValue(true);
    stashService.runPluginTaskAndWait.mockResolvedValue({ success: true, jobId: 'job-1' });
    stashService.runPluginOperation
      .mockResolvedValueOnce({
        retrieved: true,
        success: true,
        version: '20261107',
        action: 'update',
        managed_environment_path: '/stash/plugins/stash-downloader/.venv-ytdlp',
      })
      .mockResolvedValueOnce({ success: true, deleted: true });
  });

  it('runs the background task, reads its saved result, then cleans up', async () => {
    const result = await new DownloadService().manageServerYtDlp('update');

    expect(result).toEqual({
      success: true,
      version: '20261107',
      action: 'update',
      managedEnvironmentPath: '/stash/plugins/stash-downloader/.venv-ytdlp',
    });
    expect(stashService.runPluginTaskAndWait).toHaveBeenCalledWith(
      'stash-downloader',
      'Manage yt-dlp',
      expect.objectContaining({ mode: 'manage_ytdlp', action: 'update' }),
      { pollIntervalMs: 1000, maxWaitMs: 20 * 60 * 1000 }
    );
    expect(stashService.runPluginOperation).toHaveBeenNthCalledWith(
      1,
      'stash-downloader',
      expect.objectContaining({ mode: 'read_result' })
    );
    expect(stashService.runPluginOperation).toHaveBeenNthCalledWith(
      2,
      'stash-downloader',
      expect.objectContaining({ mode: 'cleanup_result' })
    );
  });

  it('does not run management outside Stash', async () => {
    stashService.isStashEnvironment.mockReturnValue(false);

    const result = await new DownloadService().manageServerYtDlp('install');

    expect(result.success).toBe(false);
    expect(result.error).toContain('only from the Stash server');
    expect(stashService.runPluginTaskAndWait).not.toHaveBeenCalled();
  });
});
