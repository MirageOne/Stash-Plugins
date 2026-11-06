(function () {
  "use strict";

  var PREFERENCES_KEY = "current-theme.preferences.v1";
  var PREFERENCES_EVENT = "current-theme:preferences-changed";
  var PREFERENCE_OWNER_KEY = "current-theme.preferences.owner.v1";
  var PLUGIN_ID = "current-theme";
  var ACCOUNT_PREFERENCES_KEY = "accountPreferences";
  var mountCurrentThemeSettingsInInterface = null;
  var activePluginApi = null;
  var activeAccountId = null;
  var accountPreferencesSync = null;
  var accountPreferenceWrites = Promise.resolve();
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
    { id: "teal", label: "Teal", color: "#42d7c2" },
    { id: "blue", label: "Blue", color: "#6ea8fe" },
    { id: "violet", label: "Violet", color: "#a88bfa" },
    { id: "coral", label: "Coral", color: "#ff927a" },
    { id: "amber", label: "Amber", color: "#f1c46d" },
    { id: "rose", label: "Rose", color: "#f18bb6" },
    { id: "green", label: "Green", color: "#83d79d" }
  ];
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
    if (!ACCENTS.some(function (accent) { return accent.id === merged.accent; })) {
      merged.accent = DEFAULT_PREFERENCES.accent;
    }
    if (merged.newContentSort !== "date") { merged.newContentSort = "created_at"; }
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
      preferences = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || "{}");
    } catch (error) {
      preferences = {};
    }
    return normalizePreferences(preferences);
  }

  function writeLocalPreferences(preferences, accountId) {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      if (accountId !== undefined && accountId !== null) {
        window.localStorage.setItem(PREFERENCE_OWNER_KEY, String(accountId));
      }
    } catch (error) { /* The current page still works when browser storage is unavailable. */ }
  }

  function preferenceOwner() {
    try { return window.localStorage.getItem(PREFERENCE_OWNER_KEY); }
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
      if (!response.ok) { throw new Error("Stash preference request failed"); }
      return response.json();
    }).then(function (result) {
      if (result && result.errors && result.errors.length) { throw new Error("Stash preference request returned errors"); }
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
    var query = "query CurrentThemeSignedInAccount { " + field + " { id } }";
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
    var schemaQuery = "query CurrentThemeAccountSchema { __schema { queryType { fields { name args { name defaultValue type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } } } }";
    return graphQLRequest(schemaQuery).then(function (data) {
      var fields = data && data.__schema && data.__schema.queryType && data.__schema.queryType.fields;
      return tryAccountIdentityFields(accountIdentityFields(fields), 0);
    }).catch(function () {
      return tryAccountIdentityFields(["me", "currentUser", "current_user", "authenticatedUser", "viewer", "user"], 0);
    });
  }

  function loadCurrentThemeServerSettings() {
    var query = "query CurrentThemeServerPreferences { configuration { plugins(include: [\"current-theme\"]) } }";
    return graphQLRequest(query).then(function (data) {
      var plugins = data && data.configuration && data.configuration.plugins;
      return plugins && plugins[PLUGIN_ID] && typeof plugins[PLUGIN_ID] === "object" ? plugins[PLUGIN_ID] : {};
    });
  }

  function saveCurrentThemeServerSettings(settings) {
    if (activePluginApi && typeof activePluginApi.configurePlugin === "function") {
      return Promise.resolve(activePluginApi.configurePlugin(PLUGIN_ID, settings)).then(function (result) {
        if (result === false) { throw new Error("Stash declined to save Current Theme preferences"); }
        return true;
      });
    }
    if (activePluginApi && activePluginApi.GQL && typeof activePluginApi.GQL.mutate === "function") {
      var mutation = "mutation CurrentThemeConfigurePreferences($pluginId: ID!, $settings: Map!) { configurePlugin(plugin_id: $pluginId, input: $settings) }";
      return Promise.resolve(activePluginApi.GQL.mutate(mutation, { pluginId: PLUGIN_ID, settings: settings })).then(function (result) {
        if (result === false || result && result.data && result.data.configurePlugin === false) {
          throw new Error("Stash declined to save Current Theme preferences");
        }
        return true;
      });
    }
    return Promise.reject(new Error("Stash plugin settings are not writable in this session"));
  }

  function queueAccountPreferenceSave(accountId, preferences) {
    var snapshot = normalizePreferences(preferences);
    accountPreferenceWrites = accountPreferenceWrites.catch(function () {}).then(function () {
      return loadCurrentThemeServerSettings().then(function (settings) {
        var accounts = settings[ACCOUNT_PREFERENCES_KEY] && typeof settings[ACCOUNT_PREFERENCES_KEY] === "object"
          ? Object.assign({}, settings[ACCOUNT_PREFERENCES_KEY]) : {};
        accounts[String(accountId)] = snapshot;
        var nextSettings = Object.assign({}, settings);
        nextSettings[ACCOUNT_PREFERENCES_KEY] = accounts;
        return saveCurrentThemeServerSettings(nextSettings);
      });
    }).catch(function () { /* Keep browser preferences usable if server persistence is unavailable. */ });
    return accountPreferenceWrites;
  }

  function syncAccountPreferences() {
    if (accountPreferencesSync) { return accountPreferencesSync; }
    var revisionAtStart = preferenceRevision;
    var browserPreferences = readPreferences();
    var browserOwner = preferenceOwner();
    accountPreferencesSync = resolveSignedInAccountId().then(function (accountId) {
      if (!accountId) { return null; }
      return loadCurrentThemeServerSettings().then(function (settings) {
        activeAccountId = String(accountId);
        var accounts = settings[ACCOUNT_PREFERENCES_KEY];
        var stored = accounts && typeof accounts === "object" ? accounts[activeAccountId] : null;
        var hasAccountPreferences = stored && typeof stored === "object" && !Array.isArray(stored);
        var preferences;
        if (hasAccountPreferences) {
          preferences = normalizePreferences(stored);
        } else if (!browserOwner || browserOwner === activeAccountId) {
          preferences = browserPreferences;
        } else {
          preferences = normalizePreferences(DEFAULT_PREFERENCES);
        }
        if (preferenceRevision !== revisionAtStart) {
          preferences = normalizePreferences(Object.assign({}, preferences, pendingAccountPreferenceChanges));
          pendingAccountPreferenceChanges = {};
        }
        writeLocalPreferences(preferences, activeAccountId);
        publishPreferences(preferences);
        if (!hasAccountPreferences || preferenceRevision !== revisionAtStart) { queueAccountPreferenceSave(activeAccountId, preferences); }
        return null;
      });
    }).catch(function () { /* Unavailable account storage falls back to this browser. */ });
    return accountPreferencesSync;
  }

  function resolveMode(mode) {
    if (mode !== "system") { return mode; }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function savePreferences(preferences) {
    var next = normalizePreferences(Object.assign({}, readPreferences(), preferences));
    preferenceRevision += 1;
    writeLocalPreferences(next, activeAccountId);
    if (activeAccountId) { queueAccountPreferenceSave(activeAccountId, next); }
    else if (accountPreferencesSync) { pendingAccountPreferenceChanges = Object.assign({}, pendingAccountPreferenceChanges, preferences); }
    publishPreferences(next);
    return next;
  }

  function applyPreferences(preferences) {
    var root = document.documentElement;
    root.setAttribute("data-current-theme", "active");
    var mode = resolveMode(preferences.mode);
    root.setAttribute("data-current-mode", mode);
    root.setAttribute("data-current-accent", preferences.accent);
    root.setAttribute("data-current-card-style", preferences.cardStyle);
    root.setAttribute("data-current-mobile-scene-columns", preferences.mobileSceneColumns);
    if (document.body) {
      document.body.classList.add("current-active");
      document.body.classList.toggle("current-sidebar-collapsed", preferences.sidebarCollapsed);
      document.body.classList.toggle("current-reduced-effects", preferences.reduceEffects);
    }
    updateSidebarState(preferences.sidebarCollapsed);
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.scenes) + "</svg>";
  }

  var CURRENT_MARK = '<svg viewBox="0 0 256 256" aria-hidden="true"><defs><filter id="stash-mark-black" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter></defs><rect width="256" height="256" rx="40" fill="var(--current-accent)"/><image href="/plugin/current-theme/assets/icons/stash.png" x="28" y="28" width="200" height="200" preserveAspectRatio="xMidYMid meet" filter="url(#stash-mark-black)"/></svg>';

  function installTopbarBrand(navbar) {
    if (navbar.querySelector(".current-topbar-brand")) { return true; }
    var brand = document.createElement("a");
    brand.className = "current-topbar-brand";
    brand.href = "/";
    brand.setAttribute("data-current-route", "/");
    brand.setAttribute("aria-label", "Current home");
    brand.innerHTML = '<span class="current-brand-mark">' + CURRENT_MARK + '</span><span>Current</span>';
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
    var context = document.querySelector(".current-topbar-context");
    if (!context) { return; }
    var path = window.location.pathname || "/";
    var crumb = context.querySelector(".current-breadcrumb-current");
    var label = topbarLabel(path);
    // The topbar has a MutationObserver that refreshes route state. Replacing
    // this text node when the label is already current retriggers that observer
    // forever on SPA routes such as Current's settings page.
    if (crumb && crumb.textContent !== label) { crumb.textContent = label; }
    var input = context.querySelector(".current-global-search-input");
    if (input && document.activeElement !== input) {
      input.value = path === "/scenes" ? new URLSearchParams(window.location.search).get("q") || "" : "";
    }
  }

  function installTopbarContext(navbar) {
    var context = navbar.querySelector(".current-topbar-context");
    if (!context) {
      context = document.createElement("div");
      context.className = "current-topbar-context";
      context.innerHTML = '<div class="current-breadcrumb"><a href="/" data-current-route="/">Library</a><span aria-hidden="true">/</span><strong class="current-breadcrumb-current"></strong></div><form class="current-global-search" role="search"><span class="current-search-icon">' + icon("search") + '</span><input class="current-global-search-input" type="search" aria-label="Search your library" placeholder="Search your library"><kbd>Ctrl K</kbd></form>';
      var input = context.querySelector(".current-global-search-input");
      context.querySelector(".current-global-search").addEventListener("submit", function (event) {
        event.preventDefault();
        submitGlobalSearch(input.value);
      });
      context.querySelector(".current-breadcrumb").addEventListener("click", function (event) {
        var route = event.target.closest("[data-current-route]");
        if (route) { navigateFromLink(event, route); }
      });
      navbar.insertBefore(context, navbar.querySelector(".navbar-buttons") || null);
    }
    refreshTopbarContext();
  }

  function removeTopbarThemeToggle(navbar) {
    var toggle = navbar.querySelector(".current-mode-toggle");
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
        control.classList.add("current-topbar-help-hidden");
      }
    }
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
    link.setAttribute("data-current-route", item.href);
    link.setAttribute("aria-label", item.label);
    link.title = item.label;
    link.innerHTML = '<span class="current-nav-icon">' + icon(item.icon) + "</span><span class=\"current-nav-label\"></span>";
    link.querySelector(".current-nav-label").textContent = item.label;
    return link;
  }

  function updateSidebarState(collapsed) {
    if (!document.body) { return; }
    document.body.classList.toggle("current-sidebar-collapsed", Boolean(collapsed));
    var button = document.querySelector(".current-sidebar-collapse");
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
    if (item.href === "/plugin/current-theme") { return path.indexOf(item.href) === 0; }
    if (item.href === "/scenes" && path.indexOf("/scenes/markers") === 0) { return false; }
    return path === item.href || path.indexOf(item.href + "/") === 0;
  }

  function updateActiveNavigation() {
    var path = window.location.pathname || "/";
    var search = window.location.search || "";
    var links = document.querySelectorAll("[data-current-route]");
    for (var i = 0; i < links.length; i++) {
      var active = itemIsActive({ href: links[i].getAttribute("data-current-route") }, path, search);
      links[i].classList.toggle("is-active", active);
      if (active) { links[i].setAttribute("aria-current", "page"); }
      else { links[i].removeAttribute("aria-current"); }
    }
    var mobileMore = document.querySelector(".current-mobile-more");
    if (mobileMore) {
      var isDocked = readPreferences().mobileDock.some(function (href) { return itemIsActive({ href: href }, path, search); });
      mobileMore.classList.toggle("is-active", !isDocked);
    }
  }

  function openMobileDrawer(open) {
    if (!document.body) { return; }
    document.body.classList.toggle("current-drawer-open", Boolean(open));
    var trigger = document.querySelector(".current-mobile-more");
    if (trigger) { trigger.setAttribute("aria-expanded", open ? "true" : "false"); }
  }

  function renderNavigation(navbar) {
    if (!document.body) { return false; }
    var items = collectNavigationItems(navbar);
    var primary = items;
    var sections = navigationSections(primary);
    var signature = items.map(function (item) { return item.href + ":" + item.label; }).join("|");

    var sidebar = document.querySelector(".current-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "current-sidebar";
      sidebar.setAttribute("aria-label", "Primary navigation");
      sidebar.innerHTML = '<div class="current-sidebar-brand-row"><a class="current-brand" href="/" data-current-route="/" aria-label="Current home"><span class="current-brand-mark">' + CURRENT_MARK + '</span><span class="current-brand-name">Current</span></a><button type="button" class="current-sidebar-collapse" aria-label="Collapse navigation" aria-pressed="false" title="Collapse navigation">' + icon("collapse") + "</button></div><nav class=\"current-sidebar-nav\" aria-label=\"Current sections\"><div class=\"current-sidebar-primary\"></div></nav>";
      document.body.appendChild(sidebar);
      sidebar.addEventListener("click", function (event) {
        var collapse = event.target.closest(".current-sidebar-collapse");
        if (collapse) {
          event.preventDefault();
          savePreferences({ sidebarCollapsed: !document.body.classList.contains("current-sidebar-collapsed") });
          return;
        }
        var route = event.target.closest("[data-current-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }

    if (sidebar.getAttribute("data-signature") !== signature) {
      var primaryHost = sidebar.querySelector(".current-sidebar-primary");
      primaryHost.textContent = "";
      sections.forEach(function (section) {
        var group = document.createElement("section");
        group.className = "current-nav-section";
        var heading = document.createElement("h2");
        heading.className = "current-nav-section-heading";
        heading.textContent = section.label;
        group.appendChild(heading);
        section.items.forEach(function (item) { group.appendChild(makeRouteLink(item, "current-nav-item")); });
        primaryHost.appendChild(group);
      });
      sidebar.setAttribute("data-signature", signature);
    }

    var dock = document.querySelector(".current-mobile-dock");
    if (!dock) {
      dock = document.createElement("nav");
      dock.className = "current-mobile-dock";
      dock.setAttribute("aria-label", "Quick navigation");
      document.body.appendChild(dock);
      dock.addEventListener("click", function (event) {
        var more = event.target.closest(".current-mobile-more");
        if (more) { event.preventDefault(); openMobileDrawer(!document.body.classList.contains("current-drawer-open")); return; }
        var route = event.target.closest("[data-current-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    var mobileDock = readPreferences().mobileDock;
    var dockSignature = signature + "|" + mobileDock.join(",");
    if (dock.getAttribute("data-dock-preferences") !== dockSignature) {
      dock.textContent = "";
      mobileDock.map(function (href) { return primary.filter(function (item) { return item.href === href; })[0]; }).filter(Boolean).forEach(function (item) { dock.appendChild(makeRouteLink(item, "current-dock-item")); });
      var moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "current-dock-item current-mobile-more";
      moreButton.setAttribute("aria-label", "Open menu for remaining pages");
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.innerHTML = '<span class="current-nav-icon">' + icon("menu") + '</span><span class="current-nav-label">More</span>';
      dock.appendChild(moreButton);
      dock.setAttribute("data-dock-preferences", dockSignature);
    }

    var drawer = document.querySelector(".current-mobile-drawer");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "current-mobile-drawer";
      drawer.setAttribute("aria-label", "More pages");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", function (event) {
        if (event.target === drawer) { openMobileDrawer(false); return; }
        var route = event.target.closest("[data-current-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    var drawerSignature = signature + "|" + mobileDock.join(",");
    if (drawer.getAttribute("data-signature") !== drawerSignature) {
      drawer.textContent = "";
      var sheet = document.createElement("section");
      sheet.className = "current-mobile-sheet";
      var sheetHeading = document.createElement("div");
      sheetHeading.className = "current-mobile-sheet-heading";
      sheetHeading.innerHTML = "<strong>More pages</strong>";
      var close = document.createElement("button");
      close.type = "button";
      close.className = "current-mobile-close";
      close.setAttribute("aria-label", "Close navigation");
      close.textContent = "×";
      close.addEventListener("click", function () { openMobileDrawer(false); });
      sheetHeading.appendChild(close);
      sheet.appendChild(sheetHeading);
      navigationSections(primary.filter(function (item) { return mobileDock.indexOf(item.href) === -1; })).forEach(function (section) {
        var group = document.createElement("section");
        group.className = "current-mobile-nav-section";
        var heading = document.createElement("h3");
        heading.className = "current-mobile-nav-section-heading";
        heading.textContent = section.label;
        group.appendChild(heading);
        section.items.forEach(function (item) { group.appendChild(makeRouteLink(item, "current-mobile-sheet-link")); });
        sheet.appendChild(group);
      });
      drawer.appendChild(sheet);
      drawer.setAttribute("data-signature", drawerSignature);
    }

    document.body.classList.add("current-active");
    applyPreferences(readPreferences());
    updateActiveNavigation();
    refreshTopbarContext();
    return true;
  }

  function navigateFromLink(event, link) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
    var href = link.getAttribute("data-current-route");
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
      settingsLayout.classList.add("current-settings-layout");
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
    if (nav.getAttribute("data-current-settings-bound") !== "true") {
      nav.setAttribute("data-current-settings-bound", "true");
      nav.addEventListener("click", function (event) {
        var link = event.target.closest("a[href]");
        if (link && nav.contains(link)) { window.setTimeout(enhanceNativeSettings, 0); }
      });
    }
    links.forEach(function (link) {
      var item = link.closest(".nav-item");
      if (item) { item.classList.add("current-settings-link-item"); }
    });
    var picker = menu.querySelector(".current-settings-section-picker");
    if (!picker) {
      var pickerLabel = document.createElement("label");
      pickerLabel.className = "current-settings-section-label";
      pickerLabel.textContent = "Settings section";
      picker = document.createElement("select");
      picker.className = "current-settings-section-picker";
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
      Array.prototype.forEach.call(activePanel.querySelectorAll(".current-settings-plugin-list"), function (list) {
        if (list !== pluginList) { list.classList.remove("current-settings-plugin-list"); }
      });
      if (pluginList && !pluginList.classList.contains("current-settings-plugin-list")) {
        pluginList.classList.add("current-settings-plugin-list");
      }
    }
    if (mountCurrentThemeSettingsInInterface) { mountCurrentThemeSettingsInInterface(); }
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

  var statisticsScenesPromise = null;
  function loadStatisticsScenes() {
    if (statisticsScenesPromise) { return statisticsScenesPromise; }
    statisticsScenesPromise = (function () {
      var results = [];
      function loadPage(page) {
        var query = "query CurrentStatistics { findScenes(filter: { per_page: 100, page: " + page + ", sort: \"date\", direction: DESC }) { scenes { date files { height } } } }";
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
      chart.appendChild(makeSvgElement("text", { x: "320", y: "100", "text-anchor": "middle", class: "current-chart-empty" }, "No dated scenes yet"));
      return chart;
    }
    var max = Math.max.apply(Math, years.map(function (year) { return counts[year]; }));
    [0, 0.5, 1].forEach(function (fraction) {
      var y = 145 - fraction * 112;
      chart.appendChild(makeSvgElement("line", { x1: "38", x2: "626", y1: y, y2: y, class: "current-chart-grid" }));
      chart.appendChild(makeSvgElement("text", { x: "29", y: y + 4, "text-anchor": "end", class: "current-chart-axis" }, String(Math.round(max * fraction))));
    });
    var step = 588 / years.length;
    years.forEach(function (year, index) {
      var value = counts[year];
      var height = Math.max(3, value / max * 112);
      var x = 46 + index * step + step * .22;
      var width = step * .56;
      chart.appendChild(makeSvgElement("rect", { x: x, y: 145 - height, width: width, height: height, rx: "3", class: "current-chart-bar" }));
      chart.appendChild(makeSvgElement("text", { x: x + width / 2, y: 163, "text-anchor": "middle", class: "current-chart-axis" }, year));
      chart.appendChild(makeSvgElement("text", { x: x + width / 2, y: 145 - height - 7, "text-anchor": "middle", class: "current-chart-value" }, String(value)));
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
    chart.className = "current-resolution-rows";
    order.forEach(function (bin) {
      var row = document.createElement("div");
      row.className = "current-resolution-row";
      var label = document.createElement("span");
      label.className = "current-resolution-label";
      label.textContent = bin.label;
      var track = document.createElement("span");
      track.className = "current-resolution-track";
      var fill = document.createElement("span");
      fill.style.width = (total ? bin.count / total * 100 : 0) + "%";
      track.appendChild(fill);
      var value = document.createElement("span");
      value.className = "current-resolution-value";
      value.textContent = bin.count + " (" + (total ? (bin.count / total * 100).toFixed(1) : "0.0") + "%)";
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      chart.appendChild(row);
    });
    return chart;
  }

  function mountCurrentStatistics() {
    if (window.location.pathname !== "/stats") { return; }
    var main = document.querySelector(".main.container-fluid");
    var root = main && main.querySelector(".mt-5");
    if (!root || root.querySelector(".current-stats-insights")) { return; }
    loadStatisticsScenes().then(function (scenes) {
      if (window.location.pathname !== "/stats" || !root.isConnected || root.querySelector(".current-stats-insights")) { return; }
      var section = document.createElement("section");
      section.className = "current-stats-insights";
      var yearPanel = document.createElement("article");
      yearPanel.className = "current-stats-panel current-years-panel";
      var yearHeading = document.createElement("div");
      yearHeading.className = "current-stats-panel-heading";
      yearHeading.innerHTML = "<h2>Scenes by year</h2><span>Scene release dates in your library</span>";
      yearPanel.appendChild(yearHeading);
      yearPanel.appendChild(makeYearChart(scenes));
      var resolutionPanel = document.createElement("article");
      resolutionPanel.className = "current-stats-panel current-resolution-panel";
      var resolutionHeading = document.createElement("div");
      resolutionHeading.className = "current-stats-panel-heading";
      resolutionHeading.innerHTML = "<h2>Media resolution</h2><span>Highest file resolution per scene</span>";
      resolutionPanel.appendChild(resolutionHeading);
      resolutionPanel.appendChild(makeResolutionChart(scenes));
      section.appendChild(yearPanel);
      section.appendChild(resolutionPanel);
      root.appendChild(section);
    });
  }

  function updateCurrentRangeProgress(range) {
    if (!range || !range.matches || !range.matches(".zoom-slider")) { return; }
    var minimum = Number(range.min || 0);
    var maximum = Number(range.max || 100);
    var value = Number(range.value || 0);
    var progress = maximum > minimum ? Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100)) : 0;
    range.style.setProperty("--current-range-progress", progress + "%");
  }

  function syncCurrentRangeControls() {
    var ranges = document.querySelectorAll(".item-list-container .filtered-list-toolbar .zoom-slider");
    for (var i = 0; i < ranges.length; i++) { updateCurrentRangeProgress(ranges[i]); }
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
      return h("div", { className: "current-artwork" + (props.large ? " current-artwork-large" : ""), style: props.image ? { backgroundImage: "url(\"" + props.image.replace(/\"/g, "%22") + "\")" } : undefined },
        h("div", { className: "current-artwork-overlay" }),
        props.duration ? h("span", { className: "current-duration" }, formatDuration(props.duration)) : null,
        props.children);
    }

    function EmptyState(props) {
      return h("div", { className: "current-empty-state" },
        h("span", { className: "current-empty-icon", dangerouslySetInnerHTML: { __html: icon(props.icon || "scenes") } }),
        h("p", null, props.children));
    }

    function NewArrivalsCarousel(props) {
      var state = React.useState(0);
      var index = state[0];
      var setIndex = state[1];
      var scenes = props.scenes || [];
      var touchStart = React.useRef(null);
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
      if (!scenes.length) {
        return h("section", { className: "current-home-hero current-home-hero-empty", "aria-label": "New arrivals" },
          h("div", { className: "current-hero-copy" },
            h("span", { className: "current-kicker" }, "New arrivals"),
            h("h1", null, "Your next favorite starts here."),
            h("p", null, props.loading ? "Loading the latest additions to your library…" : "New scenes will appear here after they are added to your library."),
            !props.loading ? routeLink("/scenes", "current-button current-button-primary", "Browse scenes") : null));
      }
      var scene = scenes[index];
      var metadata = [];
      if (scene.studio) { metadata.push(scene.studio); }
      if (readPreferences().newContentSort === "date") {
        if (scene.date) { metadata.push("Released " + String(scene.date).slice(0, 10)); }
      } else if (scene.createdAt) { metadata.push(formatAdded(scene.createdAt)); }
      if (scene.duration) { metadata.push(formatDuration(scene.duration)); }
      if (scene.height) { metadata.push(Math.round(scene.height) + "p"); }
      var performers = scene.performers.slice(0, 3).join(" · ");
      return h("section", {
        className: "current-home-hero",
        "aria-roledescription": "carousel",
        "aria-label": "New arrivals",
        tabIndex: 0,
        onKeyDown: function (event) {
          if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((index - 1 + scenes.length) % scenes.length); }
          if (event.key === "ArrowRight") { event.preventDefault(); setIndex((index + 1) % scenes.length); }
        },
        onTouchStart: function (event) { touchStart.current = event.touches && event.touches[0] ? event.touches[0].clientX : null; },
        onTouchEnd: function (event) {
          if (touchStart.current === null || (event.target.closest && event.target.closest(".current-carousel-controls"))) { touchStart.current = null; return; }
          var touchEnd = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : touchStart.current;
          var distance = touchEnd - touchStart.current;
          touchStart.current = null;
          if (Math.abs(distance) > 55) { setIndex((index + (distance < 0 ? 1 : -1) + scenes.length) % scenes.length); }
        }
      },
        h(SceneArtwork, { image: scene.image, duration: scene.duration, large: true }),
        h("div", { className: "current-hero-copy" },
          h("span", { className: "current-kicker" }, "Newly added to your library"),
          h("h1", { "aria-live": "polite" }, scene.title),
          h("div", { className: "current-hero-meta" }, metadata.join(" · ")),
          performers ? h("div", { className: "current-hero-performers" }, performers) : null,
          h("div", { className: "current-hero-actions" },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "current-button current-button-primary", h(React.Fragment, null, h("span", { className: "current-play-icon", dangerouslySetInnerHTML: { __html: "<svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M8 5v14l11-7z'/></svg>" } }), "Play scene")),
            routeLink("/scenes", "current-button current-button-quiet", "Browse library"))),
        h("div", { className: "current-carousel-controls", role: "group", "aria-label": "New arrivals controls" },
          h("button", { type: "button", className: "current-carousel-arrow", "aria-label": "Previous scene", onClick: function () { setIndex((index - 1 + scenes.length) % scenes.length); } }, "‹"),
          h("div", { className: "current-carousel-dots" }, scenes.map(function (item, dotIndex) {
            return h("button", { type: "button", key: item.id, className: "current-carousel-dot" + (dotIndex === index ? " is-active" : ""), "aria-label": "Show " + item.title, "aria-current": dotIndex === index ? "true" : undefined, onClick: function () { setIndex(dotIndex); } }, h("span", null));
          })),
          h("span", { className: "current-carousel-count", "aria-live": "polite" }, (index + 1) + " / " + scenes.length),
          h("button", { type: "button", className: "current-carousel-arrow", "aria-label": "Next scene", onClick: function () { setIndex((index + 1) % scenes.length); } }, "›")));
    }

    function ContinueWatching(props) {
      return h("section", { className: "current-home-section", "aria-labelledby": "current-continue-heading" },
        h("div", { className: "current-section-heading" },
          h("div", null, h("span", { className: "current-kicker" }, "Pick up where you left off"), h("h2", { id: "current-continue-heading" }, "Continue watching")),
          props.scenes && props.scenes.length ? routeLink("/scenes", "current-section-link", "All scenes →") : null),
        props.scenes && props.scenes.length ? h("div", { className: "current-resume-grid" }, props.scenes.map(function (scene) {
          var duration = scene.duration;
          var percent = duration > 0 ? Math.max(0, Math.min(100, Math.round(scene.resumeTime / duration * 100))) : 0;
          return h("article", { className: "current-resume-card", key: scene.id },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "current-resume-link",
              h(React.Fragment, null,
                h(SceneArtwork, { image: scene.image, duration: duration }),
                h("div", { className: "current-progress-track", role: "progressbar", "aria-label": scene.title + " watched", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }, h("span", { style: { width: percent + "%" } })),
                h("div", { className: "current-resume-title" }, scene.title),
                h("div", { className: "current-resume-meta" }, "Resume at " + formatDuration(scene.resumeTime) + (duration ? " · " + formatDuration(duration) : ""))
              )));
        })) : h(EmptyState, { icon: "scenes" }, props.loading ? "Checking for saved playback…" : "Scenes you have started will appear here."));
    }

    function CurrentHome(props) {
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
          var sort = readPreferences().newContentSort === "date" ? "date" : "created_at";
          var query = "query CurrentHome { " +
            "newArrivals: findScenes(filter: { per_page: 7, sort: \"" + sort + "\", direction: DESC }) { scenes { id title date created_at resume_time studio { name } performers { name } files { basename duration height } paths { screenshot } } } " +
            "continueWatching: findScenes(scene_filter: { resume_time: { value: 0, modifier: GREATER_THAN } }, filter: { per_page: 8, sort: \"last_played_at\", direction: DESC }) { scenes { id title date created_at resume_time studio { name } performers { name } files { basename duration height } paths { screenshot } } } }";
          gql(query, controller.signal).then(function (result) {
            if (!active || currentRequest !== requestId) { return; }
            setData({
              arrivals: (result.newArrivals && result.newArrivals.scenes || []).map(sceneView).filter(function (scene) { return scene.id; }),
              resume: (result.continueWatching && result.continueWatching.scenes || []).map(sceneView).filter(function (scene) { return scene.id; }),
              loading: false
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
      return h("div", { className: "current-home" },
        h(NewArrivalsCarousel, { scenes: data.arrivals, loading: data.loading }),
        h(ContinueWatching, { scenes: data.resume, loading: data.loading }),
        props.stockContent ? h("section", { className: "current-stock-recommendations", "aria-label": "Stash recommendations" }, props.stockContent) : null);
    }

    function CurrentSettingsPage(props) {
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
        return h("div", { className: "current-setting-row", key: key },
          h("div", null, h("strong", null, label), h("p", null, description)),
          h("button", { type: "button", role: "switch", className: "current-switch" + (preferences[key] ? " is-on" : ""), "aria-checked": Boolean(preferences[key]), onClick: function () { change(key, !preferences[key]); } }, h("span", null)));
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
      return h("main", { className: "current-settings-page" + (embedded ? " current-settings-page-embedded" : "") },
        embedded ? null : h("header", { className: "current-settings-hero" },
          h("span", { className: "current-brand-mark", dangerouslySetInnerHTML: { __html: CURRENT_MARK } }),
          h("div", null, h("span", { className: "current-kicker" }, "CURRENT THEME SETTINGS"), h("h1", null, "Make Current yours"), h("p", null, "Set the tone, shape navigation, and fine-tune how your library looks."))),
        h("section", { className: "current-settings-card" },
          h("div", { className: "current-section-heading" }, h("div", null, h("span", { className: "current-kicker" }, "APPEARANCE"), h("h2", null, "Color and mode"))),
          h("div", { className: "current-setting-row" },
            h("div", null, h("strong", null, "Color mode"), h("p", null, "Choose light, dark, or follow your device setting.")),
            h("select", { className: "current-select", value: preferences.mode, onChange: function (event) { change("mode", event.target.value); } },
              h("option", { value: "system" }, "System"), h("option", { value: "dark" }, "Dark"), h("option", { value: "light" }, "Light"))),
          h("div", { className: "current-setting-row current-accent-row" },
            h("div", null, h("strong", null, "Accent color"), h("p", null, "Used for active states, controls, and playback progress.")),
            h("div", { className: "current-accent-swatches", role: "group", "aria-label": "Accent color" }, ACCENTS.map(function (accent) {
              return h("button", { type: "button", key: accent.id, className: "current-accent-swatch" + (preferences.accent === accent.id ? " is-selected" : ""), style: { backgroundColor: accent.color }, title: accent.label, "aria-label": accent.label, "aria-pressed": preferences.accent === accent.id, onClick: function () { change("accent", accent.id); } });
            }))),
          toggle("Reduce visual effects", "Reduce transitions and motion on this device.", "reduceEffects")),
        h("section", { className: "current-settings-card" },
          h("div", { className: "current-section-heading" }, h("div", null, h("span", { className: "current-kicker" }, "CARDS"), h("h2", null, "Library card appearance"), h("p", null, "Choose a layout for Stash scene cards."))),
          h("div", { className: "current-card-style-grid" }, cardStyles.map(function (style) {
            return h("button", { type: "button", key: style[0], className: "current-card-style-option" + (preferences.cardStyle === style[0] ? " is-selected" : ""), "aria-pressed": preferences.cardStyle === style[0], onClick: function () { change("cardStyle", style[0]); } },
              h("span", { className: "current-card-style-preview " + style[0] }, h("i", null), h("i", null), h("i", null)),
              h("strong", null, style[1]), h("small", null, style[2]));
          })),
          h("div", { className: "current-setting-row current-mobile-scene-columns-row" },
            h("div", null, h("strong", null, "Scene columns on mobile"), h("p", null, "Choose a single column or keep two columns on phone screens.")),
            h("select", { className: "current-select", value: preferences.mobileSceneColumns, onChange: function (event) { change("mobileSceneColumns", event.target.value); } },
              h("option", { value: "two" }, "Two columns"), h("option", { value: "one" }, "One column")))),
        h("section", { className: "current-settings-card" },
          h("div", { className: "current-section-heading" }, h("div", null, h("span", { className: "current-kicker" }, "HOMEPAGE"), h("h2", null, "Featured content"))),
          h("div", { className: "current-setting-row" },
            h("div", null, h("strong", null, "New content means"), h("p", null, "Choose how Current decides what counts as new.")),
            h("select", { className: "current-select", value: preferences.newContentSort === "date" ? "date" : "created_at", onChange: function (event) { change("newContentSort", event.target.value); } },
              h("option", { value: "created_at" }, "Recently added"), h("option", { value: "date" }, "Recently released")))),
        h("section", { className: "current-settings-card" },
          h("div", { className: "current-section-heading" }, h("div", null, h("span", { className: "current-kicker" }, "NAVIGATION"), h("h2", null, "Shape your navigation"), h("p", null, "Choose how Current routes appear on desktop and mobile."))),
          toggle("Start with a compact desktop rail", "Show navigation labels only when the rail is expanded.", "sidebarCollapsed"),
          h("div", { className: "current-setting-row current-mobile-choice-row" },
            h("div", null, h("strong", null, "Mobile dock"), h("p", null, "Choose up to three destinations; the fixed fourth button opens all remaining pages.")),
            h("span", { className: "current-selection-count" }, preferences.mobileDock.length + " of 3")),
          h("div", { className: "current-mobile-choice-grid" }, mobileChoices.map(function (choice) {
            var selected = preferences.mobileDock.indexOf(choice[0]) !== -1;
            return h("button", { type: "button", key: choice[0], className: "current-choice-chip" + (selected ? " is-selected" : ""), "aria-pressed": selected, disabled: !selected && preferences.mobileDock.length >= 3, onClick: function () { toggleDock(choice[0]); } }, choice[1]);
          }))),
        h("section", { className: "current-settings-card" },
          h("div", { className: "current-section-heading" }, h("div", null, h("span", { className: "current-kicker" }, "PLAYBACK"), h("h2", null, "Playback preferences"), h("p", null, "Player behavior remains controlled by Stash."))),
          h("div", { className: "current-playback-note" }, h("p", null, "Current uses Stash’s built-in player and resume position, so autoplay, playlist continuation, and playback controls stay in sync with the server’s native preferences."))),
        h("p", { className: "current-settings-note" }, "Appearance preferences control Current’s visual style and navigation. Library records, playback, and settings continue to use Stash’s native features."));
    }

    var interfaceSettingsRoot = null;
    var interfaceSettingsHost = null;
    var interfaceSettingsRendered = false;
    mountCurrentThemeSettingsInInterface = function () {
      var interfacePanel = document.querySelector("#configuration-tabs-tabpane-interface");
      if (!interfacePanel) { return; }
      var section = interfacePanel.querySelector(":scope > .current-theme-settings-section");
      if (!section) {
        section = document.createElement("section");
        section.className = "setting-section current-theme-settings-section";
        var title = document.createElement("h1");
        title.textContent = "Theme Settings";
        var host = document.createElement("div");
        host.className = "current-theme-settings-host";
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
      var host = section.querySelector(".current-theme-settings-host");
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
      if (interfaceSettingsRendered && host.querySelector(".current-settings-page")) { return; }
      var settingsElement = h(CurrentSettingsPage, { embedded: true });
      if (interfaceSettingsRoot) { interfaceSettingsRoot.render(settingsElement); }
      else if (PluginApi.ReactDOM && PluginApi.ReactDOM.render) { PluginApi.ReactDOM.render(settingsElement, host); }
      interfaceSettingsRendered = true;
    };

    if (PluginApi.patch && PluginApi.patch.after) {
      PluginApi.patch.after("FrontPage", function () {
        var args = Array.prototype.slice.call(arguments);
        var stockContent = args[args.length - 1];
        var className = stockContent && stockContent.props && stockContent.props.className || "";
        var componentName = stockContent && stockContent.type &&
          (stockContent.type.displayName || stockContent.type.name) || "";
        if (className.indexOf("recommendations-container-edit") !== -1 ||
            componentName === "FrontPageConfig" || componentName === "LoadingIndicator") { return stockContent; }
        return h(CurrentHome, { stockContent: stockContent });
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
    function sync() {
      var navbar = document.querySelector("nav.top-nav");
      if (!navbar) { return false; }
      installTopbarBrand(navbar);
      installTopbarContext(navbar);
      removeTopbarThemeToggle(navbar);
      hideTopbarHelp(navbar);
      renderNavigation(navbar);
      mountCurrentStatistics();
      syncCurrentRangeControls();
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
        syncCurrentRangeControls();
        enhanceNativeSettings();
        if (window.location.pathname === "/stats") { window.setTimeout(mountCurrentStatistics, 100); }
      });
      pageObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState !== "loading") { activate(); }
    else { document.addEventListener("DOMContentLoaded", activate, { once: true }); }
    window.addEventListener("popstate", updateActiveNavigation);
    window.addEventListener("popstate", refreshTopbarContext);
    window.addEventListener("popstate", mountCurrentStatistics);
    window.addEventListener("popstate", enhanceNativeSettings);
    if (window.matchMedia) {
      var modeQuery = window.matchMedia("(prefers-color-scheme: light)");
      modeQuery.addEventListener ? modeQuery.addEventListener("change", function () { if (readPreferences().mode === "system") { applyPreferences(readPreferences()); } }) : modeQuery.addListener(function () { if (readPreferences().mode === "system") { applyPreferences(readPreferences()); } });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { openMobileDrawer(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        var search = document.querySelector(".current-global-search-input");
        if (search) { event.preventDefault(); search.focus(); }
      }
    });
    document.addEventListener("input", function (event) { updateCurrentRangeProgress(event.target); });
    document.addEventListener("change", function (event) { updateCurrentRangeProgress(event.target); });
    applyPreferences(readPreferences());
    syncAccountPreferences();
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
