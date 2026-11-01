/** Server-side system checks used by the Downloader UI. */

import { createLogger } from './Logger';
import { PLUGIN_ID } from '@/constants';

const log = createLogger('ProxyTest');

/** Test the proxy saved in Stash's plugin settings. */
export async function testHttpProxy(
  proxyUrl: string
): Promise<{ success: boolean; message: string; details?: string }> {
  if (!proxyUrl || !proxyUrl.trim()) {
    return { success: false, message: 'No proxy URL provided' };
  }

  try {
    const { getStashService } = await import('@/services/stash/StashGraphQLService');
    const stashService = getStashService();
    if (!stashService.isStashEnvironment()) {
      return { success: false, message: 'Proxy testing requires Stash.' };
    }

    // The Python task reads the saved server setting; browser arguments cannot
    // supply or override the proxy URL used by the server.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Raw Python task result
    const result = await stashService.runPluginOperation(PLUGIN_ID, { mode: 'test_proxy' }) as any;
    if (result?.success === true) {
      return {
        success: true,
        message: 'Proxy test successful',
        details: result.message || 'Connected through the configured proxy with TLS verification enabled.',
      };
    }

    const error = result?.status_message || result?.task_error || result?.result_error || result?.error || 'Proxy connection failed.';
    log.warn('Proxy test failed:', String(error));
    return { success: false, message: 'Proxy test failed', details: String(error) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Server-side proxy test failed:', message);
    return { success: false, message: 'Proxy test failed', details: message };
  }
}
