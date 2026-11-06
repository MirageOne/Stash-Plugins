import { describe, expect, it } from 'vitest';
import type { IDownloadItem, IImportProfile } from '@/types';
import {
  canonicalizeSourceUrl,
  formatImportFilename,
  getDuplicateUrlCandidates,
  getImportProfileForUrl,
  normalizeImportProfiles,
} from '@/utils/importProfiles';

const profile = (id: string, domains: string[]): IImportProfile => ({
  id,
  name: id,
  domains,
  autoImport: false,
  createPerformers: true,
  createTags: true,
  createStudios: true,
  filenameTemplate: '{title}',
  postImportAction: 'none',
});

describe('import profiles', () => {
  it('normalizes equivalent URLs without dropping meaningful parameters', () => {
    expect(canonicalizeSourceUrl('https://www.Example.com/watch/?id=42&utm_source=mail#player'))
      .toBe('https://example.com/watch?id=42');
    expect(canonicalizeSourceUrl('https://example.com/watch?id=42&part=2'))
      .not.toBe(canonicalizeSourceUrl('https://example.com/watch?id=42&part=3'));
    expect(getDuplicateUrlCandidates('https://www.example.com/a/')).toContain('https://example.com/a');
  });

  it('routes matching hosts to exact and wildcard profiles, then uses the active fallback', () => {
    const profiles = [profile('default', []), profile('example', ['example.com']), profile('wild', ['*.other.test'])];
    expect(getImportProfileForUrl('https://www.example.com/video/1', profiles, 'default').id).toBe('example');
    expect(getImportProfileForUrl('https://cdn.other.test/video', profiles, 'default').id).toBe('wild');
    expect(getImportProfileForUrl('https://unmatched.test/video', profiles, 'default').id).toBe('default');
  });

  it('fills filename tokens and safely restores the legacy profile setting', () => {
    const item: IDownloadItem = {
      id: '1',
      url: 'https://www.example.com/watch/42',
      status: 'pending' as IDownloadItem['status'],
      addedAt: new Date(),
      metadata: { url: 'https://www.example.com/watch/42', title: 'A Scene', date: '2026-11-06', sourceId: '42', contentType: 'video' },
    };
    expect(formatImportFilename(item, { ...profile('example', []), filenameTemplate: '{site} - {date} - {title} ({id})' }))
      .toBe('example.com - 2026-11-06 - A Scene (42)');
    expect(normalizeImportProfiles(undefined, true)[0]?.autoImport).toBe(true);
  });
});
