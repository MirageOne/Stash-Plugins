/**
 * Application constants
 */

export const PLUGIN_ID = 'stash-downloader';
export const PLUGIN_NAME = 'Stash Downloader';
// Version is injected at build time via __APP_VERSION__ (from package.json)

export const DEFAULT_IMPORT_PROFILE = {
  id: 'default',
  name: 'Default',
  domains: [] as string[],
  autoImport: false,
  createPerformers: true,
  createTags: true,
  createStudios: true,
  filenameTemplate: '{title}',
  postImportAction: 'none' as const,
};

export const ROUTES = {
  // Stash mounts /plugin/:pluginId for asset APIs; use /plugins/ for refreshable UI routes.
  MAIN: '/plugins/stash-downloader',
  QUEUE: '/plugins/stash-downloader/queue',
  METADATA: '/plugins/stash-downloader/metadata',
  SETTINGS: '/plugins/stash-downloader/settings',
} as const;

export const DEFAULT_SETTINGS = {
  // Empty means the backend chooses the first library enabled for this media type.
  serverDownloadPath: '',
  logLevel: 'info' as const,
  showThumbnailPreviews: true,
  autoImport: false,
  importProfiles: [DEFAULT_IMPORT_PROFILE],
  activeImportProfileId: DEFAULT_IMPORT_PROFILE.id,
};

export const STORAGE_KEYS = {
  SETTINGS: 'stash-downloader:settings',
  QUEUE: 'stash-downloader:queue',
  DOWNLOAD_HISTORY: 'stash-downloader:history',
  LOGS: 'stash-downloader:logs',
} as const;

export const API_ENDPOINTS = {
  GRAPHQL: '/graphql',
  PLAYGROUND: '/playground',
} as const;

export const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
] as const;

export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
] as const;
