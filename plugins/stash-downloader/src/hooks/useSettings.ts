/**
 * useSettings - Hook for managing plugin settings
 */

import { useState, useEffect } from 'react';
import type { IPluginSettings } from '@/types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/constants';
import { getStorageItem, setStorageItem, createLogger } from '@/utils';
import { normalizeImportProfiles } from '@/utils/importProfiles';

const log = createLogger('Settings');

function getLocalSettings(settings: Partial<IPluginSettings>): Partial<IPluginSettings> {
  return {
    logLevel: settings.logLevel,
    showThumbnailPreviews: settings.showThumbnailPreviews,
    autoImport: settings.autoImport,
    importProfiles: settings.importProfiles,
    activeImportProfileId: settings.activeImportProfileId,
  };
}

function redactSettingValue(key: string, value: unknown): string {
  if (key === 'httpProxy' && typeof value === 'string') {
    return value.replace(/:\/\/[^@]+@/, '://***@');
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function useSettings() {
  const [settings, setSettings] = useState<IPluginSettings>(() => {
    // Keep server-only settings (proxy credentials, executable and paths) out of browser storage.
    const stored = getStorageItem<Partial<IPluginSettings>>(STORAGE_KEYS.SETTINGS, {});
    const importProfiles = normalizeImportProfiles(stored.importProfiles, stored.autoImport === true);
    const activeImportProfileId = importProfiles.some(profile => profile.id === stored.activeImportProfileId)
      ? stored.activeImportProfileId!
      : importProfiles[0]!.id;
    return { ...DEFAULT_SETTINGS, ...getLocalSettings(stored), importProfiles, activeImportProfileId };
  });

  // Only persist browser preferences. Stash server settings are loaded into memory from GraphQL.
  useEffect(() => {
    setStorageItem(STORAGE_KEYS.SETTINGS, getLocalSettings(settings));
  }, [settings]);

  const updateSettings = (partial: Partial<IPluginSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...partial };

      // Log settings changes to console
      const changedKeys = Object.keys(partial).filter(key => {
        const oldValue = prev[key as keyof IPluginSettings];
        const newValue = updated[key as keyof IPluginSettings];
        return oldValue !== newValue;
      });

      if (changedKeys.length > 0) {
        log.info('Settings updated: ' + changedKeys.join(', '));
        changedKeys.forEach(key => {
          const oldValue = prev[key as keyof IPluginSettings];
          const newValue = updated[key as keyof IPluginSettings];
          log.debug(`  ${key}: ${redactSettingValue(key, oldValue)} → ${redactSettingValue(key, newValue)}`);

          // Special logging for proxy changes
          if (key === 'httpProxy') {
            if (newValue) {
              const masked = String(newValue).replace(/:[^:@]*@/, ':****@');
              log.success(`HTTP/SOCKS proxy configured: ${masked}`);
            } else {
              log.warn('HTTP/SOCKS proxy removed');
            }
          }
        });
      }

      return updated;
    });
  };

  const resetToDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  return {
    settings,
    updateSettings,
    resetToDefaults,
  };
}
