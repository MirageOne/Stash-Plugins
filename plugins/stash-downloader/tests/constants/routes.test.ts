import { describe, expect, it } from 'vitest';
import { ROUTES } from '@/constants';

describe('plugin page route', () => {
  it('stays outside Stash’s reserved singular plugin asset path', () => {
    expect(ROUTES.MAIN).toBe('/plugins/stash-downloader');
    expect(ROUTES.MAIN.startsWith('/plugin/')).toBe(false);
  });
});
