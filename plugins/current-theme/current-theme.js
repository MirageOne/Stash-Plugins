(function () {
  "use strict";

  var PLUGIN_ROUTE = "/plugin/current-theme";
  var PREFERENCES_KEY = "current-theme.preferences.v1";
  var PREFERENCES_EVENT = "current-theme:preferences-changed";
  var DEFAULT_PREFERENCES = {
    mode: "dark",
    accent: "violet",
    newContentSort: "created_at",
    sidebarCollapsed: false,
    reduceEffects: false,
    cardStyle: "cinematic",
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

  function readPreferences() {
    var preferences = {};
    try {
      preferences = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || "{}");
    } catch (error) {
      preferences = {};
    }
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
    var validDock = ["/", "/scenes", "/images", "/galleries", "/performers", "/studios", "/groups", "/tags", "/scenes/markers", "/stats", "/settings"];
    merged.mobileDock = Array.isArray(merged.mobileDock) ? merged.mobileDock.filter(function (href, index, values) {
      return validDock.indexOf(href) !== -1 && values.indexOf(href) === index;
    }).slice(0, 3) : DEFAULT_PREFERENCES.mobileDock.slice();
    return merged;
  }

  function resolveMode(mode) {
    if (mode !== "system") { return mode; }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function savePreferences(preferences) {
    var next = Object.assign({}, readPreferences(), preferences);
    try { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); }
    catch (error) { /* The current page still works when storage is unavailable. */ }
    applyPreferences(next);
    try { window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: next })); }
    catch (error) { /* Ignore browsers without CustomEvent. */ }
    return next;
  }

  function applyPreferences(preferences) {
    var root = document.documentElement;
    root.setAttribute("data-current-theme", "active");
    var mode = resolveMode(preferences.mode);
    root.setAttribute("data-current-mode", mode);
    root.setAttribute("data-current-accent", preferences.accent);
    root.setAttribute("data-current-card-style", preferences.cardStyle);
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

  var CURRENT_MARK = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4.5 11.2C9.5 4.3 18.2 3.4 25.8 8.8"/><path d="M27.5 20.8c-5 6.9-13.7 7.8-21.3 2.4"/><path d="M6.5 16h6M19.5 16h6"/><rect x="13.5" y="13.5" width="5" height="5" rx="1.5" fill="var(--current-surface)" stroke="none"/></svg>';

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
      "/plugin/current-theme": "Theme settings"
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
      item("/settings?tab=tools", "Tools", "tools"), item("/settings", "Settings", "settings"), item("/settings?tab=plugins", "Plugins", "plugins"), item("/settings?tab=about", "About", "about")
    ];
  }

  function navigationSections(items) {
    var definitions = [
      ["LIBRARY", ["/", "/scenes", "/images", "/galleries"]],
      ["PEOPLE & METADATA", ["/performers", "/studios", "/groups", "/tags", "/scenes/markers"]],
      ["ACTIVITY", ["/stats", "/settings?tab=tasks", "/settings?tab=logs"]],
      ["TOOLS", ["/settings?tab=tools"]],
      ["SYSTEM", ["/settings", "/settings?tab=plugins", "/settings?tab=about"]]
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
    var primary = items.filter(function (item) { return item.href.indexOf(PLUGIN_ROUTE) !== 0; });
    var sections = navigationSections(primary);
    var signature = items.map(function (item) { return item.href + ":" + item.label; }).join("|");

    var sidebar = document.querySelector(".current-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "current-sidebar";
      sidebar.setAttribute("aria-label", "Primary navigation");
      sidebar.innerHTML = '<div class="current-sidebar-brand-row"><a class="current-brand" href="/" data-current-route="/" aria-label="Current home"><span class="current-brand-mark">' + CURRENT_MARK + '</span><span class="current-brand-name">Current</span></a><button type="button" class="current-sidebar-collapse" aria-label="Collapse navigation" aria-pressed="false" title="Collapse navigation">' + icon("collapse") + "</button></div><nav class=\"current-sidebar-nav\" aria-label=\"Current sections\"><div class=\"current-sidebar-primary\"></div><div class=\"current-sidebar-footer\"></div></nav>";
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
      var footerHost = sidebar.querySelector(".current-sidebar-footer");
      primaryHost.textContent = "";
      footerHost.textContent = "";
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
      footerHost.appendChild(makeRouteLink({ href: PLUGIN_ROUTE, label: "Theme settings", icon: "sun" }, "current-nav-item current-theme-nav-item"));
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
      sheet.appendChild(makeRouteLink({ href: PLUGIN_ROUTE, label: "Theme settings", icon: "sun" }, "current-mobile-sheet-link current-theme-nav-item"));
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
    if (href.indexOf(PLUGIN_ROUTE) === 0) {
      var proxy = document.querySelector(".current-route-proxy");
      if (proxy) { proxy.click(); return; }
      if (window.location.pathname !== href) {
        window.history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      updateActiveNavigation();
      refreshTopbarContext();
      return;
    }
    if (window.location.pathname + window.location.search !== href) {
      window.location.assign(href);
    }
    updateActiveNavigation();
    refreshTopbarContext();
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

    function CurrentSettingsPage() {
      var state = React.useState(readPreferences());
      var preferences = state[0];
      var setState = state[1];
      React.useEffect(function () {
        function refresh(event) { setState(event.detail || readPreferences()); }
        window.addEventListener(PREFERENCES_EVENT, refresh);
        window.setTimeout(function () {
          refreshTopbarContext();
          var themeLinks = document.querySelectorAll(".current-theme-nav-item");
          for (var i = 0; i < themeLinks.length; i++) {
            themeLinks[i].classList.add("is-active");
            themeLinks[i].setAttribute("aria-current", "page");
          }
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
      return h("main", { className: "current-settings-page" },
        h("header", { className: "current-settings-hero" },
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
          }))),
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
          h("div", { className: "current-playback-note" }, h("p", null, "Current uses Stash’s built-in player and resume position, so autoplay, playlist continuation, and playback controls stay in sync with the server’s native preferences."), routeLink("/settings?tab=interface", "current-button current-button-quiet", "Open Stash playback settings"))),
        h("p", { className: "current-settings-note" }, "Current appearance preferences are saved in this browser. Library records, playback, and settings continue to use Stash’s native features."));
    }

    if (PluginApi.register && PluginApi.register.route) {
      PluginApi.register.route(PLUGIN_ROUTE, function (props) {
        return h(CurrentSettingsPage, props);
      });
    }
    if (PluginApi.patch && PluginApi.patch.instead && RouterLink) {
      PluginApi.patch.instead("MainNavBar.UtilityItems", function () {
        var args = Array.prototype.slice.call(arguments);
        var next = args.pop();
        var original = next.apply(null, args);
        return h(React.Fragment, null, original,
          h(RouterLink, { to: PLUGIN_ROUTE, className: "current-route-proxy", tabIndex: -1, "aria-hidden": "true" }, "Theme settings"));
      });
    }
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
        if (window.location.pathname === "/stats") { window.setTimeout(mountCurrentStatistics, 100); }
      });
      pageObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState !== "loading") { activate(); }
    else { document.addEventListener("DOMContentLoaded", activate, { once: true }); }
    window.addEventListener("popstate", updateActiveNavigation);
    window.addEventListener("popstate", refreshTopbarContext);
    window.addEventListener("popstate", mountCurrentStatistics);
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
