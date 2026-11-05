(function () {
  "use strict";

  var PREFERENCES_KEY = "fluent2-theme.preferences.v1";
  var PREFERENCES_EVENT = "fluent2-theme:preferences-changed";
  var mountFluent2ThemeSettingsInInterface = null;
  var DEFAULT_PREFERENCES = {
    mode: "dark",
    accent: "blue",
    newContentSort: "created_at",
    sidebarCollapsed: false,
    reduceEffects: false,
    cardStyle: "cinematic",
    mobileDock: ["/", "/scenes", "/images"]
  };
  var ACCENTS = [
    { id: "teal", label: "Teal", color: "#42d7c2" },
    { id: "blue", label: "Blue", color: "#479ef5" },
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
    root.setAttribute("data-fluent2-theme", "active");
    var mode = resolveMode(preferences.mode);
    root.setAttribute("data-fluent2-mode", mode);
    root.setAttribute("data-fluent2-accent", preferences.accent);
    root.setAttribute("data-fluent2-card-style", preferences.cardStyle);
    if (document.body) {
      document.body.classList.add("fluent2-active");
      document.body.classList.toggle("fluent2-sidebar-collapsed", preferences.sidebarCollapsed);
      document.body.classList.toggle("fluent2-reduced-effects", preferences.reduceEffects);
    }
    updateSidebarState(preferences.sidebarCollapsed);
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.scenes) + "</svg>";
  }

  var FLUENT2_MARK = '<svg viewBox="0 0 256 256" aria-hidden="true"><defs><filter id="stash-mark-fluent2-black" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter></defs><rect width="256" height="256" rx="40" fill="var(--fluent2-accent)"/><image href="/plugin/fluent2-theme/assets/icons/stash.png" x="28" y="28" width="200" height="200" preserveAspectRatio="xMidYMid meet" filter="url(#stash-mark-fluent2-black)"/></svg>';

  function installTopbarBrand(navbar) {
    if (navbar.querySelector(".fluent2-topbar-brand")) { return true; }
    var brand = document.createElement("a");
    brand.className = "fluent2-topbar-brand";
    brand.href = "/";
    brand.setAttribute("data-fluent2-route", "/");
    brand.setAttribute("aria-label", "Stash home");
    brand.innerHTML = '<span class="fluent2-brand-mark">' + FLUENT2_MARK + '</span><span>Stash</span>';
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
    var context = document.querySelector(".fluent2-topbar-context");
    if (!context) { return; }
    var path = window.location.pathname || "/";
    var crumb = context.querySelector(".fluent2-breadcrumb-current");
    var label = topbarLabel(path);
    // The topbar has a MutationObserver that refreshes route state. Replacing
    // this text node when the label is already current retriggers that observer
    // forever on SPA routes such as Fluent2's settings page.
    if (crumb && crumb.textContent !== label) { crumb.textContent = label; }
    var input = context.querySelector(".fluent2-global-search-input");
    if (input && document.activeElement !== input) {
      input.value = path === "/scenes" ? new URLSearchParams(window.location.search).get("q") || "" : "";
    }
  }

  function installTopbarContext(navbar) {
    var context = navbar.querySelector(".fluent2-topbar-context");
    if (!context) {
      context = document.createElement("div");
      context.className = "fluent2-topbar-context";
      context.innerHTML = '<div class="fluent2-breadcrumb"><a href="/" data-fluent2-route="/">Library</a><span aria-hidden="true">/</span><strong class="fluent2-breadcrumb-current"></strong></div><form class="fluent2-global-search" role="search"><span class="fluent2-search-icon">' + icon("search") + '</span><input class="fluent2-global-search-input" type="search" aria-label="Search your library" placeholder="Search your library"><kbd>Ctrl K</kbd></form>';
      var input = context.querySelector(".fluent2-global-search-input");
      context.querySelector(".fluent2-global-search").addEventListener("submit", function (event) {
        event.preventDefault();
        submitGlobalSearch(input.value);
      });
      context.querySelector(".fluent2-breadcrumb").addEventListener("click", function (event) {
        var route = event.target.closest("[data-fluent2-route]");
        if (route) { navigateFromLink(event, route); }
      });
      navbar.insertBefore(context, navbar.querySelector(".navbar-buttons") || null);
    }
    refreshTopbarContext();
  }

  function removeTopbarThemeToggle(navbar) {
    var toggle = navbar.querySelector(".fluent2-mode-toggle");
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
        control.classList.add("fluent2-topbar-help-hidden");
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
      ["", ["/"]],
      ["LIBRARY", ["/scenes", "/performers", "/studios", "/galleries", "/groups", "/images", "/tags"]],
      ["ACTIVITY", ["/scenes/markers", "/stats", "/settings?tab=tasks", "/settings?tab=logs"]],
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
    link.setAttribute("data-fluent2-route", item.href);
    link.setAttribute("aria-label", item.label);
    link.title = item.label;
    link.innerHTML = '<span class="fluent2-nav-icon">' + icon(item.icon) + "</span><span class=\"fluent2-nav-label\"></span>";
    link.querySelector(".fluent2-nav-label").textContent = item.label;
    return link;
  }

  function updateSidebarState(collapsed) {
    if (!document.body) { return; }
    document.body.classList.toggle("fluent2-sidebar-collapsed", Boolean(collapsed));
    var button = document.querySelector(".fluent2-sidebar-collapse");
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
    if (item.href === "/plugin/fluent2-theme") { return path.indexOf(item.href) === 0; }
    if (item.href === "/scenes" && path.indexOf("/scenes/markers") === 0) { return false; }
    return path === item.href || path.indexOf(item.href + "/") === 0;
  }

  function updateActiveNavigation() {
    var path = window.location.pathname || "/";
    var search = window.location.search || "";
    var links = document.querySelectorAll("[data-fluent2-route]");
    for (var i = 0; i < links.length; i++) {
      var active = itemIsActive({ href: links[i].getAttribute("data-fluent2-route") }, path, search);
      links[i].classList.toggle("is-active", active);
      if (active) { links[i].setAttribute("aria-current", "page"); }
      else { links[i].removeAttribute("aria-current"); }
    }
    var mobileMore = document.querySelector(".fluent2-mobile-more");
    if (mobileMore) {
      var isDocked = readPreferences().mobileDock.some(function (href) { return itemIsActive({ href: href }, path, search); });
      mobileMore.classList.toggle("is-active", !isDocked);
    }
  }

  function openMobileDrawer(open) {
    if (!document.body) { return; }
    document.body.classList.toggle("fluent2-drawer-open", Boolean(open));
    var trigger = document.querySelector(".fluent2-mobile-more");
    if (trigger) { trigger.setAttribute("aria-expanded", open ? "true" : "false"); }
  }

  function renderNavigation(navbar) {
    if (!document.body) { return false; }
    var items = collectNavigationItems(navbar);
    var primary = items;
    var sections = navigationSections(primary);
    var signature = items.map(function (item) { return item.href + ":" + item.label; }).join("|");

    var sidebar = document.querySelector(".fluent2-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "fluent2-sidebar";
      sidebar.setAttribute("aria-label", "Primary navigation");
      sidebar.innerHTML = '<div class="fluent2-sidebar-brand-row"><a class="fluent2-brand" href="/" data-fluent2-route="/" aria-label="Stash home"><span class="fluent2-brand-mark">' + FLUENT2_MARK + '</span><span class="fluent2-brand-name">Stash</span></a><button type="button" class="fluent2-sidebar-collapse" aria-label="Collapse navigation" aria-pressed="false" title="Collapse navigation">' + icon("collapse") + "</button></div><nav class=\"fluent2-sidebar-nav\" aria-label=\"Stash sections\"><div class=\"fluent2-sidebar-primary\"></div></nav>";
      document.body.appendChild(sidebar);
      sidebar.addEventListener("click", function (event) {
        var collapse = event.target.closest(".fluent2-sidebar-collapse");
        if (collapse) {
          event.preventDefault();
          savePreferences({ sidebarCollapsed: !document.body.classList.contains("fluent2-sidebar-collapsed") });
          return;
        }
        var route = event.target.closest("[data-fluent2-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }

    if (sidebar.getAttribute("data-signature") !== signature) {
      var primaryHost = sidebar.querySelector(".fluent2-sidebar-primary");
      primaryHost.textContent = "";
      sections.forEach(function (section) {
        var group = document.createElement("section");
        group.className = "fluent2-nav-section";
        var heading = document.createElement("h2");
        heading.className = "fluent2-nav-section-heading";
        heading.textContent = section.label;
        group.appendChild(heading);
        section.items.forEach(function (item) { group.appendChild(makeRouteLink(item, "fluent2-nav-item")); });
        primaryHost.appendChild(group);
      });
      sidebar.setAttribute("data-signature", signature);
    }

    var dock = document.querySelector(".fluent2-mobile-dock");
    if (!dock) {
      dock = document.createElement("nav");
      dock.className = "fluent2-mobile-dock";
      dock.setAttribute("aria-label", "Quick navigation");
      document.body.appendChild(dock);
      dock.addEventListener("click", function (event) {
        var more = event.target.closest(".fluent2-mobile-more");
        if (more) { event.preventDefault(); openMobileDrawer(!document.body.classList.contains("fluent2-drawer-open")); return; }
        var route = event.target.closest("[data-fluent2-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    var mobileDock = readPreferences().mobileDock;
    var dockSignature = signature + "|" + mobileDock.join(",");
    if (dock.getAttribute("data-dock-preferences") !== dockSignature) {
      dock.textContent = "";
      mobileDock.map(function (href) { return primary.filter(function (item) { return item.href === href; })[0]; }).filter(Boolean).forEach(function (item) { dock.appendChild(makeRouteLink(item, "fluent2-dock-item")); });
      var moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "fluent2-dock-item fluent2-mobile-more";
      moreButton.setAttribute("aria-label", "Open menu for remaining pages");
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.innerHTML = '<span class="fluent2-nav-icon">' + icon("menu") + '</span><span class="fluent2-nav-label">More</span>';
      dock.appendChild(moreButton);
      dock.setAttribute("data-dock-preferences", dockSignature);
    }

    var drawer = document.querySelector(".fluent2-mobile-drawer");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "fluent2-mobile-drawer";
      drawer.setAttribute("aria-label", "More pages");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", function (event) {
        if (event.target === drawer) { openMobileDrawer(false); return; }
        var route = event.target.closest("[data-fluent2-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    var drawerSignature = signature + "|" + mobileDock.join(",");
    if (drawer.getAttribute("data-signature") !== drawerSignature) {
      drawer.textContent = "";
      var sheet = document.createElement("section");
      sheet.className = "fluent2-mobile-sheet";
      var sheetHeading = document.createElement("div");
      sheetHeading.className = "fluent2-mobile-sheet-heading";
      sheetHeading.innerHTML = "<strong>More pages</strong>";
      var close = document.createElement("button");
      close.type = "button";
      close.className = "fluent2-mobile-close";
      close.setAttribute("aria-label", "Close navigation");
      close.textContent = "×";
      close.addEventListener("click", function () { openMobileDrawer(false); });
      sheetHeading.appendChild(close);
      sheet.appendChild(sheetHeading);
      navigationSections(primary.filter(function (item) { return mobileDock.indexOf(item.href) === -1; })).forEach(function (section) {
        var group = document.createElement("section");
        group.className = "fluent2-mobile-nav-section";
        var heading = document.createElement("h3");
        heading.className = "fluent2-mobile-nav-section-heading";
        heading.textContent = section.label;
        group.appendChild(heading);
        section.items.forEach(function (item) { group.appendChild(makeRouteLink(item, "fluent2-mobile-sheet-link")); });
        sheet.appendChild(group);
      });
      drawer.appendChild(sheet);
      drawer.setAttribute("data-signature", drawerSignature);
    }

    document.body.classList.add("fluent2-active");
    applyPreferences(readPreferences());
    updateActiveNavigation();
    refreshTopbarContext();
    return true;
  }

  function navigateFromLink(event, link) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
    var href = link.getAttribute("data-fluent2-route");
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
      settingsLayout.classList.add("fluent2-settings-layout");
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
    if (nav.getAttribute("data-fluent2-settings-bound") !== "true") {
      nav.setAttribute("data-fluent2-settings-bound", "true");
      nav.addEventListener("click", function (event) {
        var link = event.target.closest("a[href]");
        if (link && nav.contains(link)) { window.setTimeout(enhanceNativeSettings, 0); }
      });
    }
    links.forEach(function (link) {
      var item = link.closest(".nav-item");
      if (item) { item.classList.add("fluent2-settings-link-item"); }
    });
    var picker = menu.querySelector(".fluent2-settings-section-picker");
    if (!picker) {
      var pickerLabel = document.createElement("label");
      pickerLabel.className = "fluent2-settings-section-label";
      pickerLabel.textContent = "Settings section";
      picker = document.createElement("select");
      picker.className = "fluent2-settings-section-picker";
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
      Array.prototype.forEach.call(activePanel.querySelectorAll(".fluent2-settings-plugin-list"), function (list) {
        if (list !== pluginList) { list.classList.remove("fluent2-settings-plugin-list"); }
      });
      if (pluginList && !pluginList.classList.contains("fluent2-settings-plugin-list")) {
        pluginList.classList.add("fluent2-settings-plugin-list");
      }
    }
    if (mountFluent2ThemeSettingsInInterface) { mountFluent2ThemeSettingsInInterface(); }
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

  function formatDashboardDate(value, includeTime) {
    var timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) { return "Date not set"; }
    var options = includeTime
      ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" };
    return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
  }

  function formatFileSize(value) {
    var bytes = Number(value) || 0;
    if (bytes <= 0) { return ""; }
    var units = ["B", "KB", "MB", "GB", "TB"];
    var unit = 0;
    while (bytes >= 1000 && unit < units.length - 1) { bytes /= 1000; unit += 1; }
    return bytes.toFixed(unit > 1 ? 1 : 0) + " " + units[unit];
  }

  var statisticsScenesPromise = null;
  function loadStatisticsScenes() {
    if (statisticsScenesPromise) { return statisticsScenesPromise; }
    statisticsScenesPromise = (function () {
      var results = [];
      function loadPage(page) {
        var query = "query Fluent2Statistics { findScenes(filter: { per_page: 100, page: " + page + ", sort: \"date\", direction: DESC }) { scenes { date files { height } } } }";
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
      chart.appendChild(makeSvgElement("text", { x: "320", y: "100", "text-anchor": "middle", class: "fluent2-chart-empty" }, "No dated scenes yet"));
      return chart;
    }
    var max = Math.max.apply(Math, years.map(function (year) { return counts[year]; }));
    [0, 0.5, 1].forEach(function (fraction) {
      var y = 145 - fraction * 112;
      chart.appendChild(makeSvgElement("line", { x1: "38", x2: "626", y1: y, y2: y, class: "fluent2-chart-grid" }));
      chart.appendChild(makeSvgElement("text", { x: "29", y: y + 4, "text-anchor": "end", class: "fluent2-chart-axis" }, String(Math.round(max * fraction))));
    });
    var step = 588 / years.length;
    years.forEach(function (year, index) {
      var value = counts[year];
      var height = Math.max(3, value / max * 112);
      var x = 46 + index * step + step * .22;
      var width = step * .56;
      chart.appendChild(makeSvgElement("rect", { x: x, y: 145 - height, width: width, height: height, rx: "3", class: "fluent2-chart-bar" }));
      chart.appendChild(makeSvgElement("text", { x: x + width / 2, y: 163, "text-anchor": "middle", class: "fluent2-chart-axis" }, year));
      chart.appendChild(makeSvgElement("text", { x: x + width / 2, y: 145 - height - 7, "text-anchor": "middle", class: "fluent2-chart-value" }, String(value)));
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
    chart.className = "fluent2-resolution-rows";
    order.forEach(function (bin) {
      var row = document.createElement("div");
      row.className = "fluent2-resolution-row";
      var label = document.createElement("span");
      label.className = "fluent2-resolution-label";
      label.textContent = bin.label;
      var track = document.createElement("span");
      track.className = "fluent2-resolution-track";
      var fill = document.createElement("span");
      fill.style.width = (total ? bin.count / total * 100 : 0) + "%";
      track.appendChild(fill);
      var value = document.createElement("span");
      value.className = "fluent2-resolution-value";
      value.textContent = bin.count + " (" + (total ? (bin.count / total * 100).toFixed(1) : "0.0") + "%)";
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      chart.appendChild(row);
    });
    return chart;
  }

  function mountFluent2Statistics() {
    if (window.location.pathname !== "/stats") { return; }
    var main = document.querySelector(".main.container-fluid");
    var root = main && main.querySelector(".mt-5");
    if (!root || root.querySelector(".fluent2-stats-insights")) { return; }
    loadStatisticsScenes().then(function (scenes) {
      if (window.location.pathname !== "/stats" || !root.isConnected || root.querySelector(".fluent2-stats-insights")) { return; }
      var section = document.createElement("section");
      section.className = "fluent2-stats-insights";
      var yearPanel = document.createElement("article");
      yearPanel.className = "fluent2-stats-panel fluent2-years-panel";
      var yearHeading = document.createElement("div");
      yearHeading.className = "fluent2-stats-panel-heading";
      yearHeading.innerHTML = "<h2>Scenes by year</h2><span>Scene release dates in your library</span>";
      yearPanel.appendChild(yearHeading);
      yearPanel.appendChild(makeYearChart(scenes));
      var resolutionPanel = document.createElement("article");
      resolutionPanel.className = "fluent2-stats-panel fluent2-resolution-panel";
      var resolutionHeading = document.createElement("div");
      resolutionHeading.className = "fluent2-stats-panel-heading";
      resolutionHeading.innerHTML = "<h2>Media resolution</h2><span>Highest file resolution per scene</span>";
      resolutionPanel.appendChild(resolutionHeading);
      resolutionPanel.appendChild(makeResolutionChart(scenes));
      section.appendChild(yearPanel);
      section.appendChild(resolutionPanel);
      root.appendChild(section);
    });
  }

  function updateFluent2RangeProgress(range) {
    if (!range || !range.matches || !range.matches(".zoom-slider")) { return; }
    var minimum = Number(range.min || 0);
    var maximum = Number(range.max || 100);
    var value = Number(range.value || 0);
    var progress = maximum > minimum ? Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100)) : 0;
    range.style.setProperty("--fluent2-range-progress", progress + "%");
  }

  function syncFluent2RangeControls() {
    var ranges = document.querySelectorAll(".item-list-container .filtered-list-toolbar .zoom-slider");
    for (var i = 0; i < ranges.length; i++) { updateFluent2RangeProgress(ranges[i]); }
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
      size: Number(file.size || 0),
      date: scene && scene.date || "",
      createdAt: scene && scene.created_at || "",
      updatedAt: scene && scene.updated_at || "",
      lastPlayedAt: scene && scene.last_played_at || "",
      playCount: Number(scene && scene.play_count || 0),
      details: scene && scene.details || "",
      studio: scene && scene.studio && scene.studio.name || "",
      studioId: String(scene && scene.studio && scene.studio.id || ""),
      performerItems: (scene && scene.performers || []).map(function (performer) {
        return { id: String(performer && performer.id || ""), name: performer && performer.name || "" };
      }).filter(function (performer) { return performer.name; }),
      performers: (scene && scene.performers || []).map(function (performer) { return performer && performer.name; }).filter(Boolean),
      tagItems: (scene && scene.tags || []).map(function (tag) {
        return { id: String(tag && tag.id || ""), name: tag && tag.name || "" };
      }).filter(function (tag) { return tag.name; }),
      resumeTime: Number(scene && scene.resume_time || 0)
    };
  }

  function buildDashboardActivity(recentScenes, recentPerformers, recentlyPlayed) {
    var events = [];
    (recentScenes || []).forEach(function (scene) {
      if (!scene.createdAt) { return; }
      events.push({
        kind: "added",
        title: "Added a new scene",
        subject: scene.title,
        date: scene.createdAt,
        image: scene.image,
        href: "/scenes/" + encodeURIComponent(scene.id)
      });
    });
    (recentPerformers || []).forEach(function (performer) {
      if (!performer || !performer.updated_at || !performer.id) { return; }
      events.push({
        kind: "metadata",
        title: "Updated performer metadata",
        subject: performer.name || "Performer",
        date: performer.updated_at,
        image: performer.image_path || "",
        href: "/performers/" + encodeURIComponent(performer.id)
      });
    });
    (recentlyPlayed || []).forEach(function (scene) {
      if (!scene.lastPlayedAt) { return; }
      events.push({
        kind: "played",
        title: "Played a scene",
        subject: scene.title,
        date: scene.lastPlayedAt,
        image: scene.image,
        href: "/scenes/" + encodeURIComponent(scene.id)
      });
    });
    return events.sort(function (a, b) { return Date.parse(b.date) - Date.parse(a.date); }).slice(0, 4);
  }

  function buildPlugin(PluginApi) {
    var React = PluginApi.React;
    var h = React.createElement;
    var RouterLink = PluginApi.libraries && PluginApi.libraries.ReactRouterDOM && PluginApi.libraries.ReactRouterDOM.Link;
    var gql = createGraphQLClient();

    function routeLink(href, className, children, key) {
      var props = {
        className: className,
        onClick: function (event) {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            window.setTimeout(refreshTopbarContext, 0);
          }
        }
      };
      if (key !== undefined) { props.key = key; }
      if (RouterLink) { props.to = href; return h(RouterLink, props, children); }
      props.href = href;
      return h("a", props, children);
    }

    function SceneArtwork(props) {
      return h("div", { className: "fluent2-artwork" + (props.large ? " fluent2-artwork-large" : "") + (props.small ? " fluent2-artwork-small" : "") + (props.className ? " " + props.className : ""), style: props.image ? { backgroundImage: "url(\"" + props.image.replace(/\"/g, "%22") + "\")" } : undefined },
        h("div", { className: "fluent2-artwork-overlay" }),
        props.duration ? h("span", { className: "fluent2-duration" }, formatDuration(props.duration)) : null,
        props.children);
    }

    function EmptyState(props) {
      return h("div", { className: "fluent2-empty-state" },
        h("span", { className: "fluent2-empty-icon", dangerouslySetInnerHTML: { __html: icon(props.icon || "scenes") } }),
        h("p", null, props.children));
    }

    function NewArrivalsCarousel(props) {
      var state = React.useState(0);
      var index = state[0];
      var setIndex = state[1];
      var scenes = props.scenes || [];
      var touchStart = React.useRef(null);
      var selectedSceneId = React.useRef("");
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
      React.useEffect(function () {
        var scene = scenes[index];
        if (!scene || !props.onSelectScene || scene.id === selectedSceneId.current) { return; }
        selectedSceneId.current = scene.id;
        props.onSelectScene(scene.id);
      }, [scenes, index, props.onSelectScene]);
      if (!scenes.length) {
        return h("section", { className: "fluent2-home-hero fluent2-home-hero-empty", "aria-label": "New arrivals" },
          h("div", { className: "fluent2-hero-copy" },
            h("span", { className: "fluent2-kicker" }, "New arrivals"),
            h("h1", null, "Your next favorite starts here."),
            h("p", null, props.loading ? "Loading the latest additions to your library…" : "New scenes will appear here after they are added to your library."),
            !props.loading ? routeLink("/scenes", "fluent2-button fluent2-button-primary", "Browse scenes") : null));
      }
      var scene = scenes[index];
      var metadata = [];
      if (scene.date || scene.createdAt) { metadata.push(formatDashboardDate(scene.date || scene.createdAt, false)); }
      if (scene.duration) { metadata.push(formatDuration(scene.duration)); }
      if (scene.height) { metadata.push(Math.round(scene.height) + "p"); }
      return h("section", {
        className: "fluent2-home-hero",
        "aria-roledescription": "carousel",
        "aria-label": "New arrivals",
        tabIndex: 0,
        onKeyDown: function (event) {
          if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((index - 1 + scenes.length) % scenes.length); }
          if (event.key === "ArrowRight") { event.preventDefault(); setIndex((index + 1) % scenes.length); }
        },
        onTouchStart: function (event) { touchStart.current = event.touches && event.touches[0] ? event.touches[0].clientX : null; },
        onTouchEnd: function (event) {
          if (touchStart.current === null || (event.target.closest && event.target.closest(".fluent2-carousel-controls"))) { touchStart.current = null; return; }
          var touchEnd = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : touchStart.current;
          var distance = touchEnd - touchStart.current;
          touchStart.current = null;
          if (Math.abs(distance) > 55) { setIndex((index + (distance < 0 ? 1 : -1) + scenes.length) % scenes.length); }
        }
      },
        h(SceneArtwork, { image: scene.image, duration: scene.duration, large: true }),
        h("div", { className: "fluent2-hero-copy" },
          h("span", { className: "fluent2-kicker" }, "Recently added"),
          h("h1", { "aria-live": "polite" }, scene.title),
          h("div", { className: "fluent2-hero-meta" }, metadata.join(" · ")),
          scene.performerItems.length ? h("div", { className: "fluent2-hero-performers" }, scene.performerItems.slice(0, 3).map(function (performer) {
            return performer.id
              ? routeLink("/performers/" + encodeURIComponent(performer.id), "fluent2-person-chip", h(React.Fragment, null, h("span", { className: "fluent2-person-chip-icon", dangerouslySetInnerHTML: { __html: icon("performers") } }), performer.name), performer.id)
              : h("span", { className: "fluent2-person-chip", key: performer.name }, performer.name);
          })) : null,
          h("div", { className: "fluent2-hero-actions" },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "fluent2-button fluent2-button-primary", h(React.Fragment, null, h("span", { className: "fluent2-play-icon", dangerouslySetInnerHTML: { __html: "<svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M8 5v14l11-7z'/></svg>" } }), "Play")),
            h("button", { type: "button", className: "fluent2-button fluent2-button-quiet", onClick: props.onShowDetails }, "Details"))),
        scenes.length > 1 ? h("div", { className: "fluent2-carousel-controls", role: "group", "aria-label": "New arrivals controls" },
          h("button", { type: "button", className: "fluent2-carousel-arrow", "aria-label": "Previous scene", onClick: function () { setIndex((index - 1 + scenes.length) % scenes.length); } }, "‹"),
          h("div", { className: "fluent2-carousel-dots" }, scenes.map(function (item, dotIndex) {
            return h("button", { type: "button", key: item.id, className: "fluent2-carousel-dot" + (dotIndex === index ? " is-active" : ""), "aria-label": "Show " + item.title, "aria-current": dotIndex === index ? "true" : undefined, onClick: function () { setIndex(dotIndex); } }, h("span", null));
          })),
          h("span", { className: "fluent2-carousel-count", "aria-live": "polite" }, (index + 1) + " / " + scenes.length),
          h("button", { type: "button", className: "fluent2-carousel-arrow", "aria-label": "Next scene", onClick: function () { setIndex((index + 1) % scenes.length); } }, "›")) : null);
    }

    function ContinueWatching(props) {
      return h("section", { className: "fluent2-home-section", "aria-labelledby": "fluent2-continue-heading" },
        h("div", { className: "fluent2-section-heading" },
          h("div", null, h("span", { className: "fluent2-kicker" }, "Pick up where you left off"), h("h2", { id: "fluent2-continue-heading" }, "Continue watching")),
          props.scenes && props.scenes.length ? routeLink("/scenes", "fluent2-section-link", "All scenes →") : null),
        props.scenes && props.scenes.length ? h("div", { className: "fluent2-resume-grid" }, props.scenes.map(function (scene) {
          var duration = scene.duration;
          var percent = duration > 0 ? Math.max(0, Math.min(100, Math.round(scene.resumeTime / duration * 100))) : 0;
          return h("article", { className: "fluent2-resume-card", key: scene.id },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "fluent2-resume-link",
              h(React.Fragment, null,
                h(SceneArtwork, { image: scene.image, duration: duration }),
                h("div", { className: "fluent2-progress-track", role: "progressbar", "aria-label": scene.title + " watched", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }, h("span", { style: { width: percent + "%" } })),
                h("div", { className: "fluent2-resume-title" }, scene.title),
                h("div", { className: "fluent2-resume-meta" }, "Resume at " + formatDuration(scene.resumeTime) + (duration ? " · " + formatDuration(duration) : ""))
              )));
        })) : h(EmptyState, { icon: "scenes" }, props.loading ? "Checking for saved playback…" : "Scenes you have started will appear here."));
    }

    function LibraryOverview(props) {
      var stats = props.stats || {};
      var items = [
        ["/scenes", "Scenes", stats.scene_count, "scenes"],
        ["/performers", "Performers", stats.performer_count, "performers"],
        ["/studios", "Studios", stats.studio_count, "studios"],
        ["/galleries", "Galleries", stats.gallery_count, "galleries"],
        ["/images", "Images", stats.image_count, "images"]
      ];
      return h("section", { className: "fluent2-home-section fluent2-library-overview", "aria-labelledby": "fluent2-library-heading" },
        h("div", { className: "fluent2-section-heading" }, h("h2", { id: "fluent2-library-heading" }, "Your library")),
        h("div", { className: "fluent2-library-stat-grid" }, items.map(function (item) {
          return routeLink(item[0], "fluent2-library-stat", h(React.Fragment, null,
            h("span", { className: "fluent2-library-stat-icon", dangerouslySetInnerHTML: { __html: icon(item[3]) } }),
            h("span", { className: "fluent2-library-stat-copy" }, h("strong", null, Number(item[2] || 0).toLocaleString()), h("span", null, item[1]))
          ), item[1]);
        })));
    }

    function RecentActivity(props) {
      var events = props.events || [];
      var activityIcons = { added: "scenes", metadata: "performers", played: "activity" };
      return h("section", { className: "fluent2-home-section fluent2-recent-activity", "aria-labelledby": "fluent2-activity-heading" },
        h("div", { className: "fluent2-section-heading" }, h("h2", { id: "fluent2-activity-heading" }, "Recent activity")),
        events.length ? h("div", { className: "fluent2-activity-list" }, events.map(function (event, index) {
          return routeLink(event.href, "fluent2-activity-row", h(React.Fragment, null,
            h("span", { className: "fluent2-activity-icon", dangerouslySetInnerHTML: { __html: icon(activityIcons[event.kind] || "activity") } }),
            h("span", { className: "fluent2-activity-copy" },
              h("strong", null, event.title),
              h("span", { className: "fluent2-activity-subject" }, event.subject),
              h("small", null, formatDashboardDate(event.date, true))),
            event.image ? h(SceneArtwork, { image: event.image, small: true, className: "fluent2-activity-thumb" }) : null
          ), event.kind + "-" + index);
        })) : h(EmptyState, { icon: "activity" }, props.loading ? "Loading recent library activity…" : "New scenes and performer updates will appear here."));
    }

    function SceneInspector(props) {
      var scene = props.scene;
      var performers = scene && scene.performerItems || [];
      var tags = scene && scene.tagItems || [];
      function metadataRow(label, value) {
        return h("div", { className: "fluent2-inspector-meta-row", key: label }, h("span", null, label), h("strong", null, value || "—"));
      }
      function personChip(person) {
        return person.id
          ? routeLink("/performers/" + encodeURIComponent(person.id), "fluent2-detail-chip", person.name, person.id)
          : h("span", { className: "fluent2-detail-chip", key: person.name }, person.name);
      }
      function tagChip(tag) {
        return tag.id
          ? routeLink("/tags/" + encodeURIComponent(tag.id), "fluent2-detail-chip", tag.name, tag.id)
          : h("span", { className: "fluent2-detail-chip", key: tag.name }, tag.name);
      }
      var date = scene && (scene.date || scene.createdAt);
      return h("aside", { id: "fluent2-scene-inspector", className: "fluent2-scene-inspector" + (props.open ? " is-mobile-open" : "") },
        h("div", { className: "fluent2-inspector-heading" },
          h("h2", null, "Scene details"),
          h("button", { type: "button", className: "fluent2-inspector-toggle", "aria-expanded": Boolean(props.open), onClick: props.onToggle }, props.open ? "Hide details" : "Show details")),
        h("div", { className: "fluent2-inspector-body" }, scene ? h(React.Fragment, null,
          h(SceneArtwork, { image: scene.image, className: "fluent2-inspector-artwork" }),
          h("h3", { className: "fluent2-inspector-title" }, scene.title),
          h("p", { className: "fluent2-inspector-subtitle" }, "Scene" + (date ? " · " + formatDashboardDate(date, false) : "")),
          routeLink("/scenes/" + encodeURIComponent(scene.id), "fluent2-inspector-primary", h(React.Fragment, null,
            h("span", { className: "fluent2-play-icon", dangerouslySetInnerHTML: { __html: "<svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M8 5v14l11-7z'/></svg>" } }), "View scene")),
          h("div", { className: "fluent2-inspector-metadata" },
            metadataRow("Duration", scene.duration ? formatDuration(scene.duration) : "—"),
            metadataRow("Resolution", scene.height ? Math.round(scene.height) + "p" : "—"),
            metadataRow("Size", formatFileSize(scene.size) || "—"),
            h("div", { className: "fluent2-inspector-meta-row", key: "Studio" }, h("span", null, "Studio"), scene.studioId
              ? routeLink("/studios/" + encodeURIComponent(scene.studioId), "fluent2-inspector-studio", scene.studio)
              : h("strong", null, scene.studio || "—"))),
          performers.length ? h("section", { className: "fluent2-inspector-group" }, h("h3", null, "Performers (" + performers.length + ")"), h("div", { className: "fluent2-detail-chips" }, performers.map(personChip))) : null,
          tags.length ? h("section", { className: "fluent2-inspector-group" }, h("h3", null, "Tags (" + tags.length + ")"), h("div", { className: "fluent2-detail-chips" }, tags.slice(0, 8).map(tagChip))) : null,
          h("section", { className: "fluent2-inspector-group fluent2-inspector-description" }, h("h3", null, "Description"), h("p", null, scene.details || "No description has been added for this scene."))
        ) : h(EmptyState, { icon: "scenes" }, "Select a recently added scene to see its details.")));
    }

    function Fluent2Home(props) {
      var state = React.useState({ arrivals: [], resume: [], stats: null, activity: [], loading: true });
      var data = state[0];
      var setData = state[1];
      var selectedState = React.useState("");
      var selectedId = selectedState[0];
      var setSelectedId = selectedState[1];
      var detailState = React.useState(false);
      var detailsOpen = detailState[0];
      var setDetailsOpen = detailState[1];
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
          var sceneFields = "id title details date created_at updated_at last_played_at play_count resume_time studio { id name } performers { id name } tags { id name } files { basename duration height size } paths { screenshot }";
          var query = "query Fluent2Home { " +
            "newArrivals: findScenes(filter: { per_page: 7, sort: \"" + sort + "\", direction: DESC }) { scenes { " + sceneFields + " } } " +
            "continueWatching: findScenes(scene_filter: { resume_time: { value: 0, modifier: GREATER_THAN } }, filter: { per_page: 8, sort: \"last_played_at\", direction: DESC }) { scenes { " + sceneFields + " } } " +
            "recentScenes: findScenes(filter: { per_page: 4, sort: \"created_at\", direction: DESC }) { scenes { " + sceneFields + " } } " +
            "recentPlays: findScenes(filter: { per_page: 4, sort: \"last_played_at\", direction: DESC }) { scenes { " + sceneFields + " } } " +
            "recentPerformers: findPerformers(filter: { per_page: 3, sort: \"updated_at\", direction: DESC }) { performers { id name updated_at image_path } } " +
            "stats { scene_count performer_count studio_count gallery_count image_count } }";
          gql(query, controller.signal).then(function (result) {
            if (!active || currentRequest !== requestId) { return; }
            var arrivals = (result.newArrivals && result.newArrivals.scenes || []).map(sceneView).filter(function (scene) { return scene.id; });
            var resume = (result.continueWatching && result.continueWatching.scenes || []).map(sceneView).filter(function (scene) { return scene.id; });
            var recentScenes = (result.recentScenes && result.recentScenes.scenes || []).map(sceneView).filter(function (scene) { return scene.id; });
            var recentPlays = (result.recentPlays && result.recentPlays.scenes || []).map(sceneView).filter(function (scene) { return scene.id && scene.lastPlayedAt; });
            setData({
              arrivals: arrivals,
              resume: resume,
              stats: result.stats || {},
              activity: buildDashboardActivity(recentScenes, result.recentPerformers && result.recentPerformers.performers || [], recentPlays),
              loading: false
            });
          }).catch(function () {
            if (active && currentRequest === requestId) { setData({ arrivals: [], resume: [], stats: null, activity: [], loading: false }); }
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
      var selectedScene = data.arrivals.filter(function (scene) { return scene.id === selectedId; })[0] || data.arrivals[0] || null;
      function showSceneDetails() {
        setDetailsOpen(true);
        if (window.matchMedia && window.matchMedia("(max-width: 1000px)").matches) {
          window.setTimeout(function () {
            var inspector = document.getElementById("fluent2-scene-inspector");
            if (inspector) { inspector.scrollIntoView({ behavior: readPreferences().reduceEffects ? "auto" : "smooth", block: "start" }); }
          }, 0);
        }
      }
      return h("main", { className: "fluent2-home fluent2-dashboard-layout" },
        h(NewArrivalsCarousel, { scenes: data.arrivals, loading: data.loading, onSelectScene: setSelectedId, onShowDetails: showSceneDetails }),
        h(SceneInspector, { scene: selectedScene, open: detailsOpen, onToggle: function () { setDetailsOpen(!detailsOpen); } }),
        h("div", { className: "fluent2-dashboard-main" },
          h(ContinueWatching, { scenes: data.resume, loading: data.loading }),
          h(LibraryOverview, { stats: data.stats }),
          h(RecentActivity, { events: data.activity, loading: data.loading })
        ));
    }

    function Fluent2SettingsPage(props) {
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
        return h("div", { className: "fluent2-setting-row", key: key },
          h("div", null, h("strong", null, label), h("p", null, description)),
          h("button", { type: "button", role: "switch", className: "fluent2-switch" + (preferences[key] ? " is-on" : ""), "aria-checked": Boolean(preferences[key]), onClick: function () { change(key, !preferences[key]); } }, h("span", null)));
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
      return h("main", { className: "fluent2-settings-page" + (embedded ? " fluent2-settings-page-embedded" : "") },
        embedded ? null : h("header", { className: "fluent2-settings-hero" },
          h("span", { className: "fluent2-brand-mark", dangerouslySetInnerHTML: { __html: FLUENT2_MARK } }),
          h("div", null, h("span", { className: "fluent2-kicker" }, "FLUENT 2 SETTINGS"), h("h1", null, "Make Fluent 2 yours"), h("p", null, "Set the tone, shape navigation, and fine-tune how your library looks."))),
        h("section", { className: "fluent2-settings-card" },
          h("div", { className: "fluent2-section-heading" }, h("div", null, h("span", { className: "fluent2-kicker" }, "APPEARANCE"), h("h2", null, "Color and mode"))),
          h("div", { className: "fluent2-setting-row" },
            h("div", null, h("strong", null, "Color mode"), h("p", null, "Choose light, dark, or follow your device setting.")),
            h("select", { className: "fluent2-select", value: preferences.mode, onChange: function (event) { change("mode", event.target.value); } },
              h("option", { value: "system" }, "System"), h("option", { value: "dark" }, "Dark"), h("option", { value: "light" }, "Light"))),
          h("div", { className: "fluent2-setting-row fluent2-accent-row" },
            h("div", null, h("strong", null, "Accent color"), h("p", null, "Used for active states, controls, and playback progress.")),
            h("div", { className: "fluent2-accent-swatches", role: "group", "aria-label": "Accent color" }, ACCENTS.map(function (accent) {
              return h("button", { type: "button", key: accent.id, className: "fluent2-accent-swatch" + (preferences.accent === accent.id ? " is-selected" : ""), style: { backgroundColor: accent.color }, title: accent.label, "aria-label": accent.label, "aria-pressed": preferences.accent === accent.id, onClick: function () { change("accent", accent.id); } });
            }))),
          toggle("Reduce visual effects", "Reduce transitions and motion on this device.", "reduceEffects")),
        h("section", { className: "fluent2-settings-card" },
          h("div", { className: "fluent2-section-heading" }, h("div", null, h("span", { className: "fluent2-kicker" }, "CARDS"), h("h2", null, "Library card appearance"), h("p", null, "Choose a layout for Stash scene cards."))),
          h("div", { className: "fluent2-card-style-grid" }, cardStyles.map(function (style) {
            return h("button", { type: "button", key: style[0], className: "fluent2-card-style-option" + (preferences.cardStyle === style[0] ? " is-selected" : ""), "aria-pressed": preferences.cardStyle === style[0], onClick: function () { change("cardStyle", style[0]); } },
              h("span", { className: "fluent2-card-style-preview " + style[0] }, h("i", null), h("i", null), h("i", null)),
              h("strong", null, style[1]), h("small", null, style[2]));
          }))),
        h("section", { className: "fluent2-settings-card" },
          h("div", { className: "fluent2-section-heading" }, h("div", null, h("span", { className: "fluent2-kicker" }, "HOMEPAGE"), h("h2", null, "Featured content"))),
          h("div", { className: "fluent2-setting-row" },
            h("div", null, h("strong", null, "New content means"), h("p", null, "Choose how Fluent 2 decides what counts as new.")),
            h("select", { className: "fluent2-select", value: preferences.newContentSort === "date" ? "date" : "created_at", onChange: function (event) { change("newContentSort", event.target.value); } },
              h("option", { value: "created_at" }, "Recently added"), h("option", { value: "date" }, "Recently released")))),
        h("section", { className: "fluent2-settings-card" },
          h("div", { className: "fluent2-section-heading" }, h("div", null, h("span", { className: "fluent2-kicker" }, "NAVIGATION"), h("h2", null, "Shape your navigation"), h("p", null, "Choose how Fluent 2 routes appear on desktop and mobile."))),
          toggle("Start with a compact desktop rail", "Show navigation labels only when the rail is expanded.", "sidebarCollapsed"),
          h("div", { className: "fluent2-setting-row fluent2-mobile-choice-row" },
            h("div", null, h("strong", null, "Mobile dock"), h("p", null, "Choose up to three destinations; the fixed fourth button opens all remaining pages.")),
            h("span", { className: "fluent2-selection-count" }, preferences.mobileDock.length + " of 3")),
          h("div", { className: "fluent2-mobile-choice-grid" }, mobileChoices.map(function (choice) {
            var selected = preferences.mobileDock.indexOf(choice[0]) !== -1;
            return h("button", { type: "button", key: choice[0], className: "fluent2-choice-chip" + (selected ? " is-selected" : ""), "aria-pressed": selected, disabled: !selected && preferences.mobileDock.length >= 3, onClick: function () { toggleDock(choice[0]); } }, choice[1]);
          }))),
        h("section", { className: "fluent2-settings-card" },
          h("div", { className: "fluent2-section-heading" }, h("div", null, h("span", { className: "fluent2-kicker" }, "PLAYBACK"), h("h2", null, "Playback preferences"), h("p", null, "Player behavior remains controlled by Stash."))),
          h("div", { className: "fluent2-playback-note" }, h("p", null, "Fluent 2 uses Stash’s built-in player and resume position, so autoplay, playlist continuation, and playback controls stay in sync with the server’s native preferences."))),
        h("p", { className: "fluent2-settings-note" }, "Fluent 2 appearance preferences are saved in this browser. Library records, playback, and settings continue to use Stash’s native features."));
    }

    var interfaceSettingsRoot = null;
    var interfaceSettingsHost = null;
    var interfaceSettingsRendered = false;
    mountFluent2ThemeSettingsInInterface = function () {
      var interfacePanel = document.querySelector("#configuration-tabs-tabpane-interface");
      if (!interfacePanel) { return; }
      var section = interfacePanel.querySelector(":scope > .fluent2-theme-settings-section");
      if (!section) {
        section = document.createElement("section");
        section.className = "setting-section fluent2-theme-settings-section";
        var title = document.createElement("h1");
        title.textContent = "Theme Settings";
        var host = document.createElement("div");
        host.className = "fluent2-theme-settings-host";
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
      var host = section.querySelector(".fluent2-theme-settings-host");
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
      if (interfaceSettingsRendered && host.querySelector(".fluent2-settings-page")) { return; }
      var settingsElement = h(Fluent2SettingsPage, { embedded: true });
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
        return h(Fluent2Home, { stockContent: stockContent });
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
      mountFluent2Statistics();
      syncFluent2RangeControls();
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
        syncFluent2RangeControls();
        enhanceNativeSettings();
        if (window.location.pathname === "/stats") { window.setTimeout(mountFluent2Statistics, 100); }
      });
      pageObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState !== "loading") { activate(); }
    else { document.addEventListener("DOMContentLoaded", activate, { once: true }); }
    window.addEventListener("popstate", updateActiveNavigation);
    window.addEventListener("popstate", refreshTopbarContext);
    window.addEventListener("popstate", mountFluent2Statistics);
    window.addEventListener("popstate", enhanceNativeSettings);
    if (window.matchMedia) {
      var modeQuery = window.matchMedia("(prefers-color-scheme: light)");
      modeQuery.addEventListener ? modeQuery.addEventListener("change", function () { if (readPreferences().mode === "system") { applyPreferences(readPreferences()); } }) : modeQuery.addListener(function () { if (readPreferences().mode === "system") { applyPreferences(readPreferences()); } });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { openMobileDrawer(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        var search = document.querySelector(".fluent2-global-search-input");
        if (search) { event.preventDefault(); search.focus(); }
      }
    });
    document.addEventListener("input", function (event) { updateFluent2RangeProgress(event.target); });
    document.addEventListener("change", function (event) { updateFluent2RangeProgress(event.target); });
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
