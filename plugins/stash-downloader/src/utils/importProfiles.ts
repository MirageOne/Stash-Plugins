import type { IDownloadItem, IImportProfile } from '@/types';
import { DEFAULT_IMPORT_PROFILE } from '@/constants';

const TRACKING_PARAMETERS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid', 'ref_src',
]);

/** Normalize a source link for queue duplicate checks without dropping meaningful query parameters. */
export function canonicalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

    const keptParameters = [...url.searchParams.entries()]
      .filter(([key]) => !/^utm_/i.test(key) && !TRACKING_PARAMETERS.has(key.toLowerCase()))
      .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
    url.search = '';
    keptParameters.forEach(([key, parameterValue]) => url.searchParams.append(key, parameterValue));
    return url.toString().replace(/\/$/, url.pathname === '/' && !url.search ? '/' : '');
  } catch {
    return value.trim();
  }
}

/** Exact URL variants to try against Stash's exact-match URL filter. */
export function getDuplicateUrlCandidates(value: string): string[] {
  const candidates = new Set<string>();
  const raw = value.trim();
  if (raw) candidates.add(raw);
  const canonical = canonicalizeSourceUrl(raw);
  if (canonical) candidates.add(canonical);

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const alternateHost = hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`;
    url.hostname = alternateHost;
    candidates.add(url.toString());
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    candidates.add(url.toString());
  } catch {
    // Invalid URLs are handled by the regular scraper error path.
  }

  [...candidates].forEach(candidate => {
    try {
      const alternateProtocol = new URL(candidate);
      alternateProtocol.protocol = alternateProtocol.protocol === 'https:' ? 'http:' : 'https:';
      candidates.add(alternateProtocol.toString());
    } catch { /* Ignore malformed candidates. */ }
  });

  return [...candidates];
}

export function normalizeImportProfiles(
  value: unknown,
  legacyAutoImport = false
): IImportProfile[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ ...DEFAULT_IMPORT_PROFILE, autoImport: legacyAutoImport }];
  }

  const profiles = value.flatMap((candidate): IImportProfile[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const profile = candidate as Partial<IImportProfile>;
    if (typeof profile.id !== 'string' || typeof profile.name !== 'string') return [];
    const action = profile.postImportAction;
    return [{
      ...DEFAULT_IMPORT_PROFILE,
      id: profile.id,
      name: profile.name.trim() || 'Import profile',
      domains: Array.isArray(profile.domains)
        ? profile.domains.filter((domain): domain is string => typeof domain === 'string').map(domain => domain.trim()).filter(Boolean)
        : [],
      autoImport: profile.autoImport === true,
      createPerformers: profile.createPerformers !== false,
      createTags: profile.createTags !== false,
      createStudios: profile.createStudios !== false,
      filenameTemplate: typeof profile.filenameTemplate === 'string' ? profile.filenameTemplate : '{title}',
      postImportAction: action === 'identify' || action === 'scrape_url' ? action : 'none',
    }];
  });

  return profiles.length > 0 ? profiles : [{ ...DEFAULT_IMPORT_PROFILE, autoImport: legacyAutoImport }];
}

function domainMatches(hostname: string, pattern: string): boolean {
  let domain = pattern.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] || '';
  if (domain.startsWith('*.')) domain = domain.slice(2);
  domain = domain.replace(/^www\./, '').replace(/\.$/, '');
  if (!domain) return false;
  const host = hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export function getImportProfileForUrl(
  value: string,
  profiles: IImportProfile[],
  activeProfileId: string
): IImportProfile {
  let hostname = '';
  try { hostname = new URL(value).hostname; } catch { /* fall back to the selected profile */ }
  if (hostname) {
    const matched = profiles.find(profile => profile.domains.some(domain => domainMatches(hostname, domain)));
    if (matched) return matched;
  }
  return profiles.find(profile => profile.id === activeProfileId)
    || profiles[0]
    || { ...DEFAULT_IMPORT_PROFILE };
}

export function formatImportFilename(item: IDownloadItem, profile: IImportProfile): string {
  const title = item.editedMetadata?.title || item.metadata?.title || 'download';
  let site = 'unknown-site';
  try { site = new URL(item.url).hostname.replace(/^www\./, ''); } catch { /* retain fallback */ }
  const values: Record<string, string> = {
    title,
    site,
    date: item.editedMetadata?.date || item.metadata?.date || '',
    id: item.metadata?.sourceId || '',
  };
  const rendered = profile.filenameTemplate.replace(/\{(title|site|date|id)\}/gi, (_match, key: string) => values[key.toLowerCase()] || '');
  return rendered.trim() || title;
}
