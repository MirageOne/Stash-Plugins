(function () {
  "use strict";

  var PLUGIN_ROUTE = "/plugin/filmroom-theme";
  var PREFERENCES_KEY = "filmroom.preferences.v1";
  var PREFERENCES_EVENT = "filmroom:preferences-changed";
  var DEFAULT_PREFERENCES = {
    mode: "dark",
    accent: "violet",
    newContentSort: "created_at",
    sidebarCollapsed: false
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
    if (merged.mode !== "light") { merged.mode = "dark"; }
    if (!ACCENTS.some(function (accent) { return accent.id === merged.accent; })) {
      merged.accent = DEFAULT_PREFERENCES.accent;
    }
    if (merged.newContentSort !== "date") { merged.newContentSort = "created_at"; }
    merged.sidebarCollapsed = Boolean(merged.sidebarCollapsed);
    return merged;
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
    root.setAttribute("data-filmroom-theme", "active");
    root.setAttribute("data-filmroom-mode", preferences.mode);
    root.setAttribute("data-filmroom-accent", preferences.accent);
    if (document.body) {
      document.body.classList.add("filmroom-active");
      document.body.classList.toggle("filmroom-sidebar-collapsed", preferences.sidebarCollapsed);
    }
    updateModeButton(preferences.mode);
    updateSidebarState(preferences.sidebarCollapsed);
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.scenes) + "</svg>";
  }

  function updateModeButton(mode) {
    var button = document.querySelector(".filmroom-mode-toggle");
    if (!button) { return; }
    if (button.getAttribute("data-filmroom-mode") === mode) { return; }
    var nextLabel = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", nextLabel);
    button.setAttribute("title", nextLabel);
    button.setAttribute("aria-pressed", mode === "light" ? "true" : "false");
    button.setAttribute("data-filmroom-mode", mode);
    button.innerHTML = icon(mode === "dark" ? "sun" : "moon");
  }

  function installTopbarBrand(navbar) {
    if (navbar.querySelector(".filmroom-topbar-brand")) { return true; }
    var brand = document.createElement("a");
    brand.className = "filmroom-topbar-brand";
    brand.href = "/";
    brand.setAttribute("data-filmroom-route", "/");
    brand.setAttribute("aria-label", "Filmroom home");
    brand.innerHTML = '<span class="filmroom-brand-mark">F</span><span>Filmroom</span>';
    brand.addEventListener("click", function (event) { navigateFromLink(event, brand); });
    navbar.insertBefore(brand, navbar.firstChild);
    return true;
  }

  function installModeButton() {
    var navbar = document.querySelector("nav.top-nav");
    var actions = navbar && navbar.querySelector(".navbar-buttons");
    if (!actions) { return false; }
    var button = actions.querySelector(".filmroom-mode-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "btn minimal filmroom-mode-toggle";
      button.addEventListener("click", function () {
        var preferences = readPreferences();
        savePreferences({ mode: preferences.mode === "dark" ? "light" : "dark" });
      });
      var toggle = actions.querySelector(".nav-menu-toggle");
      actions.insertBefore(button, toggle || null);
    }
    updateModeButton(readPreferences().mode);
    return true;
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
    return "scenes";
  }

  function collectNavigationItems(navbar) {
    var items = [{ href: "/", label: "Home", icon: "home" }];
    var seen = { "/": true };
    var menu = navbar.querySelector(".navbar-collapse");
    var links = menu ? menu.querySelectorAll("a[href]") : [];
    for (var i = 0; i < links.length; i++) {
      var anchor = links[i];
      if (anchor.target === "_blank") { continue; }
      var path;
      try { path = new URL(anchor.getAttribute("href"), window.location.origin).pathname; }
      catch (error) { continue; }
      if (path.charAt(0) !== "/" || path === "/logout" || /\/new\/?$/.test(path) || seen[path]) { continue; }
      var label = (anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (!label) { continue; }
      seen[path] = true;
      items.push({ href: path, label: label, icon: routeIcon(path) });
    }

    var utilityLinks = navbar.querySelectorAll(".navbar-buttons a[href]");
    for (var j = 0; j < utilityLinks.length; j++) {
      var utility = utilityLinks[j];
      var utilityPath;
      try { utilityPath = new URL(utility.getAttribute("href"), window.location.origin).pathname; }
      catch (error) { continue; }
      if (utilityPath === "/stats" && !seen[utilityPath]) {
        seen[utilityPath] = true;
        items.push({ href: utilityPath, label: "Statistics", icon: "stats" });
      }
    }

    var settings = { href: "/settings", label: "Settings", icon: "settings" };
    if (seen[settings.href]) {
      items = items.filter(function (item) { return item.href !== settings.href; });
    }
    items.push(settings);
    return items;
  }

  function makeRouteLink(item, className) {
    var link = document.createElement("a");
    link.className = className;
    link.href = item.href;
    link.setAttribute("data-filmroom-route", item.href);
    link.setAttribute("aria-label", item.label);
    link.title = item.label;
    link.innerHTML = '<span class="filmroom-nav-icon">' + icon(item.icon) + "</span><span class=\"filmroom-nav-label\"></span>";
    link.querySelector(".filmroom-nav-label").textContent = item.label;
    return link;
  }

  function updateSidebarState(collapsed) {
    if (!document.body) { return; }
    document.body.classList.toggle("filmroom-sidebar-collapsed", Boolean(collapsed));
    var button = document.querySelector(".filmroom-sidebar-collapse");
    if (button) {
      button.setAttribute("aria-pressed", collapsed ? "true" : "false");
      button.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
      button.title = collapsed ? "Expand navigation" : "Collapse navigation";
    }
  }

  function itemIsActive(item, path) {
    if (item.href === "/") { return path === "/"; }
    if (item.href === "/plugin/filmroom-theme") { return path.indexOf(item.href) === 0; }
    if (item.href === "/scenes" && path.indexOf("/scenes/markers") === 0) { return false; }
    return path === item.href || path.indexOf(item.href + "/") === 0 ||
      (item.href === "/settings" && path.indexOf("/settings") === 0);
  }

  function updateActiveNavigation() {
    var path = window.location.pathname || "/";
    var links = document.querySelectorAll("[data-filmroom-route]");
    for (var i = 0; i < links.length; i++) {
      var active = itemIsActive({ href: links[i].getAttribute("data-filmroom-route") }, path);
      links[i].classList.toggle("is-active", active);
      if (active) { links[i].setAttribute("aria-current", "page"); }
      else { links[i].removeAttribute("aria-current"); }
    }
  }

  function openMobileDrawer(open) {
    if (!document.body) { return; }
    document.body.classList.toggle("filmroom-drawer-open", Boolean(open));
    var trigger = document.querySelector(".filmroom-mobile-more");
    if (trigger) { trigger.setAttribute("aria-expanded", open ? "true" : "false"); }
  }

  function renderNavigation(navbar) {
    if (!document.body) { return false; }
    var items = collectNavigationItems(navbar);
    var settings = items.filter(function (item) { return item.href === "/settings"; })[0];
    var primary = items.filter(function (item) { return item.href !== "/settings"; });
    var signature = items.map(function (item) { return item.href + ":" + item.label; }).join("|");

    var sidebar = document.querySelector(".filmroom-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "filmroom-sidebar";
      sidebar.setAttribute("aria-label", "Primary navigation");
      sidebar.innerHTML = '<div class="filmroom-sidebar-brand-row"><a class="filmroom-brand" href="/" data-filmroom-route="/" aria-label="Filmroom home"><span class="filmroom-brand-mark">F</span><span class="filmroom-brand-name">Filmroom</span></a><button type="button" class="filmroom-sidebar-collapse" aria-label="Collapse navigation" aria-pressed="false" title="Collapse navigation">' + icon("collapse") + "</button></div><nav class=\"filmroom-sidebar-nav\" aria-label=\"Library\"><div class=\"filmroom-sidebar-primary\"></div><div class=\"filmroom-sidebar-footer\"></div></nav>";
      document.body.appendChild(sidebar);
      sidebar.addEventListener("click", function (event) {
        var collapse = event.target.closest(".filmroom-sidebar-collapse");
        if (collapse) {
          event.preventDefault();
          savePreferences({ sidebarCollapsed: !document.body.classList.contains("filmroom-sidebar-collapsed") });
          return;
        }
        var route = event.target.closest("[data-filmroom-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }

    if (sidebar.getAttribute("data-signature") !== signature) {
      var primaryHost = sidebar.querySelector(".filmroom-sidebar-primary");
      var footerHost = sidebar.querySelector(".filmroom-sidebar-footer");
      primaryHost.textContent = "";
      footerHost.textContent = "";
      primary.forEach(function (item) { primaryHost.appendChild(makeRouteLink(item, "filmroom-nav-item")); });
      if (settings) { footerHost.appendChild(makeRouteLink(settings, "filmroom-nav-item")); }
      footerHost.appendChild(makeRouteLink({ href: PLUGIN_ROUTE, label: "Theme settings", icon: "sun" }, "filmroom-nav-item filmroom-theme-nav-item"));
      sidebar.setAttribute("data-signature", signature);
    }

    var dock = document.querySelector(".filmroom-mobile-dock");
    if (!dock) {
      dock = document.createElement("nav");
      dock.className = "filmroom-mobile-dock";
      dock.setAttribute("aria-label", "Quick navigation");
      document.body.appendChild(dock);
      dock.addEventListener("click", function (event) {
        var more = event.target.closest(".filmroom-mobile-more");
        if (more) { event.preventDefault(); openMobileDrawer(!document.body.classList.contains("filmroom-drawer-open")); return; }
        var route = event.target.closest("[data-filmroom-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    if (dock.getAttribute("data-signature") !== signature) {
      dock.textContent = "";
      primary.slice(0, 5).forEach(function (item) { dock.appendChild(makeRouteLink(item, "filmroom-dock-item")); });
      var more = document.createElement("button");
      more.type = "button";
      more.className = "filmroom-dock-item filmroom-mobile-more";
      more.setAttribute("aria-label", "More pages");
      more.setAttribute("aria-expanded", "false");
      more.innerHTML = '<span class="filmroom-nav-icon">' + icon("groups") + '</span><span class="filmroom-nav-label">More</span>';
      dock.appendChild(more);
      dock.setAttribute("data-signature", signature);
    }

    var drawer = document.querySelector(".filmroom-mobile-drawer");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "filmroom-mobile-drawer";
      drawer.setAttribute("aria-label", "All pages");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", function (event) {
        if (event.target === drawer) { openMobileDrawer(false); return; }
        var route = event.target.closest("[data-filmroom-route]");
        if (route) { navigateFromLink(event, route); }
      });
    }
    if (drawer.getAttribute("data-signature") !== signature) {
      drawer.textContent = "";
      var sheet = document.createElement("section");
      sheet.className = "filmroom-mobile-sheet";
      var sheetHeading = document.createElement("div");
      sheetHeading.className = "filmroom-mobile-sheet-heading";
      sheetHeading.innerHTML = "<strong>All pages</strong>";
      var close = document.createElement("button");
      close.type = "button";
      close.className = "filmroom-mobile-close";
      close.setAttribute("aria-label", "Close navigation");
      close.textContent = "×";
      close.addEventListener("click", function () { openMobileDrawer(false); });
      sheetHeading.appendChild(close);
      sheet.appendChild(sheetHeading);
      items.forEach(function (item) { sheet.appendChild(makeRouteLink(item, "filmroom-mobile-sheet-link")); });
      sheet.appendChild(makeRouteLink({ href: PLUGIN_ROUTE, label: "Theme settings", icon: "sun" }, "filmroom-mobile-sheet-link filmroom-theme-nav-item"));
      drawer.appendChild(sheet);
      drawer.setAttribute("data-signature", signature);
    }

    document.body.classList.add("filmroom-active");
    applyPreferences(readPreferences());
    updateActiveNavigation();
    return true;
  }

  function navigateFromLink(event, link) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
    var href = link.getAttribute("data-filmroom-route");
    if (!href) { return; }
    event.preventDefault();
    openMobileDrawer(false);
    if (window.location.pathname !== href) {
      window.history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    updateActiveNavigation();
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
            window.setTimeout(updateActiveNavigation, 0);
          }
        }
      };
      if (RouterLink) { props.to = href; return h(RouterLink, props, children); }
      props.href = href;
      return h("a", props, children);
    }

    function SceneArtwork(props) {
      return h("div", { className: "filmroom-artwork" + (props.large ? " filmroom-artwork-large" : ""), style: props.image ? { backgroundImage: "url(\"" + props.image.replace(/\"/g, "%22") + "\")" } : undefined },
        h("div", { className: "filmroom-artwork-overlay" }),
        props.duration ? h("span", { className: "filmroom-duration" }, formatDuration(props.duration)) : null,
        props.children);
    }

    function EmptyState(props) {
      return h("div", { className: "filmroom-empty-state" },
        h("span", { className: "filmroom-empty-icon", dangerouslySetInnerHTML: { __html: icon(props.icon || "scenes") } }),
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
        return h("section", { className: "filmroom-home-hero filmroom-home-hero-empty", "aria-label": "New arrivals" },
          h("div", { className: "filmroom-hero-copy" },
            h("span", { className: "filmroom-kicker" }, "New arrivals"),
            h("h1", null, "Your next favorite starts here."),
            h("p", null, props.loading ? "Loading the latest additions to your library…" : "New scenes will appear here after they are added to your library."),
            !props.loading ? routeLink("/scenes", "filmroom-button filmroom-button-primary", "Browse scenes") : null));
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
        className: "filmroom-home-hero",
        "aria-roledescription": "carousel",
        "aria-label": "New arrivals",
        tabIndex: 0,
        onKeyDown: function (event) {
          if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((index - 1 + scenes.length) % scenes.length); }
          if (event.key === "ArrowRight") { event.preventDefault(); setIndex((index + 1) % scenes.length); }
        },
        onTouchStart: function (event) { touchStart.current = event.touches && event.touches[0] ? event.touches[0].clientX : null; },
        onTouchEnd: function (event) {
          if (touchStart.current === null || (event.target.closest && event.target.closest(".filmroom-carousel-controls"))) { touchStart.current = null; return; }
          var touchEnd = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : touchStart.current;
          var distance = touchEnd - touchStart.current;
          touchStart.current = null;
          if (Math.abs(distance) > 55) { setIndex((index + (distance < 0 ? 1 : -1) + scenes.length) % scenes.length); }
        }
      },
        h(SceneArtwork, { image: scene.image, duration: scene.duration, large: true }),
        h("div", { className: "filmroom-hero-copy" },
          h("span", { className: "filmroom-kicker" }, "Newly added to your library"),
          h("h1", { "aria-live": "polite" }, scene.title),
          h("div", { className: "filmroom-hero-meta" }, metadata.join(" · ")),
          performers ? h("div", { className: "filmroom-hero-performers" }, performers) : null,
          h("div", { className: "filmroom-hero-actions" },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "filmroom-button filmroom-button-primary", h(React.Fragment, null, h("span", { className: "filmroom-play-icon", dangerouslySetInnerHTML: { __html: "<svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M8 5v14l11-7z'/></svg>" } }), "Play scene")),
            routeLink("/scenes", "filmroom-button filmroom-button-quiet", "Browse library"))),
        h("div", { className: "filmroom-carousel-controls", role: "group", "aria-label": "New arrivals controls" },
          h("button", { type: "button", className: "filmroom-carousel-arrow", "aria-label": "Previous scene", onClick: function () { setIndex((index - 1 + scenes.length) % scenes.length); } }, "‹"),
          h("div", { className: "filmroom-carousel-dots" }, scenes.map(function (item, dotIndex) {
            return h("button", { type: "button", key: item.id, className: "filmroom-carousel-dot" + (dotIndex === index ? " is-active" : ""), "aria-label": "Show " + item.title, "aria-current": dotIndex === index ? "true" : undefined, onClick: function () { setIndex(dotIndex); } }, h("span", null));
          })),
          h("span", { className: "filmroom-carousel-count", "aria-live": "polite" }, (index + 1) + " / " + scenes.length),
          h("button", { type: "button", className: "filmroom-carousel-arrow", "aria-label": "Next scene", onClick: function () { setIndex((index + 1) % scenes.length); } }, "›")));
    }

    function ContinueWatching(props) {
      return h("section", { className: "filmroom-home-section", "aria-labelledby": "filmroom-continue-heading" },
        h("div", { className: "filmroom-section-heading" },
          h("div", null, h("span", { className: "filmroom-kicker" }, "Pick up where you left off"), h("h2", { id: "filmroom-continue-heading" }, "Continue watching")),
          props.scenes && props.scenes.length ? routeLink("/scenes", "filmroom-section-link", "All scenes →") : null),
        props.scenes && props.scenes.length ? h("div", { className: "filmroom-resume-grid" }, props.scenes.map(function (scene) {
          var duration = scene.duration;
          var percent = duration > 0 ? Math.max(0, Math.min(100, Math.round(scene.resumeTime / duration * 100))) : 0;
          return h("article", { className: "filmroom-resume-card", key: scene.id },
            routeLink("/scenes/" + encodeURIComponent(scene.id), "filmroom-resume-link",
              h(React.Fragment, null,
                h(SceneArtwork, { image: scene.image, duration: duration }),
                h("div", { className: "filmroom-progress-track", role: "progressbar", "aria-label": scene.title + " watched", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }, h("span", { style: { width: percent + "%" } })),
                h("div", { className: "filmroom-resume-title" }, scene.title),
                h("div", { className: "filmroom-resume-meta" }, "Resume at " + formatDuration(scene.resumeTime) + (duration ? " · " + formatDuration(duration) : ""))
              )));
        })) : h(EmptyState, { icon: "scenes" }, props.loading ? "Checking for saved playback…" : "Scenes you have started will appear here."));
    }

    function FilmroomHome(props) {
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
          var query = "query FilmroomHome { " +
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
      return h("div", { className: "filmroom-home" },
        h(NewArrivalsCarousel, { scenes: data.arrivals, loading: data.loading }),
        h(ContinueWatching, { scenes: data.resume, loading: data.loading }),
        props.stockContent ? h("section", { className: "filmroom-stock-recommendations", "aria-label": "Stash recommendations" }, props.stockContent) : null);
    }

    function FilmroomSettingsPage() {
      var state = React.useState(readPreferences());
      var preferences = state[0];
      var setState = state[1];
      React.useEffect(function () {
        function refresh(event) { setState(event.detail || readPreferences()); }
        window.addEventListener(PREFERENCES_EVENT, refresh);
        return function () { window.removeEventListener(PREFERENCES_EVENT, refresh); };
      }, []);
      function change(key, value) {
        var next = savePreferences((function () { var update = {}; update[key] = value; return update; })());
        setState(next);
      }
      function toggle(label, description, key) {
        return h("div", { className: "filmroom-setting-row", key: key },
          h("div", null, h("strong", null, label), h("p", null, description)),
          h("button", { type: "button", role: "switch", className: "filmroom-switch" + (preferences[key] ? " is-on" : ""), "aria-checked": Boolean(preferences[key]), onClick: function () { change(key, !preferences[key]); } }, h("span", null)));
      }
      return h("main", { className: "filmroom-settings-page" },
        h("header", { className: "filmroom-settings-hero" },
          h("span", { className: "filmroom-brand-mark" }, "F"),
          h("div", null, h("span", { className: "filmroom-kicker" }, "FILMROOM THEME SETTINGS"), h("h1", null, "Make Filmroom yours"), h("p", null, "Choose your mode, accent, and homepage behavior."))),
        h("section", { className: "filmroom-settings-card" },
          h("div", { className: "filmroom-section-heading" }, h("div", null, h("span", { className: "filmroom-kicker" }, "APPEARANCE"), h("h2", null, "Color and mode"))),
          h("div", { className: "filmroom-setting-row" },
            h("div", null, h("strong", null, "Light mode"), h("p", null, "Use a bright palette throughout Stash.")),
            h("button", { type: "button", role: "switch", className: "filmroom-switch" + (preferences.mode === "light" ? " is-on" : ""), "aria-checked": preferences.mode === "light", onClick: function () { change("mode", preferences.mode === "dark" ? "light" : "dark"); } }, h("span", null))),
          h("div", { className: "filmroom-setting-row filmroom-accent-row" },
            h("div", null, h("strong", null, "Accent color"), h("p", null, "Used for active states, controls, and playback progress.")),
            h("div", { className: "filmroom-accent-swatches", role: "group", "aria-label": "Accent color" }, ACCENTS.map(function (accent) {
              return h("button", { type: "button", key: accent.id, className: "filmroom-accent-swatch" + (preferences.accent === accent.id ? " is-selected" : ""), style: { backgroundColor: accent.color }, title: accent.label, "aria-label": accent.label, "aria-pressed": preferences.accent === accent.id, onClick: function () { change("accent", accent.id); } });
            })))),
        h("section", { className: "filmroom-settings-card" },
          h("div", { className: "filmroom-section-heading" }, h("div", null, h("span", { className: "filmroom-kicker" }, "HOMEPAGE"), h("h2", null, "Featured content"))),
          h("div", { className: "filmroom-setting-row" },
            h("div", null, h("strong", null, "New content means"), h("p", null, "Choose how Filmroom decides what counts as new.")),
            h("select", { className: "filmroom-select", value: preferences.newContentSort === "date" ? "date" : "created_at", onChange: function (event) { change("newContentSort", event.target.value); } },
              h("option", { value: "created_at" }, "Recently added"), h("option", { value: "date" }, "Recently released"))),
          toggle("Compact sidebar", "Show a narrow icon-only desktop navigation rail.", "sidebarCollapsed")),
        h("p", { className: "filmroom-settings-note" }, "These appearance preferences are saved in this browser. Stash continues to manage your library, player, and recommendation shelves."));
    }

    if (PluginApi.register && PluginApi.register.route) {
      PluginApi.register.route(PLUGIN_ROUTE, FilmroomSettingsPage);
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
        return h(FilmroomHome, { stockContent: stockContent });
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
    var timer = null;
    function sync() {
      var navbar = document.querySelector("nav.top-nav");
      if (!navbar) { return false; }
      installTopbarBrand(navbar);
      installModeButton();
      renderNavigation(navbar);
      if (!observer) {
        observer = new MutationObserver(function () { renderNavigation(navbar); installModeButton(); });
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
    }
    if (document.readyState !== "loading") { activate(); }
    else { document.addEventListener("DOMContentLoaded", activate, { once: true }); }
    window.addEventListener("popstate", updateActiveNavigation);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") { openMobileDrawer(false); } });
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
