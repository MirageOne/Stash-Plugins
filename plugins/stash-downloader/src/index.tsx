/**
 * Plugin Entry Point
 *
 * This file is loaded by Stash and registers the plugin with PluginApi
 */

import { DownloaderMain } from './components/downloader/DownloaderMain';
import { ROUTES, PLUGIN_NAME } from './constants';
import { createLogger } from './utils';

const log = createLogger(PLUGIN_NAME);

// Import plugin styles as inline string (Stash plugins only load .js files)
// The ?inline suffix tells Vite to return CSS as a string instead of extracting it
import pluginStyles from './styles/plugin.css?inline';

// Inject styles into document head
function injectStyles() {
  const styleId = 'stash-downloader-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `${pluginStyles}\n
    /* Fluent's yellow accent is bright on the dark theme; use dark button text. */
    body.stash-fluent-mica.fluent-mica-yellow:not(.fluent-mica-light) .stash-downloader-plugin {
      --accent-contrast: #201f1e;
    }
    body.stash-fluent-mica.fluent-mica-yellow:not(.fluent-mica-light) .stash-downloader-plugin :is(.btn-primary:not(.minimal), .bg-primary) {
      color: var(--accent-contrast) !important;
    }
  `;
  document.head.appendChild(style);
}

// Inject styles immediately
injectStyles();

// Ensure PluginApi is available
if (!window.PluginApi) {
  log.error('PluginApi is not available. This plugin must be loaded within Stash.');
  throw new Error('PluginApi not found');
}

// Get React from PluginApi - use this consistently throughout
const { React } = window.PluginApi;

/**
 * Wrapper component that provides Stash's IntlProvider context
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PluginApi passes unknown props
function PluginWrapper(props: any) {
  const { IntlProvider } = window.PluginApi.libraries.Intl || {};

  // If IntlProvider is available, wrap our component with it
  if (IntlProvider) {
    return React.createElement(
      IntlProvider,
      { locale: 'en', messages: {} },
      React.createElement(DownloaderMain, props)
    );
  }

  // Fallback: render without IntlProvider
  return React.createElement(DownloaderMain, props);
}

/**
 * Add navigation button using MutationObserver (community plugin pattern)
 * This watches for the navbar-buttons to appear and injects our button via DOM
 * Reference: https://github.com/Serechops/Serechops-Stash/blob/main/plugins/stashUIPluginExample
 */
function addNavButtonViaMutationObserver() {
  const NAV_BUTTON_ID = 'stash-downloader-nav-button';

  function injectNavButton() {
    const navButtons = document.querySelector(
      'nav.top-nav .navbar-buttons, nav.navbar .navbar-buttons'
    );
    if (!navButtons) return false;

    const existing = document.getElementById(NAV_BUTTON_ID);
    if (existing) {
      // Stash can replace the right utility group during navigation.
      if (existing.parentElement !== navButtons) navButtons.appendChild(existing);
      return true;
    }

    const navButton = document.createElement('a');
    navButton.id = NAV_BUTTON_ID;
    navButton.className = 'btn btn-secondary minimal nav-utility';
    navButton.href = ROUTES.MAIN;
    navButton.title = `Open ${PLUGIN_NAME}`;
    navButton.setAttribute('aria-label', PLUGIN_NAME);
    navButton.style.order = '89';
    navButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 16v4h14v-4"/>
      </svg>
    `;

    const syncActiveState = () => {
      const active = window.location.pathname === ROUTES.MAIN ||
        window.location.pathname.startsWith(`${ROUTES.MAIN}/`);
      navButton.classList.toggle('stash-nav-active', active);
      if (active) navButton.setAttribute('aria-current', 'page');
      else navButton.removeAttribute('aria-current');
    };

    syncActiveState();
    window.addEventListener('popstate', syncActiveState);

    navButton.addEventListener('click', (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      window.history.pushState({}, '', ROUTES.MAIN);
      syncActiveState();
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Keep utility actions together at the right, immediately before Settings.
    const settingsLink = navButtons.querySelector<HTMLAnchorElement>('a[href="/settings"]');
    if (settingsLink) navButtons.insertBefore(navButton, settingsLink);
    else navButtons.appendChild(navButton);
    log.debug('Utility navigation button added beside Settings');
    return true;
  }

  // Try to inject immediately
  if (injectNavButton()) {
    return;
  }

  // Use MutationObserver to wait for navbar to appear
  const observer = new MutationObserver((_mutations, obs) => {
    if (injectNavButton()) {
      obs.disconnect();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Cleanup after 30 seconds if navbar never appears
  setTimeout(() => {
    observer.disconnect();
  }, 30000);
}

/**
 * Initialize and register the plugin
 */
function initializePlugin() {
  try {
    log.info('Initializing plugin...');
    log.debug('Available libraries:', JSON.stringify(Object.keys(window.PluginApi.libraries || {})));

    // Register main route with IntlProvider wrapper
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PluginApi route callback receives unknown props
    window.PluginApi.register.route(ROUTES.MAIN, (props?: any) => {
      return React.createElement(PluginWrapper, props);
    });

    log.info(`✓ Plugin registered successfully at ${ROUTES.MAIN}`);

    // Add navigation button using MutationObserver (community plugin pattern)
    // Uses .navbar-buttons selector like other community plugins
    addNavButtonViaMutationObserver();

    // Handle direct URL navigation (bookmark/link to plugin route)
    // When user navigates directly to /plugin/stash-downloader, the route
    // isn't registered yet when React Router first evaluates. Re-trigger navigation
    // now that the route is registered.
    if (window.location.pathname === ROUTES.MAIN) {
      log.debug('Direct URL navigation detected, re-triggering route...');
      // Small delay to ensure route registration is complete
      setTimeout(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, 50);
    }

  } catch (error) {
    log.error(`Failed to initialize: ${String(error)}`);
    throw error;
  }
}

// Initialize the plugin when this script loads
initializePlugin();

// Export for potential external use
export { DownloaderMain };
