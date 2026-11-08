(function () {
  "use strict";

  var PREFERENCES_KEY = "rebirth.preferences.v1";
  var PREFERENCES_EVENT = "rebirth:preferences-changed";
  var PREFERENCE_OWNER_KEY = "rebirth.preferences.owner.v1";
  var LEGACY_PREFERENCES_KEY = "current-theme.preferences.v1";
  var LEGACY_PREFERENCE_OWNER_KEY = "current-theme.preferences.owner.v1";
  var LEGACY_PLUGIN_ID = "current-theme";
  var PLUGIN_ID = "rebirth";
  var ACCOUNT_PREFERENCES_KEY = "accountPreferences";
  var USER_PREFERENCES_KEY = "rebirthThemePreferences";
  var mountRebirthThemeSettingsInInterface = null;
  var activePluginApi = null;
  var activeAccountId = null;
  var userPreferencesSync = null;
  var userPreferenceWrites = Promise.resolve();
  var userPreferencesLoaded = false;
  var preferenceSyncAttempts = 0;
  var preferenceRevision = 0;
  var pendingAccountPreferenceChanges = {};
  var DEFAULT_PREFERENCES = {
    mode: "dark",
    accent: "violet",
    newContentSort: "created_at",
    sidebarCollapsed: false,
    reduceEffects: false,
    cardStyle: "cinematic",
    mobileSceneColumns: "two",
    mobileDock: ["/", "/scenes", "/images"]
  };
  var ACCENTS = [
    { id: "teal", label: "Teal", color: "#269ba6" },
    { id: "blue", label: "Blue", color: "#6486ed" },
    { id: "violet", label: "Violet", color: "#a076e8" },
    { id: "coral", label: "Coral", color: "#de795a" },
    { id: "amber", label: "Amber", color: "#d5a239" },
    { id: "rose", label: "Rose", color: "#d56794" },
    { id: "red", label: "Red", color: "#e45a63" },
    { id: "green", label: "Green", color: "#3a9e67" }
  ];
  var LEGACY_ACCENT_MIGRATIONS = {
    cobalt: "blue",
    orchid: "violet",
    jade: "teal",
    terracotta: "coral"
  };
  var ICONS = {
    home: "<path d=\"m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z\"/>",
    scenes: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"m10 8 6 4-6 4z\"/>",
    images: "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"m21 15-5-5L5 21\"/>",
    galleries: "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M7 7h10M7 12h10M7 17h6\"/>",
    performers: "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.5V20\"/>",
    studios: "<path d=\"M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4\"/>",
    groups: "<rect x=\"3\" y=\"3\" width=\"8\" height=\"8\" rx=\"1\"/><rect x=\"13\" y=\"3\" width=\"8\" height=\"8\" rx=\"1\"/><rect x=\"3\" y=\"13\" width=\"8\" height=\"8\" rx=\"1\"/><rect x=\"13\" y=\"13\" width=\"8\" height=\"8\" rx=\"1\"/>",
    tags: "<path d=\"M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\"1\"/>",
    markers: "<path d=\"M6 3h12v18l-6-4-6 4z\"/>",
    stats: "<path d=\"M4 20V10M10 20V4M16 20v-7M22 20H2\"/>",
    collapse: "<path d=\"m14.5 5-7 7 7 7\"/>",
    menu: "<path d=\"M4 6h16M4 12h16M4 18h16\"/>",
    pluginGrid: "<rect x=\"3.5\" y=\"3.5\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"14.5\" y=\"3.5\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"3.5\" y=\"14.5\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"14.5\" y=\"14.5\" width=\"6\" height=\"6\" rx=\"1\"/>",
    activity: "<path d=\"M3 12h4l3-8 4 16 3-8h4\"/>",
    tools: "<path d=\"M14.7 6.3a5 5 0 0 0-6.6 6.6l-4.6 4.6a2 2 0 0 0 2.8 2.8l4.6-4.6a5 5 0 0 0 6.6-6.6L14 12l-2-2z\"/>",
    logs: "<path d=\"M5 4h14v16H5zM8 8h8M8 12h8M8 16h5\"/>",
    plugins: "<path d=\"M9 3h6v4a3 3 0 1 0 6 0h1v14H2V7h1a3 3 0 1 0 6 0z\"/>",
    about: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5m0-8h.01\"/>",
    search: "<circle cx=\"10.8\" cy=\"10.8\" r=\"6.8\"/><path d=\"m16 16 5 5\"/>",
    settings: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z\"/>",
    sun: "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42\"/>",
    moon: "<path d=\"M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z\"/>"
  };

  function normalizePreferences(preferences) {
    if (!preferences || typeof preferences !== "object") { preferences = {}; }
    var merged = Object.assign({}, DEFAULT_PREFERENCES, preferences);
    if (["light", "system"].indexOf(merged.mode) === -1) { merged.mode = "dark"; }
    if (LEGACY_ACCENT_MIGRATIONS[merged.accent]) { merged.accent = LEGACY_ACCENT_MIGRATIONS[merged.accent]; }
    if (!ACCENTS.some(function (accent) { return accent.id === merged.accent; })) {
      merged.accent = DEFAULT_PREFERENCES.accent;
    }
    if (["date", "random"].indexOf(merged.newContentSort) === -1) { merged.newContentSort = "created_at"; }
    merged.sidebarCollapsed = Boolean(merged.sidebarCollapsed);
    merged.reduceEffects = Boolean(merged.reduceEffects);
    if (["cinematic", "compact", "poster"].indexOf(merged.cardStyle) === -1) { merged.cardStyle = "cinematic"; }
    if (["one", "two"].indexOf(merged.mobileSceneColumns) === -1) { merged.mobileSceneColumns = "two"; }
    var validDock = ["/", "/scenes", "/images", "/galleries", "/performers", "/studios", "/groups", "/tags", "/scenes/markers", "/stats", "/settings"];
    merged.mobileDock = Array.isArray(merged.mobileDock) ? merged.mobileDock.filter(function (href, index, values) {
      return validDock.indexOf(href) !== -1 && values.indexOf(href) === index;
    }).slice(0, 3) : DEFAULT_PREFERENCES.mobileDock.slice();
    return merged;
  }

  function readPreferences() {
    var preferences = {};
    try {
      var stored = window.localStorage.getItem(PREFERENCES_KEY) || window.localStorage.getItem(LEGACY_PREFERENCES_KEY) || "{}";
      preferences = JSON.parse(stored);
    } catch (error) {
      preferences = {};
    }
    return normalizePreferences(preferences);
  }

  function writeLocalPreferences(preferences, accountId) {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      window.localStorage.removeItem(LEGACY_PREFERENCES_KEY);
      window.localStorage.removeItem(LEGACY_PREFERENCE_OWNER_KEY);
    } catch (error) { /* The current page still works when browser storage is unavailable. */ }
  }

  function preferenceOwner() {
    try { return window.localStorage.getItem(PREFERENCE_OWNER_KEY) || window.localStorage.getItem(LEGACY_PREFERENCE_OWNER_KEY); }
    catch (error) { return null; }
  }

  function publishPreferences(preferences) {
    applyPreferences(preferences);
    try { window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: preferences })); }
    catch (error) { /* Ignore browsers without CustomEvent. */ }
  }

  function graphQLRequest(query, variables) {
    return fetch("/graphql", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (response) {
      if (!response.ok) { throw new Error("Stash preference request failed (HTTP " + response.status + ")"); }
      return response.json();
    }).then(function (result) {
      if (result && result.errors && result.errors.length) {
        throw new Error(result.errors.map(function (error) { return error.message || "GraphQL error"; }).join("; "));
      }
      return result && result.data ? result.data : {};
    });
  }

  function graphQLNamedType(type) {
    while (type && type.ofType) { type = type.ofType; }
    return type && type.name || "";
  }

  function accountIdentityFields(fields) {
    var preferred = ["me", "currentUser", "current_user", "authenticatedUser", "viewer", "user"];
    var candidates = (fields || []).filter(function (field) {
      var hasRequiredArgs = (field.args || []).some(function (arg) {
        return arg.defaultValue === null && arg.type && arg.type.kind === "NON_NULL";
      });
      return !hasRequiredArgs && (preferred.indexOf(field.name) !== -1 || /user|account/i.test(graphQLNamedType(field.type)));
    });
    candidates.sort(function (a, b) {
      var ai = preferred.indexOf(a.name);
      var bi = preferred.indexOf(b.name);
      return (ai === -1 ? preferred.length : ai) - (bi === -1 ? preferred.length : bi);
    });
    var names = candidates.map(function (field) { return field.name; });
    preferred.forEach(function (name) { if (names.indexOf(name) === -1) { names.push(name); } });
    return names;
  }

  function tryAccountIdentityFields(fields, index) {
    if (index >= fields.length) { return Promise.resolve(null); }
    var field = fields[index];
    var query = "query RebirthThemeSignedInAccount { " + field + " { id } }";
    return graphQLRequest(query).then(function (data) {
      var account = data && data[field];
      if (account && account.id !== undefined && account.id !== null && String(account.id)) { return String(account.id); }
      return tryAccountIdentityFields(fields, index + 1);
    }).catch(function () { return tryAccountIdentityFields(fields, index + 1); });
  }

  function resolveSignedInAccountId() {
    var exposedUser = activePluginApi && (activePluginApi.currentUser || activePluginApi.user);
    if (exposedUser && typeof exposedUser === "object") {
      var exposedId = exposedUser.id !== undefined ? exposedUser.id : exposedUser.userId;
      if (exposedId !== undefined && exposedId !== null && String(exposedId)) { return Promise.resolve(String(exposedId)); }
    }
    var schemaQuery = "query RebirthThemeAccountSchema { __schema { queryType { fields { name args { name defaultValue type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } } } }";
    return graphQLRequest(schemaQuery).then(function (data) {
      var fields = data && data.__schema && data.__schema.queryType && data.__schema.queryType.fields;
      return tryAccountIdentityFields(accountIdentityFields(fields), 0);
    }).catch(function () {
      return tryAccountIdentityFields(["me", "currentUser", "current_user", "authenticatedUser", "viewer", "user"], 0);
    });
  }

  function loadRebirthThemeServerSettings() {
    var query = "query RebirthThemeServerPreferences { configuration { plugins } }";
    return graphQLRequest(query).then(function (data) {
      var plugins = data && data.configuration && data.configuration.plugins;
      return {
        rebirth: plugins && plugins[PLUGIN_ID] && typeof plugins[PLUGIN_ID] === "object" ? plugins[PLUGIN_ID] : {},
        legacy: plugins && plugins[LEGACY_PLUGIN_ID] && typeof plugins[LEGACY_PLUGIN_ID] === "object" ? plugins[LEGACY_PLUGIN_ID] : {}
      };
    });
  }

  function loadRebirthThemeUserPreferences() {
    var query = "query RebirthThemeUserPreferences { configuration { ui } }";
    return graphQLRequest(query).then(function (data) {
      var ui = data && data.configuration && data.configuration.ui;
      var preferences = ui && typeof ui === "object" ? ui[USER_PREFERENCES_KEY] : null;
      return preferences && typeof preferences === "object" && !Array.isArray(preferences) ? preferences : null;
    });
  }

  function loadLegacyAccountPreferences() {
    return resolveSignedInAccountId().then(function (accountId) {
      if (!accountId) { return { accountId: null, preferences: null }; }
      activeAccountId = String(accountId);
      return loadRebirthThemeServerSettings().then(function (serverSettings) {
        var accounts = serverSettings.rebirth[ACCOUNT_PREFERENCES_KEY];
        var preferences = accounts && typeof accounts === "object" ? accounts[activeAccountId] : null;
        if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
          accounts = serverSettings.legacy[ACCOUNT_PREFERENCES_KEY];
          preferences = accounts && typeof accounts === "object" ? accounts[activeAccountId] : null;
        }
        return {
          accountId: activeAccountId,
          preferences: preferences && typeof preferences === "object" && !Array.isArray(preferences) ? preferences : null
        };
      }).catch(function () { return { accountId: activeAccountId, preferences: null }; });
    }).catch(function () { return { accountId: null, preferences: null }; });
  }

  function saveRebirthThemeUserPreferences(preferences) {
    var mutation = "mutation RebirthThemeSaveUserPreferences($partial: Map!) { configureUI(partial: $partial) }";
    var partial = {};
    partial[USER_PREFERENCES_KEY] = normalizePreferences(preferences);
    return graphQLRequest(mutation, { partial: partial }).then(function (data) {
      var savedUI = data && data.configureUI;
      if (!savedUI || typeof savedUI !== "object" || !savedUI[USER_PREFERENCES_KEY]) {
        throw new Error("Stash did not confirm saving Rebirth Theme preferences to this user's UI settings");
      }
      return true;
    });
  }

  function retryUserPreferenceSave(preferences, attempt) {
    return saveRebirthThemeUserPreferences(preferences).catch(function (error) {
      if (attempt >= 2) { throw error; }
      return new Promise(function (resolve) { window.setTimeout(resolve, 500 * Math.pow(2, attempt)); })
        .then(function () { return retryUserPreferenceSave(preferences, attempt + 1); });
    });
  }

  function queueUserPreferenceSave(preferences) {
    var snapshot = normalizePreferences(preferences);
    userPreferenceWrites = userPreferenceWrites.catch(function () {}).then(function () {
      return retryUserPreferenceSave(snapshot, 0);
    }).catch(function (error) {
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("[Rebirth] Could not save appearance preferences to the signed-in user's Stash UI settings.", error);
      }
    });
    return userPreferenceWrites;
  }

  function syncUserPreferences() {
    if (userPreferencesSync) { return userPreferencesSync; }
    var revisionAtStart = preferenceRevision;
    var browserPreferences = readPreferences();
    var browserOwner = preferenceOwner();
    userPreferencesSync = loadRebirthThemeUserPreferences().then(function (storedPreferences) {
      if (storedPreferences) { return { preferences: storedPreferences, accountId: null, fromUserSettings: true }; }
      return loadLegacyAccountPreferences().then(function (legacy) {
        var preferences = legacy.preferences;
        if (!preferences) {
          preferences = !browserOwner || (legacy.accountId && browserOwner === legacy.accountId)
            ? browserPreferences : normalizePreferences(DEFAULT_PREFERENCES);
        }
        return { preferences: preferences, accountId: legacy.accountId, fromUserSettings: false };
      });
    }).then(function (syncResult) {
      activeAccountId = syncResult.accountId;
      var preferences = normalizePreferences(syncResult.preferences);
      var changedDuringSync = preferenceRevision !== revisionAtStart;
      if (changedDuringSync) {
        preferences = normalizePreferences(Object.assign({}, preferences, pendingAccountPreferenceChanges));
        pendingAccountPreferenceChanges = {};
      }
      writeLocalPreferences(preferences);
      try {
        window.localStorage.removeItem(PREFERENCE_OWNER_KEY);
        window.localStorage.removeItem(LEGACY_PREFERENCE_OWNER_KEY);
      } catch (error) { /* Browser storage is only a cache. */ }
      publishPreferences(preferences);
      userPreferencesLoaded = true;
      preferenceSyncAttempts = 0;
      if (!syncResult.fromUserSettings || changedDuringSync) {
        queueUserPreferenceSave(preferences);
      }
      return null;
    }).catch(function (error) {
      userPreferencesSync = null;
      preferenceSyncAttempts += 1;
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("[Rebirth] Could not load appearance preferences from the signed-in user's Stash UI settings.", error);
      }
      if (preferenceSyncAttempts <= 5) {
        window.setTimeout(syncUserPreferences, Math.min(30000, 1000 * Math.pow(2, preferenceSyncAttempts - 1)));
      }
    });
    return userPreferencesSync;
  }

  function resolveMode(mode) {
    if (mode !== "system") { return mode; }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function savePreferences(preferences) {
    var next = normalizePreferences(Object.assign({}, readPreferences(), preferences));
    preferenceRevision += 1;
    writeLocalPreferences(next, activeAccountId);
    if (userPreferencesLoaded) { queueUserPreferenceSave(next); }
    else { pendingAccountPreferenceChanges = Object.assign({}, pendingAccountPreferenceChanges, preferences); }
    publishPreferences(next);
    return next;
  }

  function applyPreferences(preferences) {
    var root = document.documentElement;
    root.setAttribute("data-rebirth", "active");
    var mode = resolveMode(preferences.mode);
    root.setAttribute("data-rebirth-mode", mode);
    root.setAttribute("data-rebirth-accent", preferences.accent);
    root.setAttribute("data-rebirth-card-style", preferences.cardStyle);
    root.setAttribute("data-rebirth-mobile-scene-columns", preferences.mobileSceneColumns);
    if (document.body) {
      document.body.classList.add("rebirth-active");
      document.body.classList.toggle("rebirth-sidebar-collapsed", preferences.sidebarCollapsed);
      document.body.classList.toggle("rebirth-reduced-effects", preferences.reduceEffects);
    }
    updateSidebarState(preferences.sidebarCollapsed);
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.scenes) + "</svg>";
  }

  var REBIRTH_MARK = '<svg viewBox="0 0 256 256" aria-hidden="true"><defs><filter id="stash-mark-black" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter></defs><rect width="256" height="256" rx="40" fill="var(--rebirth-accent)"/><image href="/plugin/rebirth/assets/icons/stash.png" x="28" y="28" width="200" height="200" preserveAspectRatio="xMidYMid meet" filter="url(#stash-mark-black)"/></svg>';

  function installTopbarBrand(navbar) {
    if (navbar.querySelector(".rebirth-topbar-brand")) { return true; }
    var brand = document.createElement("a");
    brand.className = "rebirth-topbar-brand";
    brand.href = "/";
    brand.setAttribute("data-rebirth-route", "/");
    brand.setAttribute("aria-label", "Rebirth home");
    brand.innerHTML = '<span class="rebirth-brand-mark">' + REBIRTH_MARK + '</span><span>Rebirth</span>';
    brand.addEventListener("click", function (event) { navigateFromLink(event, brand); });
    navbar.insertBefore(brand, navbar.firstChild);
    return true;
  }

  function topbarLabel(path) {
    var labels = {
      "/": "Home", "/scenes": "Scenes", "/images": "Images", "/galleries": "Galleries",
      "/performers": "Performers", "/studios": "Studios", "/groups": "Groups", "/tags": "Tags",
      "/scenes/markers": "Scene markers", "/stats": "Statistics", "/settings": "Settings",
    };
    if (path.indexOf("/scenes/") === 0) { return "Scene details"; }
    if (path.indexOf("/images/") === 0) { return "Image details"; }
    if (path.indexOf("/galleries/") === 0) { return "Gallery details"; }
    if (path.indexOf("/performers/") === 0) { return "Performer profile"; }
    if (path.indexOf("/studios/") === 0) { return "Studio profile"; }
    if (path.indexOf("/groups/") === 0) { return "Group details"; }
    if (path.indexOf("/tags/") === 0) { return "Tag details"; }
    if (path === "/settings" && window.location.search.indexOf("tab=tasks") !== -1) { return "Tasks & queue"; }
    if (path === "/settings" && window.location.search.indexOf("tab=logs") !== -1) { return "Logs"; }
    if (path === "/settings" && window.location.search.indexOf("tab=tools") !== -1) { return "Tools"; }
    return labels[path] || "Library";
  }

  function submitGlobalSearch(value) {
    var query = String(value || "").trim();
    if (!query) { return; }
    var target = "/scenes?q=" + encodeURIComponent(query) + "&sortby=date";
    window.location.assign(target);
  }

  function refreshTopbarContext() {
    var context = document.querySelector(".rebirth-topbar-context");
    if (!context) { return; }
    var path = window.location.pathname || "/";
    var crumb = context.querySelector(".rebirth-breadcrumb-current");
    var label = topbarLabel(path);
    // The topbar has a MutationObserver that refreshes route state. Replacing
    // this text node when the label is already current retriggers that observer
    // forever on SPA routes such as Rebirth's settings page.
    if (crumb && crumb.textContent !== label) { crumb.textContent = label; }
    var input = context.querySelector(".rebirth-global-search-input");
    if (input && document.activeElement !== input) {
      input.value = path === "/scenes" ? new URLSearchParams(window.location.search).get("q") || "" : "";
    }
  }

  function installTopbarContext(navbar) {
    var context = navbar.querySelector(".rebirth-topbar-context");
    if (!context) {
      context = document.createElement("div");
      context.className = "rebirth-topbar-context";
      context.innerHTML = '<div class="rebirth-breadcrumb"><a href="/" data-rebirth-route="/">Library</a><span aria-hidden="true">/</span><strong class="rebirth-breadcrumb-current"></strong></div><form class="rebirth-global-search" role="search"><span class="rebirth-search-icon">' + icon("search") + '</span><input class="rebirth-global-search-input" type="search" aria-label="Search your library" placeholder="Search your library"><kbd>Ctrl K</kbd></form>';
      var input = context.querySelector(".rebirth-global-search-input");
      context.querySelector(".rebirth-global-search").addEventListener("submit", function (event) {
        event.preventDefault();
        submitGlobalSearch(input.value);
      });
      context.querySelector(".rebirth-breadcrumb").addEventListener("click", function (event) {
        var route = event.target.closest("[data-rebirth-route]");
        if (route) { navigateFromLink(event, route); }
      });
      navbar.insertBefore(context, navbar.querySelector(".navbar-buttons") || null);
    }
    refreshTopbarContext();
  }

  function removeTopbarThemeToggle(navbar) {
    var toggle = navbar.querySelector(".rebirth-mode-toggle");
    if (toggle) { toggle.remove(); }
  }

  function hideTopbarHelp(navbar) {
    var actions = navbar.querySelector(".navbar-buttons");
    if (!actions) { return; }
    var controls = actions.querySelectorAll("a, button, [role=button]");
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      var parts = [control.getAttribute("aria-label"), control.getAttribute("title"),
        control.getAttribute("data-original-title"), control.getAttribute("href"),
        control.className, control.textContent];
      var icons = control.querySelectorAll("svg, i");
      for (var j = 0; j < icons.length; j++) {
        parts.push(icons[j].getAttribute("aria-label"), icons[j].getAttribute("title"),
          icons[j].getAttribute("data-icon"), icons[j].getAttribute("class"));
      }
      if (/(?:^|[\s/_-])help(?:$|[\s/_-])|question(?:[-_ ]?circle)?|circle[-_ ]?question/i.test(parts.filter(Boolean).join(" "))) {
        control.classList.add("rebirth-topbar-help-hidden");
      }
    }
  }

  function pluginShortcutPath(link) {
    try {
      var path = new URL(link.getAttribute("href"), window.location.origin).pathname;
      return /^\/plugins?\//.test(path) ? path : "";
    } catch (error) { return ""; }
  }

  function pluginShortcutLabel(link) {
    var label = link.getAttribute("aria-label") || link.getAttribute("title") || link.textContent || "";
    return label.replace(/^open\s+/i, "").replace(/\s+/g, " ").trim() || "Plugin";
  }

  function pluginShortcutKey(link, path) {
    var key = link.getAttribute("data-rebirth-plugin-source-key") || link.id || path;
    if (!link.getAttribute("data-rebirth-plugin-source-key")) {
      link.setAttribute("data-rebirth-plugin-source-key", key);
    }
    return key;
  }

  function pluginShortcutDescription(path, label) {
    if (path.indexOf("/plugin/library-doctor/") === 0) { return "Inspect and maintain your library"; }
    if (path.indexOf("/plugin/stashbox-metadata-review/") === 0) { return "Review metadata from configured StashBoxes"; }
    if (path.indexOf("/plugins/stash-downloader") === 0) { return "Download and import media"; }
    return "Open " + label;
  }

  function collectPluginShortcuts(navbar) {
    var actions = navbar.querySelector(".navbar-buttons");
    if (!actions) { return []; }
    return Array.prototype.slice.call(actions.querySelectorAll("a.nav-utility[href]"))
      .map(function (link) {
        var path = pluginShortcutPath(link);
        if (!path) { return null; }
        return {
          link: link,
          path: path,
          href: link.href,
          key: pluginShortcutKey(link, path),
          label: pluginShortcutLabel(link),
          description: pluginShortcutDescription(path, pluginShortcutLabel(link)),
          icon: link.querySelector("svg")
        };
      }).filter(Boolean);
  }

  function closePluginFlyout(returnFocus) {
    var launcher = document.querySelector(".rebirth-plugin-launcher");
    var flyout = document.querySelector(".rebirth-plugin-flyout");
    if (!launcher || !flyout) { return; }
    flyout.hidden = true;
    launcher.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
    if (returnFocus) { launcher.focus(); }
  }

  function openPluginFlyout(open) {
    var launcher = document.querySelector(".rebirth-plugin-launcher");
    var flyout = document.querySelector(".rebirth-plugin-flyout");
    if (!launcher || !flyout) { return; }
    flyout.hidden = !open;
    launcher.classList.toggle("is-open", Boolean(open));
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function syncPluginLauncherActiveState() {
    var launcher = document.querySelector(".rebirth-plugin-launcher");
    var cards = document.querySelectorAll(".rebirth-plugin-card[data-plugin-path]");
    if (!launcher) { return; }
    var path = window.location.pathname || "/";
    var active = false;
    for (var i = 0; i < cards.length; i++) {
      var pluginPath = cards[i].getAttribute("data-plugin-path") || "";
      var isActive = path === pluginPath || path.indexOf(pluginPath + "/") === 0;
      cards[i].classList.toggle("is-active", isActive);
      if (isActive) {
        cards[i].setAttribute("aria-current", "page");
        active = true;
      } else {
        cards[i].removeAttribute("aria-current");
      }
    }
    launcher.classList.toggle("has-active-plugin", active);
  }

  function renderPluginLauncher(navbar) {
    var actions = navbar.querySelector(".navbar-buttons");
    if (!actions) { return; }
    var shortcuts = collectPluginShortcuts(navbar);
    var launcher = actions.querySelector(".rebirth-plugin-launcher");
    var flyout = document.querySelector(".rebirth-plugin-flyout");
    if (!shortcuts.length) {
      if (launcher) { launcher.remove(); }
      if (flyout) { flyout.remove(); }
      return;
    }

    shortcuts.forEach(function (shortcut) {
      shortcut.link.classList.add("rebirth-plugin-shortcut-source");
    });
    if (!launcher) {
      launcher = document.createElement("button");
      launcher.type = "button";
      launcher.className = "btn btn-secondary minimal nav-utility rebirth-plugin-launcher";
      launcher.setAttribute("aria-label", "Open plugin shortcuts");
      launcher.setAttribute("aria-controls", "rebirth-plugin-flyout");
      launcher.setAttribute("aria-expanded", "false");
      launcher.title = "Plugins";
      launcher.innerHTML = icon("pluginGrid");
      launcher.addEventListener("click", function (event) {
        var panel = document.querySelector(".rebirth-plugin-flyout");
        var opening = Boolean(panel && panel.hidden);
        openPluginFlyout(opening);
        if (opening && event.detail === 0 && panel) {
          var firstShortcut = panel.querySelector(".rebirth-plugin-card");
          if (firstShortcut) { firstShortcut.focus(); }
        }
      });
      var firstSource = shortcuts[0].link;
      if (firstSource.parentNode === actions) { actions.insertBefore(launcher, firstSource); }
      else { actions.appendChild(launcher); }
    }

    if (!flyout) {
      flyout = document.createElement("section");
      flyout.id = "rebirth-plugin-flyout";
      flyout.className = "rebirth-plugin-flyout";
      flyout.setAttribute("role", "dialog");
      flyout.setAttribute("aria-label", "Plugin shortcuts");
      flyout.hidden = true;
      document.body.appendChild(flyout);
    }

    var signature = shortcuts.map(function (shortcut) {
      return [shortcut.key, shortcut.href, shortcut.label, shortcut.icon ? shortcut.icon.outerHTML : ""].join("~");
    }).join("|");
    if (flyout.getAttribute("data-signature") !== signature) {
      flyout.textContent = "";
      var header = document.createElement("header");
      header.className = "rebirth-plugin-flyout-heading";
      var heading = document.createElement("div");
      heading.className = "rebirth-plugin-flyout-title";
      var title = document.createElement("strong");
      title.textContent = "Plugins";
      var subtitle = document.createElement("span");
      subtitle.textContent = "Quick launch";
      heading.appendChild(title);
      heading.appendChild(subtitle);
      var close = document.createElement("button");
      close.type = "button";
      close.className = "rebirth-plugin-flyout-close";
      close.setAttribute("aria-label", "Close plugins menu");
      close.textContent = "×";
      close.addEventListener("click", function () { closePluginFlyout(true); });
      header.appendChild(heading);
      header.appendChild(close);
      flyout.appendChild(header);

      var grid = document.createElement("nav");
      grid.className = "rebirth-plugin-grid";
      grid.setAttribute("aria-label", "Installed plugin shortcuts");
      shortcuts.forEach(function (shortcut) {
        var card = document.createElement("a");
        card.className = "rebirth-plugin-card";
        card.href = shortcut.href;
        card.setAttribute("data-plugin-source-key", shortcut.key);
        card.setAttribute("data-plugin-path", shortcut.path);
        card.setAttribute("aria-label", shortcut.label + ". " + shortcut.description);
        card.title = shortcut.description;
        if (shortcut.link.target) { card.target = shortcut.link.target; }
        if (shortcut.link.rel) { card.rel = shortcut.link.rel; }
        var tile = document.createElement("span");
        tile.className = "rebirth-plugin-icon";
        tile.setAttribute("aria-hidden", "true");
        tile.innerHTML = shortcut.icon ? shortcut.icon.outerHTML : icon("plugins");
        var name = document.createElement("span");
        name.className = "rebirth-plugin-name";
        name.textContent = shortcut.label;
        card.appendChild(tile);
        card.appendChild(name);
        grid.appendChild(card);
      });
      flyout.appendChild(grid);

      var footer = document.createElement("footer");
      footer.className = "rebirth-plugin-flyout-footer";
      var note = document.createElement("small");
      note.textContent = "Available in this Stash install";
      var manage = document.createElement("a");
      manage.className = "rebirth-plugin-manage";
      manage.href = "/settings?tab=plugins";
      manage.innerHTML = 'Manage plugins <span aria-hidden="true">↗</span>';
      footer.appendChild(note);
      footer.appendChild(manage);
      flyout.appendChild(footer);
      flyout.setAttribute("data-signature", signature);
    }

    if (!flyout.hasAttribute("data-click-handler")) {
      flyout.addEventListener("click", function (event) {
        var card = event.target.closest(".rebirth-plugin-card");
        if (!card || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
        event.preventDefault();
        var key = card.getAttribute("data-plugin-source-key");
        var source = collectPluginShortcuts(navbar).filter(function (shortcut) { return shortcut.key === key; })[0];
        closePluginFlyout(false);
        if (source && source.link.isConnected) { source.link.click(); }
        else { window.location.assign(card.href); }
      });
      flyout.setAttribute("data-click-handler", "true");
    }
    if (!document.documentElement.hasAttribute("data-rebirth-plugin-flyout-handlers")) {
      document.addEventListener("click", function (event) {
        if (event.target.closest(".rebirth-plugin-flyout, .rebirth-plugin-launcher")) { return; }
        closePluginFlyout(false);
      });
      document.documentElement.setAttribute("data-rebirth-plugin-flyout-handlers", "true");
    }
    syncPluginLauncherActiveState();
  }

  function routeIcon(path) {
    if (path === "/") { return "home"; }
    if (path.indexOf("/scenes/markers") === 0) { return "markers"; }
    if (path.indexOf("/scenes") === 0) { return "scenes"; }
    if (path.indexOf("/images") === 0) { return "images"; }
    if (path.indexOf("/galleries") === 0) { return "galleries"; }
    if (path.indexOf("/performers") === 0) { return "performers"; }
    if (path.indexOf("/studios") === 0) { return "studios"; }
    if (path.indexOf("/groups") === 0) { return "groups"; }
    if (path.indexOf("/tags") === 0) { return "tags"; }
    if (path.indexOf("/stats") === 0) { return "stats"; }
    if (path.indexOf("/settings") === 0) { return "settings"; }
    if (path.indexOf("tab=tasks") !== -1) { return "activity"; }
    if (path.indexOf("tab=logs") !== -1) { return "logs"; }
    if (path.indexOf("tab=tools") !== -1) { return "tools"; }
    if (path.indexOf("tab=plugins") !== -1) { return "plugins"; }
    if (path.indexOf("tab=about") !== -1) { return "about"; }
    return "scenes";
  }

  function collectNavigationItems(navbar) {
    var nativeByPath = {};
    var menu = navbar.querySelector(".navbar-collapse");
    var links = menu ? menu.querySelectorAll("a[href]") : [];
    for (var i = 0; i < links.length; i++) {
      var anchor = links[i];
      if (anchor.target === "_blank") { continue; }
      var path;
      try { path = new URL(anchor.getAttribute("href"), window.location.origin).pathname; }
      catch (error) { continue; }
      if (path.charAt(0) !== "/" || path === "/logout" || /\/new\/?$/.test(path)) { continue; }
      var label = (anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (!label) { continue; }
      nativeByPath[path] = { href: path, label: label, icon: routeIcon(path) };
    }

    function item(href, fallback, iconName) {
      var native = nativeByPath[href];
      return { href: href, label: fallback || native && native.label || href, icon: iconName || routeIcon(href) };
    }
    return [
      item("/", "Home", "home"), item("/scenes", "Scenes", "scenes"), item("/images", "Images", "images"), item("/galleries", "Galleries", "galleries"),
      item("/performers", "Performers", "performers"), item("/studios", "Studios", "studios"), item("/groups", "Groups", "groups"), item("/tags", "Tags", "tags"), item("/scenes/markers", "Markers", "markers"),
      item("/stats", "Statistics", "stats"), item("/settings?tab=tasks", "Tasks & queue", "activity"), item("/settings?tab=logs", "Logs", "logs"),
      item("/settings", "Settings", "settings")
    ];
  }

  function navigationSections(items) {
    var definitions = [
      ["LIBRARY", ["/", "/scenes", "/images", "/galleries"]],
      ["PEOPLE & METADATA", ["/performers", "/studios", "/groups", "/tags", "/scenes/markers"]],
      ["ACTIVITY", ["/stats", "/settings?tab=tasks", "/settings?tab=logs"]],
      ["SETTINGS", ["/settings"]]
    ];
    return definitions.map(function (definition) {
      return { label: definition[0], items: definition[1].map(function (href) {
        return items.filter(function (item) { return item.href === href; })[0];
      }).filter(Boolean) };
    }).filter(function (section) { return section.items.length; });
  }

  function makeRouteLink(item, className) {
    var link = document.createElement("a");
    link.className = className;
    link.href = item.href;
    link.setAttribute("data-rebirth-route", item.href);
    link.setAttribute("aria-label", item.label);
    link.title = item.label;
    link.innerHTML = '<span class="rebirth-nav-icon">' + icon(item.icon) + "</span><span class=\"rebirth-nav-label\"></span>";
    link.querySelector(".rebirth-nav-label").textContent = item.label;
    return link;
  }

  function updateSidebarState(collapsed) {
    if (!document.body) { return; }
    document.body.classList.toggle("rebirth-sidebar-collapsed", Boolean(collapsed));
    var button = document.querySelector(".rebirth-sidebar-collapse");
    if (button) {
      button.setAttribute("aria-pressed", collapsed ? "true" : "false");
      button.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
      button.title = collapsed ? "Expand navigation" : "Collapse navigation";
    }
  }

  function itemIsActive(item, path, search) {
    var parsed = document.createElement("a");
    parsed.href = item.href || "/";
    if (parsed.search) { return path === parsed.pathname && search === parsed.search; }
    if (item.href === "/settings") { return path === "/settings" && !search; }
    if (item.href === "/") { return path === "/"; }
    if (item.href === "/plugin/rebirth") { return path.indexOf(item.href) === 0; }
    if (item.href === "/scenes" && path.indexOf("/scenes/markers") === 0) { return false; }
    return path === item.href || path.indexOf(item.href + "/") === 0;
  }

  function updateActiveNavigation() {
    var path = window.location.pathname || "/";
    var search = window.location.search || "";
    var links = document.querySelectorAll("[data-rebirth-route]");
    for (var i = 0; i < links.length; i++) {
      var active = itemIsActive({ href: links[i].getAttribute("data-rebirth-route") }, path, search);
      links[i].classList.toggle("is-active", active);
      if (active) { links[i].setAttribute("aria-current", "page"); }
      else { links[i].removeAttribute("aria-current"); }
    }
    var mobileMore = document.querySelector(".rebirth-mobile-more");
    if (mobileMore) {
      var isDocked = readPreferences().mobileDock.some(function (href) { return itemIsActive({ href: href }, path, search); });
      mobileMore.classList.toggle("is-active", !isDocked);
    }
    syncPluginLauncherActiveState();
  }

  function openMobileDrawer(open) {
    if (!document.body) { return; }
    document.body.classList.toggle("rebirth-drawer-open", Boolean(open));
    var trigger = document.querySelector(".rebirth-mobile-more");
    if (trigger) { trigger.setAttribute("aria-expanded", open ? "true" : "false"); }
  }

  function renderNavigation(navbar) {
    if (!document.body) { return false; }
    var items = collectNavigationItems(navbar);
    var primary = items;
    var sections = navigationSections(primary);
    var signature = items.map(function (item) { return item.href + ":" + item.label; }).join("|");

    var sidebar = document.querySelector(".rebirth-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "rebirth-sidebar";
      sidebar.setAttribute("aria-label", "Primary navigation");
      sidebar.innerHTML = '<div class="rebirth-sidebar-brand-row"><a class="rebirth-brand" href="/" data-rebirth-route="/" aria-label="Rebirth home"><span class="rebirth-brand-mark">' + REBIRTH_MARK + '</span><span class="rebirth-brand-name">Rebirth</span></a><button type="button" class="rebirth-sidebar-collapse" aria-label="Collapse navigation" aria-pressed="false" title="Collapse navigation">' + icon("collapse") + "</button></div><nav class=\"rebirth-sidebar-nav\" aria-label=\"Rebirth sections\"><div class=\"rebirth-sidebar-primary\"></div></nav>";
      document.body.appendChild(sidebar);
      sidebar.addEventListener("click", function (event) {
        var collapse = event.target.closest(".rebirth-sidebar-collapse");
        if (collapse) {
          event.preventDefault();
          savePreferences({ sidebarCollapsed: !document.body.classList.contains("rebirth-sidebar-collapsed") });
          return;
        }
        var route = event.target.closest("[data-rebirth-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }

    if (sidebar.getAttribute("data-signature") !== signature) {
      var primaryHost = sidebar.querySelector(".rebirth-sidebar-primary");
      primaryHost.textContent = "";
      sections.forEach(function (section) {
        var group = document.createElement("section");
        group.className = "rebirth-nav-section";
        var heading = document.createElement("h2");
        heading.className = "rebirth-nav-section-heading";
        heading.textContent = section.label;
        group.appendChild(heading);
        section.items.forEach(function (item) { group.appendChild(makeRouteLink(item, "rebirth-nav-item")); });
        primaryHost.appendChild(group);
      });
      sidebar.setAttribute("data-signature", signature);
    }

    var dock = document.querySelector(".rebirth-mobile-dock");
    if (!dock) {
      dock = document.createElement("nav");
      dock.className = "rebirth-mobile-dock";
      dock.setAttribute("aria-label", "Quick navigation");
      document.body.appendChild(dock);
      dock.addEventListener("click", function (event) {
        var more = event.target.closest(".rebirth-mobile-more");
        if (more) { event.preventDefault(); openMobileDrawer(!document.body.classList.contains("rebirth-drawer-open")); return; }
        var route = event.target.closest("[data-rebirth-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    var mobileDock = readPreferences().mobileDock;
    var dockSignature = signature + "|" + mobileDock.join(",");
    if (dock.getAttribute("data-dock-preferences") !== dockSignature) {
      dock.textContent = "";
      mobileDock.map(function (href) { return primary.filter(function (item) { return item.href === href; })[0]; }).filter(Boolean).forEach(function (item) { dock.appendChild(makeRouteLink(item, "rebirth-dock-item")); });
      var moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "rebirth-dock-item rebirth-mobile-more";
      moreButton.setAttribute("aria-label", "Open menu for remaining pages");
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.innerHTML = '<span class="rebirth-nav-icon">' + icon("menu") + '</span><span class="rebirth-nav-label">More</span>';
      dock.appendChild(moreButton);
      dock.setAttribute("data-dock-preferences", dockSignature);
    }

    var drawer = document.querySelector(".rebirth-mobile-drawer");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "rebirth-mobile-drawer";
      drawer.setAttribute("aria-label", "More pages");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", function (event) {
        if (event.target === drawer) { openMobileDrawer(false); return; }
        var route = event.target.closest("[data-rebirth-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    var drawerSignature = signature + "|" + mobileDock.join(",");
    if (drawer.getAttribute("data-signature") !== drawerSignature) {
      drawer.textContent = "";
      var sheet = document.createElement("section");
      sheet.className = "rebirth-mobile-sheet";
      var sheetHeading = document.createElement("div");
      sheetHeading.className = "rebirth-mobile-sheet-heading";
      sheetHeading.innerHTML = "<strong>More pages</strong>";
      var close = document.createElement("button");
      close.type = "button";
      close.className = "rebirth-mobile-close";
      close.setAttribute("aria-label", "Close navigation");
      close.textContent = "×";
      close.addEventListener("click", function () { openMobileDrawer(false); });
      sheetHeading.appendChild(close);
      sheet.appendChild(sheetHeading);
      navigationSections(primary.filter(function (item) { return mobileDock.indexOf(item.href) === -1; })).forEach(function (section) {
        var group = document.createElement("section");
        group.className = "rebirth-mobile-nav-section";
        var heading = document.createElement("h3");
        heading.className = "rebirth-mobile-nav-section-heading";
        heading.textContent = section.label;
        group.appendChild(heading);
        section.items.forEach(function (item) { group.appendChild(makeRouteLink(item, "rebirth-mobile-sheet-link")); });
        sheet.appendChild(group);
      });
      drawer.appendChild(sheet);
      drawer.setAttribute("data-signature", drawerSignature);
    }

    document.body.classList.add("rebirth-active");
    renderPluginLauncher(navbar);
    applyPreferences(readPreferences());
    updateActiveNavigation();
    refreshTopbarContext();
    return true;
  }

  function navigateFromLink(event, link) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
    var href = link.getAttribute("data-rebirth-route");
    if (!href) { return; }
    event.preventDefault();
    openMobileDrawer(false);
    if (window.location.pathname + window.location.search !== href) {
      window.location.assign(href);
    }
    updateActiveNavigation();
    refreshTopbarContext();
  }

  function settingsTabFromLink(link) {
    var key = link.getAttribute("data-rb-event-key");
    if (key) { return key; }
    try { return new URL(link.getAttribute("href"), window.location.origin).searchParams.get("tab"); }
    catch (error) { return null; }
  }

  function enhanceNativeSettings() {
    var menu = document.querySelector("#settings-menu-container");
    var nav = menu && menu.querySelector(".nav");
    var container = document.querySelector("#settings-container");
    if (!menu || !nav || !container) { return; }
    var settingsLayout = menu.parentElement;
    while (settingsLayout && !settingsLayout.contains(container)) { settingsLayout = settingsLayout.parentElement; }
    if (settingsLayout) {
      settingsLayout.classList.add("rebirth-settings-layout");
      settingsLayout.style.setProperty("display", "block", "important");
      settingsLayout.style.marginLeft = "0";
      settingsLayout.style.marginRight = "0";
    }
    menu.style.setProperty("display", "block", "important");
    menu.style.setProperty("position", "static", "important");
    menu.style.width = "100%";
    menu.style.maxWidth = "100%";
    container.style.setProperty("display", "block", "important");
    container.style.width = "100%";
    container.style.maxWidth = "100%";
    container.style.setProperty("margin-left", "0", "important");

    var links = Array.prototype.slice.call(nav.querySelectorAll("a[href]"));
    if (!links.length) { return; }
    if (nav.getAttribute("data-rebirth-settings-bound") !== "true") {
      nav.setAttribute("data-rebirth-settings-bound", "true");
      nav.addEventListener("click", function (event) {
        var link = event.target.closest("a[href]");
        if (link && nav.contains(link)) { window.setTimeout(enhanceNativeSettings, 0); }
      });
    }
    links.forEach(function (link) {
      var item = link.closest(".nav-item");
      if (item) { item.classList.add("rebirth-settings-link-item"); }
    });
    var picker = menu.querySelector(".rebirth-settings-section-picker");
    if (!picker) {
      var pickerLabel = document.createElement("label");
      pickerLabel.className = "rebirth-settings-section-label";
      pickerLabel.textContent = "Settings section";
      picker = document.createElement("select");
      picker.className = "rebirth-settings-section-picker";
      picker.setAttribute("aria-label", "Settings section");
      picker.addEventListener("change", function () {
        var currentNav = document.querySelector("#settings-menu-container .nav");
        var currentLinks = currentNav ? Array.prototype.slice.call(currentNav.querySelectorAll("a[href]")) : [];
        var target = currentLinks.filter(function (link) { return link.getAttribute("href") === picker.value; })[0];
        if (target) { target.click(); }
      });
      menu.insertBefore(pickerLabel, nav);
      menu.insertBefore(picker, nav);
    }

    var options = links.map(function (link) {
      return (link.getAttribute("href") || "") + "|" + (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim();
    }).join("\n");
    if (picker.getAttribute("data-signature") !== options) {
      picker.textContent = "";
      links.forEach(function (link) {
        var option = document.createElement("option");
        option.value = link.getAttribute("href");
        option.textContent = (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim();
        picker.appendChild(option);
      });
      picker.setAttribute("data-signature", options);
    }

    var activeLink = links.filter(function (link) {
      return link.classList.contains("active") || link.getAttribute("aria-selected") === "true" || link.getAttribute("aria-current") === "page";
    })[0];
    var tab = new URLSearchParams(window.location.search).get("tab");
    if (!activeLink) { activeLink = links.filter(function (link) { return settingsTabFromLink(link) === tab; })[0]; }
    if (!activeLink) { activeLink = links[0]; }
    if (activeLink && picker.value !== activeLink.getAttribute("href")) { picker.value = activeLink.getAttribute("href"); }

    var activePanel = container.querySelector(".tab-pane.active");
    if (tab === "plugins" && activePanel) {
      var pluginSettings = activePanel.querySelector(".plugin-settings");
      var section = pluginSettings && pluginSettings.closest(".setting-section");
      var card = section && section.querySelector(":scope > .card");
      var toolbar = card && card.querySelector(":scope > .content");
      var pluginList = toolbar && toolbar.nextElementSibling;
      Array.prototype.forEach.call(activePanel.querySelectorAll(".rebirth-settings-plugin-list"), function (list) {
        if (list !== pluginList) { list.classList.remove("rebirth-settings-plugin-list"); }
      });
      if (pluginList && !pluginList.classList.contains("rebirth-settings-plugin-list")) {
        pluginList.classList.add("rebirth-settings-plugin-list");
      }
    }
    if (mountRebirthThemeSettingsInInterface) { mountRebirthThemeSettingsInInterface(); }
  }

  function createGraphQLClient() {
    return function (query, signal) {
      return fetch("/graphql", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query }),
        signal: signal
      }).then(function (response) {
        if (!response.ok) { throw new Error("Stash query failed"); }
        return response.json();
      }).then(function (result) {
        if (result && result.errors && result.errors.length) { throw new Error("Stash query returned errors"); }
        return result && result.data ? result.data : {};
      });
    };
  }

  function formatDuration(value) {
    var total = Math.floor(Number(value) || 0);
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    var pad = function (number) { return number < 10 ? "0" + number : String(number); };
    return hours ? hours + ":" + pad(minutes) + ":" + pad(seconds) : minutes + ":" + pad(seconds);
  }

  function formatAdded(value) {
    var timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) { return "Recently added"; }
    var elapsed = Math.max(0, Date.now() - timestamp);
    var days = Math.floor(elapsed / 86400000);
    if (elapsed < 3600000) { return "Added recently"; }
    if (days < 1) { return "Added today"; }
    if (days === 1) { return "Added yesterday"; }
    if (days < 7) { return "Added " + days + " days ago"; }
    return "Added " + new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
  }

  function fitCarouselTitle(titleElement) {
    if (!titleElement || !titleElement.parentElement) { return; }
    var copy = titleElement.parentElement;
    var hero = copy.closest ? copy.closest(".rebirth-home-hero") : null;
    if (!hero) { return; }

    titleElement.style.fontSize = "";
    titleElement.style.flex = "0 0 auto";
    titleElement.style.maxHeight = "";
    titleElement.style.overflowY = "";
    var titleStyle = window.getComputedStyle(titleElement);
    var preferredSize = parseFloat(titleStyle.fontSize) || 48;
    var minimumSize = Math.min(window.innerWidth <= 700 ? 32 : 36, preferredSize);
    var copyStyle = window.getComputedStyle(copy);
    var availableHeight = copy.clientHeight - (parseFloat(copyStyle.paddingTop) || 0) - (parseFloat(copyStyle.paddingBottom) || 0);

    Array.prototype.forEach.call(copy.children, function (child) {
      if (child === titleElement) { return; }
      var childStyle = window.getComputedStyle(child);
      availableHeight -= child.getBoundingClientRect().height + (parseFloat(childStyle.marginTop) || 0) + (parseFloat(childStyle.marginBottom) || 0);
    });
    var titleMargin = (parseFloat(titleStyle.marginTop) || 0) + (parseFloat(titleStyle.marginBottom) || 0);
    var titleSpace = Math.max(0, availableHeight - titleMargin);
    var fitted = false;

    for (var size = preferredSize; size >= minimumSize; size -= 1) {
      titleElement.style.fontSize = size + "px";
      if (titleElement.scrollHeight <= titleSpace + 1) {
        fitted = true;
        break;
      }
    }

    if (!fitted) {
      titleElement.style.fontSize = minimumSize + "px";
      titleElement.style.maxHeight = titleSpace + "px";
      titleElement.style.overflowY = "auto";
    }
  }

  function shuffleCarouselScenes(scenes) {
    var shuffled = scenes.slice();
    for (var i = shuffled.length - 1; i > 0; i -= 1) {
      var swapIndex = Math.floor(Math.random() * (i + 1));
      var scene = shuffled[i];
      shuffled[i] = shuffled[swapIndex];
      shuffled[swapIndex] = scene;
    }
    var previousSceneId = null;
    try { previousSceneId = window.sessionStorage.getItem("rebirth.carousel.random.last-scene.v1"); }
    catch (error) { /* Random selection still works when session storage is unavailable. */ }
    if (shuffled.length > 1 && String(shuffled[0].id) === String(previousSceneId)) {
      shuffled.push(shuffled.shift());
    }
    if (shuffled.length) {
      try { window.sessionStorage.setItem("rebirth.carousel.random.last-scene.v1", String(shuffled[0].id)); }
      catch (error) { /* Random selection still works when session storage is unavailable. */ }
    }
    return shuffled;
  }

  var statisticsScenesPromise = null;
  function loadStatisticsScenes() {
    if (statisticsScenesPromise) { return statisticsScenesPromise; }
    statisticsScenesPromise = (function () {
      var results = [];
      function loadPage(page) {
        var query = "query RebirthStatistics { findScenes(filter: { per_page: 100, page: " + page + ", sort: \"date\", direction: DESC }) { scenes { date files { height } } } }";
        return createGraphQLClient()(query).then(function (result) {
          var rows = result.findScenes && result.findScenes.scenes || [];
          results = results.concat(rows);
          if (rows.length === 100 && page < 100) { return loadPage(page + 1); }
          return results;
        });
      }
      return loadPage(1).catch(function () { return []; });
    })();
    return statisticsScenesPromise;
  }

  function makeSvgElement(name, attributes, text) {
    var element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
    if (text !== undefined) { element.textContent = text; }
    return element;
  }

  function makeYearChart(scenes) {
    var counts = {};
    scenes.forEach(function (scene) {
      var match = String(scene.date || "").match(/^(\d{4})/);
      if (match && Number(match[1]) > 1800) { counts[match[1]] = (counts[match[1]] || 0) + 1; }
    });
    var years = Object.keys(counts).sort().slice(-7);
    var chart = makeSvgElement("svg", { viewBox: "0 0 640 190", role: "img", "aria-label": "Scenes by year" });
    if (!years.length) {
      chart.appendChild(makeSvgElement("text", { x: "320", y: "100", "text-anchor": "middle", class: "rebirth-chart-empty" }, "No dated scenes yet"));
      return chart;
    }
    var max = Math.max.apply(Math, years.map(function (year) { return counts[year]; }));
    [0, 0.5, 1].forEach(function (fraction) {
      var y = 145 - fraction * 112;
      chart.appendChild(makeSvgElement("line", { x1: "38", x2: "626", y1: y, y2: y, class: "rebirth-chart-grid" }));
      chart.appendChild(makeSvgElement("text", { x: "29", y: y + 4, "text-anchor": "end", class: "rebirth-chart-axis" }, String(Math.round(max * fraction))));
    });
    var step = 588 / years.length;
    years.forEach(function (year, index) {
      var value = counts[year];
      var height = Math.max(3, value / max * 112);
      var x = 46 + index * step + step * .22;
      var width = step * .56;
      chart.appendChild(makeSvgElement("rect", { x: x, y: 145 - height, width: width, height: height, rx: "3", class: "rebirth-chart-bar" }));
      chart.appendChild(makeSvgElement("text", { x: x + width / 2, y: 163, "text-anchor": "middle", class: "rebirth-chart-axis" }, year));
      chart.appendChild(makeSvgElement("text", { x: x + width / 2, y: 145 - height - 7, "text-anchor": "middle", class: "rebirth-chart-value" }, String(value)));
    });
    return chart;
  }

  function makeResolutionChart(scenes) {
    var bins = [
      { label: "4K", min: 2160, count: 0 }, { label: "1440p", min: 1440, count: 0 },
      { label: "1080p", min: 1080, count: 0 }, { label: "720p", min: 720, count: 0 },
      { label: "480p", min: 480, count: 0 }, { label: "360p", min: 360, count: 0 },
      { label: "Other", min: 0, count: 0 }
    ];
    scenes.forEach(function (scene) {
      var height = Math.max.apply(Math, (scene.files || []).map(function (file) { return Number(file && file.height || 0); }).concat([0]));
      var bin = bins.filter(function (entry) { return height >= entry.min; })[0] || bins[bins.length - 1];
      bin.count += 1;
    });
    var total = scenes.length;
    var order = bins.slice().sort(function (a, b) { return b.count - a.count; });
    var chart = document.createElement("div");
    chart.className = "rebirth-resolution-rows";
    order.forEach(function (bin) {
      var row = document.createElement("div");
      row.className = "rebirth-resolution-row";
      var label = document.createElement("span");
      label.className = "rebirth-resolution-label";
      label.textContent = bin.label;
      var track = document.createElement("span");
      track.className = "rebirth-resolution-track";
      var fill = document.createElement("span");
      fill.style.width = (total ? bin.count / total * 100 : 0) + "%";
      track.appendChild(fill);
      var value = document.createElement("span");
      value.className = "rebirth-resolution-value";
      value.textContent = bin.count + " (" + (total ? (bin.count / total * 100).toFixed(1) : "0.0") + "%)";
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      chart.appendChild(row);
    });
    return chart;
  }

  function mountRebirthStatistics() {
    if (window.location.pathname !== "/stats") { return; }
    var main = document.querySelector(".main.container-fluid");
    var root = main && main.querySelector(".mt-5");
    if (!root || root.querySelector(".rebirth-stats-insights")) { return; }
    loadStatisticsScenes().then(function (scenes) {
      if (window.location.pathname !== "/stats" || !root.isConnected || root.querySelector(".rebirth-stats-insights")) { return; }
      var section = document.createElement("section");
      section.className = "rebirth-stats-insights";
      var yearPanel = document.createElement("article");
      yearPanel.className = "rebirth-stats-panel rebirth-years-panel";
      var yearHeading = document.createElement("div");
      yearHeading.className = "rebirth-stats-panel-heading";
      yearHeading.innerHTML = "<h2>Scenes by year</h2><span>Scene release dates in your library</span>";
      yearPanel.appendChild(yearHeading);
      yearPanel.appendChild(makeYearChart(scenes));
      var resolutionPanel = document.createElement("article");
      resolutionPanel.className = "rebirth-stats-panel rebirth-resolution-panel";
      var resolutionHeading = document.createElement("div");
      resolutionHeading.className = "rebirth-stats-panel-heading";
      resolutionHeading.innerHTML = "<h2>Media resolution</h2><span>Highest file resolution per scene</span>";
      resolutionPanel.appendChild(resolutionHeading);
      resolutionPanel.appendChild(makeResolutionChart(scenes));
      section.appendChild(yearPanel);
      section.appendChild(resolutionPanel);
      root.appendChild(section);
    });
  }

  function updateRebirthRangeProgress(range) {
    if (!range || !range.matches || !range.matches(".zoom-slider")) { return; }
    var minimum = Number(range.min || 0);
    var maximum = Number(range.max || 100);
    var value = Number(range.value || 0);
    var progress = maximum > minimum ? Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100)) : 0;
    range.style.setProperty("--rebirth-range-progress", progress + "%");
  }

  function syncRebirthRangeControls() {
    var ranges = document.querySelectorAll(".item-list-container .filtered-list-toolbar .zoom-slider");
    for (var i = 0; i < ranges.length; i++) { updateRebirthRangeProgress(ranges[i]); }
  }

  function sceneView(scene) {
    var files = (scene && scene.files || []).slice().sort(function (a, b) {
      return Number(b && b.height || 0) - Number(a && a.height || 0);
    });
    var file = files[0] || {};
    var title = (scene && scene.title || "").trim();
    if (!title && file.basename) { title = String(file.basename).replace(/\.[^/.]+$/, ""); }
    return {
      id: String(scene && scene.id || ""),
      title: title || "Untitled scene",
      image: scene && scene.paths && scene.paths.screenshot || "",
      duration: Number(file.duration || 0),
      height: Number(file.height || 0),
      date: scene && scene.date || "",
      createdAt: scene && scene.created_at || "",
      studio: scene && scene.studio && scene.studio.name || "",
      performers: (scene && scene.performers || []).map(function (performer) { return performer && performer.name; }).filter(Boolean),
      resumeTime: Number(scene && scene.resume_time || 0)
    };
  }

  function buildPlugin(PluginApi) {
    var React = PluginApi.React;
    var h = React.createElement;
    var RouterLink = PluginApi.libraries && PluginApi.libraries.ReactRouterDOM && PluginApi.libraries.ReactRouterDOM.Link;
    var gql = createGraphQLClient();

    function tagFilterCriterion(filter, type) {
      return (filter && filter.criteria || []).filter(function (criterion) {
        return criterion && criterion.criterionOption && criterion.criterionOption.type === type;
      });
    }

    function numericCriterionValue(criterion) {
      if (!criterion) { return undefined; }
      var value = criterion.value;
      return value && typeof value === "object" ? value.value : value;
    }

    function tagLetterFromCriterion(criterion) {
      if (!criterion || criterion.modifier !== "MATCHES_REGEX") { return null; }
      var value = String(criterion.value || "");
      var letter = value.match(/^\(\?i\)\^([A-Z])$/i);
      if (letter) { return letter[1].toUpperCase(); }
      if (value === "(?i)^[^\\p{L}]") { return "#"; }
      return null;
    }

    function readTagBrowseState(filter) {
      var parentCounts = tagFilterCriterion(filter, "parent_count");
      var childCounts = tagFilterCriterion(filter, "child_count");
      var hasParents = parentCounts.some(function (criterion) {
        return criterion.modifier === "GREATER_THAN" && Number(numericCriterionValue(criterion)) === 0;
      });
      var hasChildren = childCounts.some(function (criterion) {
        return criterion.modifier === "GREATER_THAN" && Number(numericCriterionValue(criterion)) === 0;
      });
      var noParents = parentCounts.some(function (criterion) {
        return criterion.modifier === "EQUALS" && Number(numericCriterionValue(criterion)) === 0;
      });
      var noChildren = childCounts.some(function (criterion) {
        return criterion.modifier === "EQUALS" && Number(numericCriterionValue(criterion)) === 0;
      });
      var parentItems = [];
      var parentCriteria = tagFilterCriterion(filter, "parents");
      parentCriteria.forEach(function (criterion) {
        if (criterion.value && Array.isArray(criterion.value.items)) {
          parentItems = parentItems.concat(criterion.value.items);
        }
      });
      var nameCriteria = tagFilterCriterion(filter, "name");
      var letters = nameCriteria.map(tagLetterFromCriterion).filter(Boolean);
      var letter = letters.length ? letters[letters.length - 1] : null;
      var customNameFilter = nameCriteria.some(function (criterion) { return !tagLetterFromCriterion(criterion); });
      var hierarchy = "all";
      if (noParents && noChildren) { hierarchy = "standalone"; }
      else if (hasParents) { hierarchy = "children"; }
      else if (hasChildren) { hierarchy = "parents"; }
      return {
        hierarchy: hierarchy,
        parentItems: parentItems,
        letter: letter,
        customNameFilter: customNameFilter
      };
    }

    function makeTagCountCriterion(filter, type, modifier, value) {
      var criterion = filter.makeCriterion(type);
      criterion.modifier = modifier;
      criterion.value = value;
      return criterion;
    }

    function applyTagBrowseFilters(filter, setFilter, hierarchy, parentItems, letter) {
      var next = filter.clone();
      var browseTypes = ["parents", "parent_count", "child_count"];
      var state = readTagBrowseState(filter);
      var criteria = next.criteria.filter(function (criterion) {
        var type = criterion && criterion.criterionOption && criterion.criterionOption.type;
        if (browseTypes.indexOf(type) !== -1) { return false; }
        if (type === "name" && state.letter && tagLetterFromCriterion(criterion)) { return false; }
        return true;
      });

      if (hierarchy === "parents") {
        criteria.push(makeTagCountCriterion(next, "child_count", "GREATER_THAN", 0));
      } else if (hierarchy === "children") {
        criteria.push(makeTagCountCriterion(next, "parent_count", "GREATER_THAN", 0));
      } else if (hierarchy === "standalone") {
        criteria.push(makeTagCountCriterion(next, "parent_count", "EQUALS", 0));
        criteria.push(makeTagCountCriterion(next, "child_count", "EQUALS", 0));
      }

      if (parentItems && parentItems.length) {
        var parentCriterion = next.makeCriterion("parents");
        parentCriterion.modifier = "INCLUDES";
        parentCriterion.value = {
          items: parentItems.map(function (item) { return { id: String(item.id), label: String(item.label || item.name || "") }; }),
          excluded: [],
          depth: 0
        };
        criteria.push(parentCriterion);
      }

      if (letter) {
        var nameCriterion = next.makeCriterion("name");
        nameCriterion.modifier = "MATCHES_REGEX";
        nameCriterion.value = letter === "#" ? "(?i)^[^\\p{L}]" : "(?i)^" + letter;
        criteria.push(nameCriterion);
      }

      setFilter(next.setCriteria(criteria));
    }

    function TagBrowseControls(props) {
      var filter = props.filter;
      var setFilter = props.setFilter;
      var state = readTagBrowseState(filter);
      var parentQuery = PluginApi.GQL.useFindTagsForSelectQuery({
        variables: {
          filter: { per_page: -1, sort: "name", direction: "ASC" },
          tag_filter: { child_count: { value: 0, modifier: "GREATER_THAN" } }
        },
        fetchPolicy: "cache-first"
      });
      var parentTags = parentQuery.data && parentQuery.data.findTags && parentQuery.data.findTags.tags || [];
      var selectedParentValue = state.parentItems.length === 1 ? String(state.parentItems[0].id) : state.parentItems.length > 1 ? "__multiple" : "";
      var parentOptions = parentTags.slice();
      if (state.parentItems.length === 1 && !parentOptions.some(function (tag) { return String(tag.id) === selectedParentValue; })) {
        parentOptions.push({ id: state.parentItems[0].id, name: state.parentItems[0].label });
      }
      var letters = ["All"].concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), ["#"]);

      function updateHierarchy(event) {
        applyTagBrowseFilters(filter, setFilter, event.target.value, state.parentItems, state.letter);
      }

      function updateParent(event) {
        var id = event.target.value;
        var selected = parentTags.filter(function (tag) { return String(tag.id) === id; })[0];
        var parentItems = selected ? [{ id: selected.id, label: selected.name }] : [];
        if (id === "__multiple") { parentItems = state.parentItems; }
        applyTagBrowseFilters(filter, setFilter, state.hierarchy, parentItems, state.letter);
      }

      function updateLetter(letter) {
        if (state.customNameFilter && letter !== "All") { return; }
        applyTagBrowseFilters(filter, setFilter, state.hierarchy, state.parentItems, letter === "All" ? null : letter);
      }

      return h("section", { className: "rebirth-tag-browse-controls", "aria-label": "Tag hierarchy filters" },
        h("div", { className: "rebirth-tag-filter-row" },
          h("label", { className: "rebirth-tag-filter-control" },
            h("span", null, "Hierarchy"),
            h("select", { value: state.hierarchy, onChange: updateHierarchy, "aria-label": "Filter tag hierarchy" },
              h("option", { value: "all" }, "All tags"),
              h("option", { value: "parents" }, "Parent tags"),
              h("option", { value: "children" }, "Child tags"),
              h("option", { value: "standalone" }, "Standalone tags"))),
          h("label", { className: "rebirth-tag-filter-control rebirth-tag-parent-control" },
            h("span", null, "Parent tag"),
            h("select", { value: selectedParentValue, onChange: updateParent, "aria-label": "Filter by parent tag", disabled: parentQuery.loading && !parentTags.length },
              h("option", { value: "" }, parentQuery.loading ? "Loading parent tags…" : "Any parent"),
              state.parentItems.length > 1 ? h("option", { value: "__multiple" }, "Multiple parents selected") : null,
              parentOptions.map(function (tag) { return h("option", { value: String(tag.id), key: String(tag.id) }, tag.name); })))),
        h("div", { className: "rebirth-tag-alphabet-wrap" },
          h("nav", { className: "rebirth-tag-alphabet", "aria-label": "Filter tags by first letter" },
            h("span", { className: "rebirth-tag-alphabet-label" }, "Starts with"),
            letters.map(function (letter) {
              var selected = state.letter ? state.letter === letter : letter === "All";
              var disabled = state.customNameFilter && letter !== "All";
              return h("button", {
                key: letter,
                type: "button",
                className: "rebirth-tag-letter" + (selected ? " is-selected" : ""),
                "aria-pressed": selected,
                "aria-label": letter === "All" ? "All starting letters" : letter === "#" ? "Numbers and symbols" : "Tags starting with " + letter,
                title: letter === "All" ? "All starting letters" : letter === "#" ? "Numbers and symbols" : "Starts with " + letter,
                disabled: disabled,
                onClick: function () { updateLetter(letter); }
              }, letter);
            })),
          state.customNameFilter ? h("small", { className: "rebirth-tag-alpha-note" }, "Clear the existing name filter to use the letter index.") : null));
    }

    function tagLink(to, className, content, attributes) {
      var props = Object.assign({ className: className }, attributes || {});
      if (RouterLink) { props.to = to; return h(RouterLink, props, content); }
      props.href = to;
      return h("a", props, content);
    }

    function RebirthTagFavorite(props) {
      var tag = props.tag;
      var _favoriteState = React.useState(Boolean(tag.favorite));
      var favorite = _favoriteState[0];
      var setFavorite = _favoriteState[1];
      var _savingState = React.useState(false);
      var saving = _savingState[0];
      var setSaving = _savingState[1];
      var _errorState = React.useState(false);
      var failed = _errorState[0];
      var setFailed = _errorState[1];

      function toggleFavorite(event) {
        event.preventDefault();
        event.stopPropagation();
        if (saving) { return; }
        var nextValue = !favorite;
        setSaving(true);
        setFailed(false);
        return fetch("/graphql", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: "mutation RebirthSetTagFavorite($input: TagUpdateInput!) { tagUpdate(input: $input) { id favorite } }",
            variables: { input: { id: String(tag.id), favorite: nextValue } }
          })
        }).then(function (response) {
          if (!response.ok) { throw new Error("Tag favorite update failed"); }
          return response.json();
        }).then(function (result) {
          if (!result || result.errors && result.errors.length || !result.data || !result.data.tagUpdate) {
            throw new Error("Tag favorite update failed");
          }
          setFavorite(nextValue);
        }).catch(function () {
          setFailed(true);
        }).then(function () {
          setSaving(false);
        });
      }

      var label = failed ? "Could not update favorite" : (favorite ? "Remove from favorites" : "Add to favorites");
      return h("button", {
        type: "button",
        className: "rebirth-tag-favorite" + (favorite ? " is-favorite" : "") + (failed ? " has-error" : ""),
        "aria-label": label + ": " + (tag.name || "tag"),
        "aria-pressed": favorite,
        title: label,
        disabled: saving,
        onClick: toggleFavorite
      }, "♥");
    }

    function RebirthTagDirectory(props) {
      var tags = props.tags || [];
      var selectedIds = props.selectedIds || new Set();
      var onSelectChange = props.onSelectChange || function () {};
      var filter = props.filter || {};
      var detailed = Number(filter.displayMode) === 1;
      if (!tags.length) {
        return h("div", { className: "rebirth-tag-empty" }, h("strong", null, "No tags found"), h("span", null, "Try a different search or clear one of the active filters."));
      }

      var rows = tags.map(function (tag) {
        var parents = Array.isArray(tag.parents) ? tag.parents : [];
        var children = Array.isArray(tag.children) ? tag.children : [];
        var aliases = Array.isArray(tag.aliases) ? tag.aliases.filter(Boolean) : [];
        var description = String(tag.description || "").trim();
        var selected = selectedIds.has(String(tag.id));
        var sceneUrl = PluginApi.utils && PluginApi.utils.NavUtils && PluginApi.utils.NavUtils.makeTagScenesUrl
          ? PluginApi.utils.NavUtils.makeTagScenesUrl(tag) : "/scenes";
        var childUrl = PluginApi.utils && PluginApi.utils.NavUtils && PluginApi.utils.NavUtils.makeChildTagsUrl
          ? PluginApi.utils.NavUtils.makeChildTagsUrl(tag) : "/tags";
        var navUtils = PluginApi.utils && PluginApi.utils.NavUtils || {};
        var usageItems = [
          { label: "Scenes", count: Number(tag.scene_count || 0), url: sceneUrl },
          { label: "Images", count: Number(tag.image_count || 0), url: navUtils.makeTagImagesUrl ? navUtils.makeTagImagesUrl(tag) : "/images" },
          { label: "Galleries", count: Number(tag.gallery_count || 0), url: navUtils.makeTagGalleriesUrl ? navUtils.makeTagGalleriesUrl(tag) : "/galleries" },
          { label: "Groups", count: Number(tag.group_count || 0), url: navUtils.makeTagGroupsUrl ? navUtils.makeTagGroupsUrl(tag) : "/groups" },
          { label: "Markers", count: Number(tag.scene_marker_count || 0), url: navUtils.makeTagSceneMarkersUrl ? navUtils.makeTagSceneMarkersUrl(tag) : "/scenes/markers" },
          { label: "Performers", count: Number(tag.performer_count || 0), url: navUtils.makeTagPerformersUrl ? navUtils.makeTagPerformersUrl(tag) : "/performers" },
          { label: "Studios", count: Number(tag.studio_count || 0), url: navUtils.makeTagStudiosUrl ? navUtils.makeTagStudiosUrl(tag) : "/studios" }
        ].filter(function (item) { return item.count > 0; });
        var usage = usageItems.length
          ? h("div", { className: "rebirth-tag-usage-list" }, usageItems.map(function (item) {
            return tagLink(item.url, "rebirth-tag-usage-link", h(React.Fragment, null,
              h("span", { className: "rebirth-tag-usage-label" }, item.label),
              h("span", { className: "rebirth-tag-count" }, String(item.count))),
            { key: item.label, "aria-label": item.count + " " + item.label.toLowerCase() + " tagged " + (tag.name || "") });
          }))
          : h("span", { className: "rebirth-tag-no-usage" }, "No linked items");
        var details = detailed ? h("span", { className: "rebirth-tag-detail-lines" },
          description ? h("span", { className: "rebirth-tag-description" }, description) : null,
          aliases.length ? h("span", { className: "rebirth-tag-aliases" }, "Aliases: " + aliases.join(", ")) : null) : null;
        return h("tr", { key: String(tag.id), className: selected ? "is-selected" : undefined },
          h("td", { className: "rebirth-tag-select-cell" }, h("input", {
            type: "checkbox",
            checked: selected,
            "aria-label": "Select " + tag.name,
            onChange: function (event) { onSelectChange(String(tag.id), event.target.checked, Boolean(event.nativeEvent && event.nativeEvent.shiftKey)); }
          })),
          h("td", { className: "rebirth-tag-name-cell" },
            h("div", { className: "rebirth-tag-name-row" },
              tag.image_path ? h("img", { className: "rebirth-tag-thumb", src: tag.image_path, alt: "", loading: "lazy" }) : null,
              tagLink("/tags/" + encodeURIComponent(String(tag.id)), "rebirth-tag-name", tag.name || "Untitled tag"),
              h(RebirthTagFavorite, { tag: tag })),
            details),
          h("td", { className: "rebirth-tag-parents-cell" },
            parents.length ? h("div", { className: "rebirth-tag-parent-list" }, parents.map(function (parent) {
              return tagLink("/tags/" + encodeURIComponent(String(parent.id)), "rebirth-tag-parent", parent.name || "Parent tag", { key: String(parent.id) });
            })) : h("span", { className: "rebirth-tag-no-parent" }, "No parent tag")),
          h("td", { className: "rebirth-tag-scenes-cell" },
            usage),
          h("td", { className: "rebirth-tag-children-cell" },
            children.length ? tagLink(childUrl, "rebirth-tag-child-link", h(React.Fragment, null,
              h("span", { className: "rebirth-tag-cell-label" }, "Children"),
              h("span", { className: "rebirth-tag-count" }, String(children.length))),
            { "aria-label": children.length + " child tags of " + (tag.name || "tag") }) : h("span", { className: "rebirth-tag-no-children" },
              h("span", { className: "rebirth-tag-cell-label" }, "Children"), h("span", { className: "rebirth-tag-count is-empty" }, "—"))));
      });

      return h("div", { className: "rebirth-tag-directory" + (detailed ? " is-detailed" : "") },
        h("table", { className: "rebirth-tag-table" },
          h("caption", { className: "rebirth-visually-hidden" }, "Tags with parent relationships and scene counts"),
          h("thead", null, h("tr", null,
            h("th", { className: "rebirth-tag-select-heading", scope: "col" }),
            h("th", { scope: "col" }, "Tag"),
            h("th", { scope: "col" }, "Parent tags"),
            h("th", { scope: "col" }, "Usage"),
            h("th", { scope: "col", className: "rebirth-tag-numeric-heading" }, "Child tags"))),
          h("tbody", null, rows)));
    }

    function addTagBrowseControls(node) {
      if (Array.isArray(node)) { return node.map(addTagBrowseControls); }
      if (!React.isValidElement(node)) { return node; }
      var props = node.props || {};
      if (props.view === "tags" && props.filter && typeof props.setFilter === "function") {
        return h(React.Fragment, null,
          h("header", { className: "rebirth-tags-page-heading" },
            h("div", null, h("span", { className: "rebirth-tags-kicker" }, "TAG LIBRARY"), h("h1", null, "Tags"), h("p", null, "Browse parent tags, child tags, and scene usage."))),
          node,
          h(TagBrowseControls, { filter: props.filter, setFilter: props.setFilter }));
      }
      if (!Object.prototype.hasOwnProperty.call(props, "children") || props.children === null || props.children === undefined) { return node; }
      var children = React.Children.map(props.children, addTagBrowseControls);
      return React.cloneElement(node, props, children);
    }

    function routeLink(href, className, children) {
      var props = {
        className: className,
        onClick: function (event) {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            window.setTimeout(refreshTopbarContext, 0);
          }
        }
      };
      if (RouterLink) { props.to = href; return h(RouterLink, props, children); }
      props.href = href;
      return h("a", props, children);
    }

    function SceneArtwork(props) {
      return h("div", { className: "rebirth-artwork" + (props.large ? " rebirth-artwork-large" : ""), style: props.image ? { backgroundImage: "url(\"" + props.image.replace(/\"/g, "%22") + "\")" } : undefined },
        h("div", { className: "rebirth-artwork-overlay" }),
        props.duration ? h("span", { className: "rebirth-duration" }, formatDuration(props.duration)) : null,
        props.children);
    }

    function EmptyState(props) {
      return h("div", { className: "rebirth-empty-state" },
        h("span", { className: "rebirth-empty-icon", dangerouslySetInnerHTML: { __html: icon(props.icon || "scenes") } }),
        h("p", null, props.children));
    }

    function NewArrivalsCarousel(props) {
      var state = React.useState(0);
      var index = state[0];
      var setIndex = state[1];
      var scenes = props.scenes || [];
      var touchStart = React.useRef(null);
      var titleRef = React.useRef(null);
      React.useEffect(function () { if (index >= scenes.length) { setIndex(0); } }, [scenes.length, index]);
      React.useEffect(function () {
        if (scenes.length < 2) { return; }
        var timer = null;
        function stopTimer() {
          if (timer !== null) { window.clearInterval(timer); timer = null; }
        }
        function startTimer() {
          if (timer !== null || document.hidden) { return; }
          timer = window.setInterval(function () {
            setIndex(function (currentIndex) { return (currentIndex + 1) % scenes.length; });
          }, 7000);
        }
        function onVisibilityChange() {
          if (document.hidden) { stopTimer(); } else { startTimer(); }
        }
        startTimer();
        document.addEventListener("visibilitychange", onVisibilityChange);
        return function () {
          stopTimer();
          document.removeEventListener("visibilitychange", onVisibilityChange);
        };
      }, [scenes.length]);
      var currentScene = scenes[index];
      var useLayoutEffect = React.useLayoutEffect || React.useEffect;
      useLayoutEffect(function () {
        if (!currentScene || !titleRef.current) { return; }
        var titleElement = titleRef.current;
        var hero = titleElement.closest ? titleElement.closest(".rebirth-home-hero") : null;
        var frame = null;
        function updateTitle() {
          if (frame !== null) { window.cancelAnimationFrame(frame); }
          frame = window.requestAnimationFrame(function () {
            frame = null;
            fitCarouselTitle(titleElement);
          });
        }
        updateTitle();
        window.addEventListener("resize", updateTitle);
        var observer = typeof window.ResizeObserver === "function" && hero ? new window.ResizeObserver(updateTitle) : null;
        if (observer) { observer.observe(hero); }
        return function () {
          window.removeEventListener("resize", updateTitle);
          if (observer) { observer.disconnect(); }
          if (frame !== null) { window.cancelAnimationFrame(frame); }
        };
      }, [currentScene && currentScene.id, currentScene && currentScene.title]);
      if (!scenes.length) {
        return h("section", { className: "rebirth-home-hero rebirth-home-hero-empty", "aria-label": "New arrivals" },
          h("div", { className: "rebirth-hero-copy" },
            h("span", { className: "rebirth-kicker" }, "New arrivals"),
            h("h1", null, "Your next favorite starts here."),
            h("p", null, props.loading ? "Loading the latest additions to your library…" : "New scenes will appear here after they are added to your library."),
            !props.loading ? routeLink("/scenes", "rebirth-button rebirth-button-primary", "Browse scenes") : null));
      }
      var scene = currentScene;
      var metadata = [];
      if (scene.studio) { metadata.push(scene.studio); }
      if (readPreferences().newContentSort === "date") {
        if (scene.date) { metadata.push("Released " + String(scene.date).slice(0, 10)); }
      } else if (scene.createdAt) { metadata.push(formatAdded(scene.createdAt)); }
      if (scene.duration) { metadata.push(formatDuration(scene.duration)); }
      if (scene.height) { metadata.push(Math.round(scene.height) + "p"); }
      var performers = scene.performers.slice(0, 3).join(" · ");
      return h("section", {
        className: "rebirth-home-hero",
        "aria-roledescription": "carousel",
        "aria-label": "New arrivals",
        tabIndex: 0,
        onKeyDown: function (event) {
          if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((index - 1 + scenes.length) % scenes.length); }
          if (event.key === "ArrowRight") { event.preventDefault(); setIndex((index + 1) % scenes.length); }
        },
        onTouchStart: function (event) { touchStart.current = event.touches && event.touches[0] ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; },
        onTouchEnd: function (event) {
          if (touchStart.current === null || (event.target.closest && event.target.closest(".rebirth-carousel-controls"))) { touchStart.current = null; return; }
          var touchEnd = event.changedTouches && event.changedTouches[0] ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY } : touchStart.current;
          var distanceX = touchEnd.x - touchStart.current.x;
          var distanceY = touchEnd.y - touchStart.current.y;
          touchStart.current = null;
          if (Math.abs(distanceX) > 55 && Math.abs(distanceX) > Math.abs(distanceY)) { setIndex((index + (distanceX < 0 ? 1 : -1) + scenes.length) % scenes.length); }
        }
      },
        h(SceneArtwork, { image: scene.image, duration: scene.duration, large: true }),
        h("div", { className: "rebirth-hero-copy" },
          h("span", { className: "rebirth-kicker" }, "Newly added to your library"),
          h("h1", { ref: titleRef, "aria-live": "polite", title: scene.title }, scene.title),
          h("div", { className: "rebirth-hero-meta" }, metadata.join(" · ")),
          performers ? h("div", { className: "rebirth-hero-performers" }, performers) : null,
          h("div", { className: "rebirth-hero-actions" },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "rebirth-button rebirth-button-primary", h(React.Fragment, null, h("span", { className: "rebirth-play-icon", dangerouslySetInnerHTML: { __html: "<svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M8 5v14l11-7z'/></svg>" } }), "Play scene")),
            routeLink("/scenes", "rebirth-button rebirth-button-quiet", "Browse library"))),
        h("div", { className: "rebirth-carousel-controls", role: "group", "aria-label": "New arrivals controls" },
          h("button", { type: "button", className: "rebirth-carousel-arrow", "aria-label": "Previous scene", onClick: function () { setIndex((index - 1 + scenes.length) % scenes.length); } }, "‹"),
          h("div", { className: "rebirth-carousel-dots" }, scenes.map(function (item, dotIndex) {
            return h("button", { type: "button", key: item.id, className: "rebirth-carousel-dot" + (dotIndex === index ? " is-active" : ""), "aria-label": "Show " + item.title, "aria-current": dotIndex === index ? "true" : undefined, onClick: function () { setIndex(dotIndex); } }, h("span", null));
          })),
          h("span", { className: "rebirth-carousel-count", "aria-live": "polite" }, (index + 1) + " / " + scenes.length),
          h("button", { type: "button", className: "rebirth-carousel-arrow", "aria-label": "Next scene", onClick: function () { setIndex((index + 1) % scenes.length); } }, "›")));
    }

    function ContinueWatching(props) {
      return h("section", { className: "rebirth-home-section", "aria-labelledby": "rebirth-continue-heading" },
        h("div", { className: "rebirth-section-heading" },
          h("div", null, h("span", { className: "rebirth-kicker" }, "Pick up where you left off"), h("h2", { id: "rebirth-continue-heading" }, "Continue watching")),
          props.scenes && props.scenes.length ? routeLink("/scenes", "rebirth-section-link", "All scenes →") : null),
        props.scenes && props.scenes.length ? h("div", { className: "rebirth-resume-grid" }, props.scenes.map(function (scene) {
          var duration = scene.duration;
          var percent = duration > 0 ? Math.max(0, Math.min(100, Math.round(scene.resumeTime / duration * 100))) : 0;
          return h("article", { className: "rebirth-resume-card", key: scene.id },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "rebirth-resume-link",
              h(React.Fragment, null,
                h(SceneArtwork, { image: scene.image, duration: duration }),
                h("div", { className: "rebirth-progress-track", role: "progressbar", "aria-label": scene.title + " watched", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }, h("span", { style: { width: percent + "%" } })),
                h("div", { className: "rebirth-resume-title" }, scene.title),
                h("div", { className: "rebirth-resume-meta" }, "Resume at " + formatDuration(scene.resumeTime) + (duration ? " · " + formatDuration(duration) : ""))
              )));
        })) : h(EmptyState, { icon: "scenes" }, props.loading ? "Checking for saved playback…" : "Scenes you have started will appear here."));
    }

    function RebirthHome(props) {
      var state = React.useState({ arrivals: [], resume: [], loading: true });
      var data = state[0];
      var setData = state[1];
      React.useEffect(function () {
        var active = true;
        var requestId = 0;
        var controller = new AbortController();
        function load() {
          if (controller) { controller.abort(); }
          requestId += 1;
          var currentRequest = requestId;
          controller = new AbortController();
          setData(function (old) { return Object.assign({}, old, { loading: true }); });
          var newContentSort = readPreferences().newContentSort;
          var sort = newContentSort === "date" ? "date" : "created_at";
          var query = newContentSort === "random"
            ? "query RebirthHome { " +
              "newArrivals: findScenes(filter: { per_page: 1, sort: \"created_at\", direction: DESC }) { count } " +
              "continueWatching: findScenes(scene_filter: { resume_time: { value: 0, modifier: GREATER_THAN } }, filter: { per_page: 8, sort: \"last_played_at\", direction: DESC }) { scenes { id title date created_at resume_time studio { name } performers { name } files { basename duration height } paths { screenshot } } } }"
            : "query RebirthHome { " +
              "newArrivals: findScenes(filter: { per_page: 7, sort: \"" + sort + "\", direction: DESC }) { scenes { id title date created_at resume_time studio { name } performers { name } files { basename duration height } paths { screenshot } } } " +
              "continueWatching: findScenes(scene_filter: { resume_time: { value: 0, modifier: GREATER_THAN } }, filter: { per_page: 8, sort: \"last_played_at\", direction: DESC }) { scenes { id title date created_at resume_time studio { name } performers { name } files { basename duration height } paths { screenshot } } } }";
          gql(query, controller.signal).then(function (result) {
            if (!active || currentRequest !== requestId) { return; }
            var continueWatching = (result.continueWatching && result.continueWatching.scenes || []).map(sceneView).filter(function (scene) { return scene.id; });
            if (newContentSort !== "random") {
              setData({
                arrivals: (result.newArrivals && result.newArrivals.scenes || []).map(sceneView).filter(function (scene) { return scene.id; }),
                resume: continueWatching,
                loading: false
              });
              return;
            }
            var sceneCount = Number(result.newArrivals && result.newArrivals.count || 0);
            if (!sceneCount) {
              setData({ arrivals: [], resume: continueWatching, loading: false });
              return;
            }
            var pageCount = Math.max(1, Math.ceil(sceneCount / 7));
            var page = Math.floor(Math.random() * pageCount) + 1;
            var randomQuery = "query RebirthRandomArrivals { newArrivals: findScenes(filter: { per_page: 7, page: " + page + ", sort: \"created_at\", direction: DESC }) { scenes { id title date created_at resume_time studio { name } performers { name } files { basename duration height } paths { screenshot } } } }";
            gql(randomQuery, controller.signal).then(function (randomResult) {
              if (!active || currentRequest !== requestId) { return; }
              var arrivals = (randomResult.newArrivals && randomResult.newArrivals.scenes || []).map(sceneView).filter(function (scene) { return scene.id; });
              setData({ arrivals: shuffleCarouselScenes(arrivals), resume: continueWatching, loading: false });
            }).catch(function () {
              if (active && currentRequest === requestId) { setData({ arrivals: [], resume: continueWatching, loading: false }); }
            });
          }).catch(function () {
            if (active && currentRequest === requestId) { setData({ arrivals: [], resume: [], loading: false }); }
          });
        }
        function onPreferencesChanged() { load(); }
        load();
        window.addEventListener(PREFERENCES_EVENT, onPreferencesChanged);
        return function () {
          active = false;
          requestId += 1;
          controller.abort();
          window.removeEventListener(PREFERENCES_EVENT, onPreferencesChanged);
        };
      }, []);
      return h("div", { className: "rebirth-home" },
        h(NewArrivalsCarousel, { scenes: data.arrivals, loading: data.loading }),
        h(ContinueWatching, { scenes: data.resume, loading: data.loading }),
        props.stockContent ? h("section", { className: "rebirth-stock-recommendations", "aria-label": "Stash recommendations" }, props.stockContent) : null);
    }

    function RebirthSettingsPage(props) {
      var embedded = Boolean(props && props.embedded);
      var state = React.useState(readPreferences());
      var preferences = state[0];
      var setState = state[1];
      React.useEffect(function () {
        function refresh(event) { setState(event.detail || readPreferences()); }
        window.addEventListener(PREFERENCES_EVENT, refresh);
        window.setTimeout(function () {
          refreshTopbarContext();
        }, 0);
        return function () { window.removeEventListener(PREFERENCES_EVENT, refresh); };
      }, []);
      function change(key, value) {
        var next = savePreferences((function () { var update = {}; update[key] = value; return update; })());
        setState(next);
        if (key === "mobileDock") {
          window.setTimeout(function () {
            var navbar = document.querySelector("nav.top-nav");
            if (navbar) { renderNavigation(navbar); }
          }, 0);
        }
      }
      function toggle(label, description, key) {
        return h("div", { className: "rebirth-setting-row", key: key },
          h("div", null, h("strong", null, label), h("p", null, description)),
          h("button", { type: "button", role: "switch", className: "rebirth-switch" + (preferences[key] ? " is-on" : ""), "aria-checked": Boolean(preferences[key]), onClick: function () { change(key, !preferences[key]); } }, h("span", null)));
      }
      var mobileChoices = [
        ["/", "Home"], ["/scenes", "Scenes"], ["/images", "Images"], ["/galleries", "Galleries"],
        ["/performers", "Performers"], ["/studios", "Studios"], ["/groups", "Groups"], ["/tags", "Tags"],
        ["/scenes/markers", "Markers"], ["/stats", "Statistics"], ["/settings", "Settings"]
      ];
      function toggleDock(href) {
        var next = preferences.mobileDock.slice();
        var index = next.indexOf(href);
        if (index !== -1) { next.splice(index, 1); }
        else if (next.length < 3) { next.push(href); }
        change("mobileDock", next);
      }
      var cardStyles = [["cinematic", "Cinematic", "Wide artwork with a clean metadata panel."], ["compact", "Compact", "More titles in a tighter library grid."], ["poster", "Poster", "Tall artwork for a poster wall." ]];
      return h("main", { className: "rebirth-settings-page" + (embedded ? " rebirth-settings-page-embedded" : "") },
        embedded ? null : h("header", { className: "rebirth-settings-hero" },
          h("span", { className: "rebirth-brand-mark", dangerouslySetInnerHTML: { __html: REBIRTH_MARK } }),
          h("div", null, h("span", { className: "rebirth-kicker" }, "REBIRTH THEME SETTINGS"), h("h1", null, "Make Rebirth yours"), h("p", null, "Set the tone, shape navigation, and fine-tune how your library looks."))),
        h("section", { className: "rebirth-settings-card" },
          h("div", { className: "rebirth-section-heading" }, h("div", null, h("span", { className: "rebirth-kicker" }, "APPEARANCE"), h("h2", null, "Color and mode"))),
          h("div", { className: "rebirth-setting-row" },
            h("div", null, h("strong", null, "Color mode"), h("p", null, "Choose light, dark, or follow your device setting.")),
            h("select", { className: "rebirth-select", value: preferences.mode, onChange: function (event) { change("mode", event.target.value); } },
              h("option", { value: "system" }, "System"), h("option", { value: "dark" }, "Dark"), h("option", { value: "light" }, "Light"))),
          h("div", { className: "rebirth-setting-row rebirth-accent-row" },
            h("div", null, h("strong", null, "Accent color"), h("p", null, "Used for active states, controls, and playback progress.")),
            h("div", { className: "rebirth-accent-swatches", role: "group", "aria-label": "Accent color" }, ACCENTS.map(function (accent) {
              return h("button", { type: "button", key: accent.id, className: "rebirth-accent-swatch" + (preferences.accent === accent.id ? " is-selected" : ""), style: { backgroundColor: accent.color }, title: accent.label, "aria-label": accent.label, "aria-pressed": preferences.accent === accent.id, onClick: function () { change("accent", accent.id); } });
            }))),
          toggle("Reduce visual effects", "Reduce transitions and motion on this device.", "reduceEffects")),
        h("section", { className: "rebirth-settings-card" },
          h("div", { className: "rebirth-section-heading" }, h("div", null, h("span", { className: "rebirth-kicker" }, "CARDS"), h("h2", null, "Library card appearance"), h("p", null, "Choose a layout for Stash scene cards."))),
          h("div", { className: "rebirth-card-style-grid" }, cardStyles.map(function (style) {
            return h("button", { type: "button", key: style[0], className: "rebirth-card-style-option" + (preferences.cardStyle === style[0] ? " is-selected" : ""), "aria-pressed": preferences.cardStyle === style[0], onClick: function () { change("cardStyle", style[0]); } },
              h("span", { className: "rebirth-card-style-preview " + style[0] }, h("i", null), h("i", null), h("i", null)),
              h("strong", null, style[1]), h("small", null, style[2]));
          })),
          h("div", { className: "rebirth-setting-row rebirth-mobile-scene-columns-row" },
            h("div", null, h("strong", null, "Scene columns on mobile"), h("p", null, "Choose a single column or keep two columns on phone screens.")),
            h("select", { className: "rebirth-select", value: preferences.mobileSceneColumns, onChange: function (event) { change("mobileSceneColumns", event.target.value); } },
              h("option", { value: "two" }, "Two columns"), h("option", { value: "one" }, "One column")))),
        h("section", { className: "rebirth-settings-card" },
          h("div", { className: "rebirth-section-heading" }, h("div", null, h("span", { className: "rebirth-kicker" }, "HOMEPAGE"), h("h2", null, "Featured content"))),
          h("div", { className: "rebirth-setting-row" },
            h("div", null, h("strong", null, "Carousel scenes"), h("p", null, "Choose which scenes appear in the home carousel.")),
            h("select", { className: "rebirth-select", value: preferences.newContentSort, onChange: function (event) { change("newContentSort", event.target.value); } },
              h("option", { value: "created_at" }, "Recently added"), h("option", { value: "date" }, "Recently released"), h("option", { value: "random" }, "Random")))),
        h("section", { className: "rebirth-settings-card" },
          h("div", { className: "rebirth-section-heading" }, h("div", null, h("span", { className: "rebirth-kicker" }, "NAVIGATION"), h("h2", null, "Shape your navigation"), h("p", null, "Choose how Rebirth routes appear on desktop and mobile."))),
          toggle("Start with a compact desktop rail", "Show navigation labels only when the rail is expanded.", "sidebarCollapsed"),
          h("div", { className: "rebirth-setting-row rebirth-mobile-choice-row" },
            h("div", null, h("strong", null, "Mobile dock"), h("p", null, "Choose up to three destinations; the fixed fourth button opens all remaining pages.")),
            h("span", { className: "rebirth-selection-count" }, preferences.mobileDock.length + " of 3")),
          h("div", { className: "rebirth-mobile-choice-grid" }, mobileChoices.map(function (choice) {
            var selected = preferences.mobileDock.indexOf(choice[0]) !== -1;
            return h("button", { type: "button", key: choice[0], className: "rebirth-choice-chip" + (selected ? " is-selected" : ""), "aria-pressed": selected, disabled: !selected && preferences.mobileDock.length >= 3, onClick: function () { toggleDock(choice[0]); } }, choice[1]);
          }))),
        h("section", { className: "rebirth-settings-card" },
          h("div", { className: "rebirth-section-heading" }, h("div", null, h("span", { className: "rebirth-kicker" }, "PLAYBACK"), h("h2", null, "Playback preferences"), h("p", null, "Player behavior remains controlled by Stash."))),
          h("div", { className: "rebirth-playback-note" }, h("p", null, "Rebirth uses Stash’s built-in player and resume position, so autoplay, playlist continuation, and playback controls stay in sync with the server’s native preferences."))),
        h("p", { className: "rebirth-settings-note" }, "Appearance preferences control Rebirth’s visual style and navigation. Library records, playback, and settings continue to use Stash’s native features."));
    }

    var interfaceSettingsRoot = null;
    var interfaceSettingsHost = null;
    var interfaceSettingsRendered = false;
    mountRebirthThemeSettingsInInterface = function () {
      var interfacePanel = document.querySelector("#configuration-tabs-tabpane-interface");
      if (!interfacePanel) { return; }
      var section = interfacePanel.querySelector(":scope > .rebirth-settings-section");
      if (!section) {
        section = document.createElement("section");
        section.className = "setting-section rebirth-settings-section";
        var title = document.createElement("h1");
        title.textContent = "Theme Settings";
        var host = document.createElement("div");
        host.className = "rebirth-settings-host";
        section.appendChild(title);
        section.appendChild(host);
        var basicSection = Array.prototype.slice.call(interfacePanel.querySelectorAll(":scope > .setting-section")).filter(function (item) {
          var heading = item.querySelector(":scope > h1");
          return heading && (heading.textContent || "").replace(/\s+/g, " ").trim() === "Basic Settings";
        })[0];
        if (basicSection && basicSection.parentNode === interfacePanel) {
          interfacePanel.insertBefore(section, basicSection.nextSibling);
        } else {
          interfacePanel.appendChild(section);
        }
      }
      var host = section.querySelector(".rebirth-settings-host");
      if (!host) { return; }
      if (interfaceSettingsHost !== host) {
        if (interfaceSettingsRoot && typeof interfaceSettingsRoot.unmount === "function") { interfaceSettingsRoot.unmount(); }
        else if (interfaceSettingsHost && PluginApi.ReactDOM && PluginApi.ReactDOM.unmountComponentAtNode) {
          PluginApi.ReactDOM.unmountComponentAtNode(interfaceSettingsHost);
        }
        interfaceSettingsHost = host;
        interfaceSettingsRoot = PluginApi.ReactDOMClient && PluginApi.ReactDOMClient.createRoot
          ? PluginApi.ReactDOMClient.createRoot(host)
          : null;
        interfaceSettingsRendered = false;
      }
      if (interfaceSettingsRendered && host.querySelector(".rebirth-settings-page")) { return; }
      var settingsElement = h(RebirthSettingsPage, { embedded: true });
      if (interfaceSettingsRoot) { interfaceSettingsRoot.render(settingsElement); }
      else if (PluginApi.ReactDOM && PluginApi.ReactDOM.render) { PluginApi.ReactDOM.render(settingsElement, host); }
      interfaceSettingsRendered = true;
    };

    if (PluginApi.patch && PluginApi.patch.after) {
      PluginApi.patch.after("TagList", function () {
        var args = Array.prototype.slice.call(arguments);
        var props = args[0] || {};
        var stockContent = args[args.length - 1];
        if (props && props.filter && Number(props.filter.displayMode) === 3) { return stockContent; }
        return h(RebirthTagDirectory, props);
      });
      PluginApi.patch.after("FilteredTagList", function () {
        var args = Array.prototype.slice.call(arguments);
        return addTagBrowseControls(args[args.length - 1]);
      });
      PluginApi.patch.after("FrontPage", function () {
        var args = Array.prototype.slice.call(arguments);
        var stockContent = args[args.length - 1];
        var className = stockContent && stockContent.props && stockContent.props.className || "";
        var componentName = stockContent && stockContent.type &&
          (stockContent.type.displayName || stockContent.type.name) || "";
        if (className.indexOf("recommendations-container-edit") !== -1 ||
            componentName === "FrontPageConfig" || componentName === "LoadingIndicator") { return stockContent; }
        return h(RebirthHome, { stockContent: stockContent });
      });
    }
  }

  function install(PluginApi) {
    if (!PluginApi || !PluginApi.React) { return false; }
    activePluginApi = PluginApi;
    try { buildPlugin(PluginApi); }
    catch (error) { return false; }
    applyPreferences(readPreferences());
    var attempts = 0;
    var observer = null;
    var bodyObserver = null;
    var pageObserver = null;
    var timer = null;
    var performerFilterSidebarRoute = "";
    var performerFilterSidebarClosedForRoute = false;
    function closePerformerFilterSidebarByDefault() {
      var path = window.location.pathname;
      if (path !== performerFilterSidebarRoute) {
        performerFilterSidebarRoute = path;
        performerFilterSidebarClosedForRoute = false;
      }
      if (path !== "/performers" || performerFilterSidebarClosedForRoute) { return; }
      var container = document.querySelector(".item-list-container.gallery-list");
      if (!container) { return; }
      var pane = container.querySelector(".sidebar-pane");
      if (!pane) { return; }

      if (pane.classList.contains("hide-sidebar")) {
        performerFilterSidebarClosedForRoute = true;
        return;
      }

      var toggle = pane.querySelector(".sidebar-toggle-button");
      if (!toggle) { return; }
      toggle.click();
      performerFilterSidebarClosedForRoute = true;
    }
    function sync() {
      var navbar = document.querySelector("nav.top-nav");
      if (!navbar) { return false; }
      closePerformerFilterSidebarByDefault();
      installTopbarBrand(navbar);
      installTopbarContext(navbar);
      removeTopbarThemeToggle(navbar);
      hideTopbarHelp(navbar);
      renderNavigation(navbar);
      mountRebirthStatistics();
      syncRebirthRangeControls();
      enhanceNativeSettings();
      if (!observer) {
        observer = new MutationObserver(function () {
          removeTopbarThemeToggle(navbar);
          hideTopbarHelp(navbar);
          renderNavigation(navbar);
        });
        observer.observe(navbar, { childList: true, subtree: true });
      }
      return true;
    }
    function activate() {
      if (!sync()) { return false; }
      if (timer) { window.clearInterval(timer); }
      if (bodyObserver) { bodyObserver.disconnect(); }
      return true;
    }
    timer = window.setInterval(function () {
      attempts += 1;
      if (activate() || attempts > 80) { window.clearInterval(timer); }
    }, 250);
    if (document.body) {
      bodyObserver = new MutationObserver(activate);
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      pageObserver = new MutationObserver(function () {
        closePerformerFilterSidebarByDefault();
        syncRebirthRangeControls();
        enhanceNativeSettings();
        if (window.location.pathname === "/stats") { window.setTimeout(mountRebirthStatistics, 100); }
      });
      pageObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState !== "loading") { activate(); }
    else { document.addEventListener("DOMContentLoaded", activate, { once: true }); }
    window.addEventListener("popstate", updateActiveNavigation);
    window.addEventListener("popstate", refreshTopbarContext);
    window.addEventListener("popstate", mountRebirthStatistics);
    window.addEventListener("popstate", enhanceNativeSettings);
    if (window.matchMedia) {
      var modeQuery = window.matchMedia("(prefers-color-scheme: light)");
      modeQuery.addEventListener ? modeQuery.addEventListener("change", function () { if (readPreferences().mode === "system") { applyPreferences(readPreferences()); } }) : modeQuery.addListener(function () { if (readPreferences().mode === "system") { applyPreferences(readPreferences()); } });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { openMobileDrawer(false); closePluginFlyout(true); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        var search = document.querySelector(".rebirth-global-search-input");
        if (search) { event.preventDefault(); search.focus(); }
      }
    });
    document.addEventListener("input", function (event) { updateRebirthRangeProgress(event.target); });
    document.addEventListener("change", function (event) { updateRebirthRangeProgress(event.target); });
    applyPreferences(readPreferences());
    syncUserPreferences();
    return true;
  }

  function waitForPluginApi() {
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (install(window.PluginApi) || attempts > 80) { window.clearInterval(timer); }
    }, 100);
    if (window.PluginApi) { install(window.PluginApi); window.clearInterval(timer); }
  }

  waitForPluginApi();
})();
