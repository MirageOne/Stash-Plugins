import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StashGraphQLService } from '@/services/stash/StashGraphQLService';

describe('StashGraphQLService tracked-job recovery', () => {
  let service: StashGraphQLService;

  beforeEach(() => {
    service = new StashGraphQLService();
  });

  it('waits through queued and running states and reports progress', async () => {
    const findJob = vi.spyOn(service, 'findJobStrict')
      .mockResolvedValueOnce({ id: 'job-1', status: 'READY', description: 'Downloading' })
      .mockResolvedValueOnce({ id: 'job-1', status: 'RUNNING', progress: 35, description: 'Downloading' })
      .mockResolvedValueOnce({ id: 'job-1', status: 'FINISHED', description: 'Downloading' });
    const progress: number[] = [];

    const result = await service.waitForTrackedJob('job-1', {
      pollIntervalMs: 1,
      maxWaitMs: 100,
      onProgress: value => progress.push(value),
    });

    expect(result).toEqual({ success: true });
    expect(findJob).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([35]);
  });

  it('returns the Stash failure reason and treats a removed job as complete for result-file validation', async () => {
    vi.spyOn(service, 'findJobStrict')
      .mockResolvedValueOnce({ id: 'job-2', status: 'FAILED', error: 'yt-dlp exited', description: 'Downloading' })
      .mockResolvedValueOnce(null);

    await expect(service.waitForTrackedJob('job-2', { pollIntervalMs: 1, maxWaitMs: 100 }))
      .resolves.toEqual({ success: false, error: 'yt-dlp exited' });
    await expect(service.waitForTrackedJob('job-2', { pollIntervalMs: 1, maxWaitMs: 100 }))
      .resolves.toEqual({ success: true });
  });
});
