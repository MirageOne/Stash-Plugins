import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isStashEnvironment } = vi.hoisted(() => ({
  isStashEnvironment: vi.fn(),
}));

vi.mock('@/services/stash/StashGraphQLService', () => ({
  getStashService: () => ({ isStashEnvironment }),
}));

import { StashScraper } from '@/services/metadata/StashScraper';

describe('StashScraper', () => {
  beforeEach(() => {
    isStashEnvironment.mockReset();
  });

  it('is eligible for HTTP URLs in Stash so it can serve as a fallback', () => {
    isStashEnvironment.mockReturnValue(true);
    const scraper = new StashScraper();

    expect(scraper.canHandle('https://example.com/scene/1')).toBe(true);
    expect(scraper.canHandle('http://example.com/scene/1')).toBe(true);
  });

  it('is unavailable outside Stash and rejects non-HTTP URLs', () => {
    isStashEnvironment.mockReturnValue(false);
    const scraper = new StashScraper();

    expect(scraper.canHandle('https://example.com/scene/1')).toBe(false);
    expect(scraper.canHandle('file:///tmp/video.mp4')).toBe(false);
    expect(scraper.canHandle('not a URL')).toBe(false);
  });
});
