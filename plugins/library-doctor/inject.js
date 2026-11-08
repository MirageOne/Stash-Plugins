/* Adds Library Doctor as an in-app Stash route while keeping its existing
   dashboard served from the plugin's same-origin raw interface. */
(function () {
    "use strict";

    var ENTRY_ID = "library-doctor-nav-entry";
    var APP_ROUTE = "/plugins/library-doctor";
    var DASHBOARD_URL = "/plugin/library-doctor/assets/index.html";
    var HOST_THEME_KEY = "library-doctor.host-theme.v1";
    var ICON = "<svg viewBox='0 0 24 24' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M6 3.5v5a4 4 0 0 0 8 0v-5M4 3.5h4M12 3.5h4'/><path d='M14 8.5v2a4 4 0 0 0 4 4h1'/><circle cx='19' cy='17' r='2.5'/></svg>";

    function colorChannels(color) {
        var value = String(color || "").trim();
        var hex = value.match(/^#([\da-f]{3,8})$/i);
        if (hex && [3, 4, 6, 8].indexOf(hex[1].length) !== -1) {
            var digits = hex[1].length <= 4 ? hex[1].slice(0, 3).split("").map(function (part) { return part + part; }).join("") : hex[1].slice(0, 6);
            return [0, 2, 4].map(function (offset) { return parseInt(digits.slice(offset, offset + 2), 16); });
        }
        if (/^rgba?\(/i.test(value)) {
            var channels = value.match(/[\d.]+/g);
            if (channels && channels.length >= 3) {
                var rgb = channels.slice(0, 3).map(Number);
                if (rgb.every(Number.isFinite)) { return rgb; }
            }
        }
        return null;
    }

    function alphaColor(color, alpha) {
        var channels = colorChannels(color);
        if (!channels) { return color; }
        var values = String(color).match(/[\d.]+/g) || [];
        var sourceAlpha = /^rgba\(/i.test(color) && values.length > 3 ? Number(values[3]) : 1;
        return "rgba(" + channels.map(Math.round).join(", ") + ", " + Math.max(0, Math.min(1, alpha * sourceAlpha)) + ")";
    }

    function isTransparent(color) {
        if (color === "transparent") { return true; }
        if (!/^rgba\(/i.test(color)) { return false; }
        var values = String(color).match(/[\d.]+/g) || [];
        return values.length > 3 && Number(values[3]) === 0;
    }

    function syncHostTheme() {
        if (!document.body || !window.getComputedStyle) { return; }
        var appRoot = document.getElementById("root") || document.body;
        var probe = document.createElement("div");
        probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:320px;z-index:-1;";
        probe.innerHTML = "<div class='card'><div class='card-header'>Header</div><button class='btn btn-primary' type='button'>Primary</button><button class='btn btn-secondary' type='button'>Secondary</button><input class='form-control'><select class='form-select'><option>Option</option></select><span class='text-muted'>Muted</span><span class='text-success'>Success</span><span class='text-warning'>Warning</span><span class='text-danger'>Danger</span><a href='#'>Link</a><div class='dropdown-menu show'><button class='dropdown-item'>Item</button></div></div>";
        appRoot.appendChild(probe);

        try {
            var htmlStyle = window.getComputedStyle(document.documentElement);
            var bodyStyle = window.getComputedStyle(document.body);
            var appStyle = window.getComputedStyle(appRoot);
            var card = window.getComputedStyle(probe.querySelector(".card"));
            var header = window.getComputedStyle(probe.querySelector(".card-header"));
            var primary = window.getComputedStyle(probe.querySelector(".btn-primary"));
            var input = window.getComputedStyle(probe.querySelector(".form-control"));
            var muted = window.getComputedStyle(probe.querySelector(".text-muted"));
            var link = window.getComputedStyle(probe.querySelector("a"));
            var menu = window.getComputedStyle(probe.querySelector(".dropdown-menu"));
            var success = window.getComputedStyle(probe.querySelector(".text-success"));
            var warning = window.getComputedStyle(probe.querySelector(".text-warning"));
            var danger = window.getComputedStyle(probe.querySelector(".text-danger"));
            function token(name, fallback) {
                return appStyle.getPropertyValue(name).trim() || bodyStyle.getPropertyValue(name).trim() || htmlStyle.getPropertyValue(name).trim() || fallback;
            }
            function resolveToken(name, property, fallback) {
                var sourceToken = token(name, "");
                if (!sourceToken) { return fallback; }
                var sample = document.createElement("span");
                sample.style.setProperty(property, "var(" + name + ")");
                probe.appendChild(sample);
                var value = window.getComputedStyle(sample).getPropertyValue(property).trim();
                var inheritedValue = window.getComputedStyle(probe).getPropertyValue(property).trim();
                sample.remove();
                if (!value || (property === "background-color" && isTransparent(value)) ||
                        (property === "border-radius" && value === "0px") ||
                        (property === "color" && /var\(/i.test(sourceToken) && value === inheritedValue && fallback !== value)) {
                    return fallback;
                }
                return value;
            }
            function visible(value, fallback) { return value && !isTransparent(value) ? value : fallback; }

            var bodySurface = visible(bodyStyle.backgroundColor, visible(htmlStyle.backgroundColor, "#151518"));
            var surface = resolveToken("--glass-bg", "background-color", visible(card.backgroundColor, bodySurface));
            var raised = resolveToken("--glass-bg-strong", "background-color", visible(menu.backgroundColor, visible(header.backgroundColor, surface)));
            var border = resolveToken("--glass-border", "border-color", visible(card.borderColor, alphaColor(bodyStyle.color, 0.18)));
            var text = resolveToken("--text", "color", visible(card.color, bodyStyle.color));
            var mutedText = resolveToken("--text-muted", "color", visible(muted.color, text));
            var accent = resolveToken("--accent", "color", visible(link.color, visible(primary.backgroundColor, "#0078d4")));
            var accentChannels = colorChannels(accent) || colorChannels(primary.backgroundColor);
            var accentRgbToken = token("--accent-rgb", "");
            var accentRgb = /^\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*$/.test(accentRgbToken)
                ? accentRgbToken : (accentChannels ? accentChannels.join(", ") : "0, 120, 212");
            var bright = resolveToken("--accent-bright", "color", visible(link.color, accent));
            var rootTokens = {
                "--ld-bg": resolveToken("--bg-0", "background-color", bodySurface),
                "--ld-surface": surface,
                "--ld-surface-strong": resolveToken("--glass-bg-strong", "background-color", raised),
                "--ld-border": border,
                "--ld-border-strong": resolveToken("--glass-border-bright", "border-color", alphaColor(border, 1.6)),
                "--ld-text": resolveToken("--text", "color", text),
                "--ld-muted": resolveToken("--text-muted", "color", mutedText),
                "--ld-subtle": alphaColor(mutedText, 0.76),
                "--ld-accent": accent,
                "--ld-accent-contrast": resolveToken("--accent-contrast", "color", visible(primary.color, "#fff")),
                "--ld-primary-bg": visible(primary.backgroundColor, accent),
                "--ld-primary-border": visible(primary.borderColor, visible(primary.backgroundColor, accent)),
                "--ld-primary-text": visible(primary.color, "#fff"),
                "--ld-accent-bright": bright,
                "--ld-accent-light": resolveToken("--accent-light", "color", bright),
                "--ld-accent-rgb": accentRgb,
                "--ld-accent-soft": resolveToken("--accent-tint", "background-color", alphaColor(accent, 0.16)),
                "--ld-green": visible(success.color, "#4cc38a"),
                "--ld-orange": visible(warning.color, "#f2a65a"),
                "--ld-red": visible(danger.color, "#f07575"),
                "--ld-radius": resolveToken("--radius", "border-radius", card.borderRadius || "14px"),
                "--ld-radius-sm": resolveToken("--radius-sm", "border-radius", input.borderRadius || "8px"),
                "--ld-font": resolveToken("--theme-font-stack", "font-family", card.fontFamily || bodyStyle.fontFamily),
                "--ld-button-font": primary.fontFamily || bodyStyle.fontFamily,
                "--ld-button-size": primary.fontSize || "0.875rem",
                "--ld-button-weight": primary.fontWeight || "650",
                "--ld-button-line-height": primary.lineHeight || "normal",
                "--ld-button-radius": primary.borderRadius || "9px"
            };
            var scheme = bodyStyle.colorScheme || htmlStyle.colorScheme;
            if (scheme !== "dark" && scheme !== "light") {
                var backgroundChannels = colorChannels(bodySurface);
                var brightness = backgroundChannels ? (0.2126 * backgroundChannels[0] + 0.7152 * backgroundChannels[1] + 0.0722 * backgroundChannels[2]) / 255 : 0;
                scheme = brightness > 0.56 ? "light" : "dark";
            }
            var snapshot = JSON.stringify({ version: 1, colorScheme: scheme, tokens: rootTokens });
            if (localStorage.getItem(HOST_THEME_KEY) !== snapshot) { localStorage.setItem(HOST_THEME_KEY, snapshot); }
        } catch (error) {
            /* If host styles cannot be sampled, retain the last valid theme snapshot. */
        } finally {
            probe.remove();
        }
    }

    var themeSyncTimer = 0;
    function scheduleThemeSync() {
        window.clearTimeout(themeSyncTimer);
        themeSyncTimer = window.setTimeout(syncHostTheme, 120);
    }

    function findUtilityButtons() {
        return document.querySelector("nav.top-nav .navbar-buttons") ||
            document.querySelector("nav.navbar .navbar-buttons");
    }

    function registerDashboardRoute() {
        var api = window.PluginApi;
        if (!api || !api.React || !api.register || typeof api.register.route !== "function") { return false; }
        api.register.route(APP_ROUTE, function () {
            return api.React.createElement("iframe", {
                src: DASHBOARD_URL,
                title: "Library Doctor",
                className: "library-doctor-dashboard-frame",
                style: { display: "block", width: "100%", height: "calc(100vh - 60px)", minHeight: "540px", border: "0", background: "transparent" }
            });
        });
        if (window.location.pathname === APP_ROUTE) {
            window.setTimeout(function () { window.dispatchEvent(new PopStateEvent("popstate")); }, 50);
        }
        return true;
    }

    function syncEntryActiveState(link) {
        var active = window.location.pathname === APP_ROUTE || window.location.pathname.indexOf(APP_ROUTE + "/") === 0;
        link.classList.toggle("stash-nav-active", active);
        if (active) { link.setAttribute("aria-current", "page"); }
        else { link.removeAttribute("aria-current"); }
    }

    function ensureEntry() {
        if (!document.body || location.pathname.indexOf("/plugin/library-doctor/") === 0) {
            return false;
        }
        var buttons = findUtilityButtons();
        if (!buttons) { return false; }
        var link = document.getElementById(ENTRY_ID);
        if (!link) {
            /* Store the host's computed theme before the embedded dashboard loads. */
            syncHostTheme();
            link = document.createElement("a");
            link.id = ENTRY_ID;
            link.innerHTML = ICON;
        }
        link.className = "btn btn-secondary minimal nav-utility";
        link.href = APP_ROUTE;
        link.removeAttribute("target");
        link.removeAttribute("rel");
        link.title = "Open Library Doctor health checks";
        link.setAttribute("aria-label", "Library Doctor");
        link.style.order = "89";
        syncEntryActiveState(link);
        if (link.getAttribute("data-in-app-route-bound") !== "true") {
            window.addEventListener("popstate", function () { syncEntryActiveState(link); });
            link.addEventListener("click", function (event) {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
                event.preventDefault();
                window.history.pushState({}, "", APP_ROUTE);
                syncEntryActiveState(link);
                window.dispatchEvent(new PopStateEvent("popstate"));
            });
            link.setAttribute("data-in-app-route-bound", "true");
        }

        /* Place the action beside Settings in the utility controls instead of
           among the primary library routes. */
        if (link.parentElement !== buttons) {
            var settings = buttons.querySelector('a[href="/settings"]');
            if (settings) { buttons.insertBefore(link, settings); }
            else { buttons.appendChild(link); }
        }
        return true;
    }

    function start() {
        if (!document.body) { return; }
        registerDashboardRoute();
        syncHostTheme();
        ensureEntry();
        if (typeof MutationObserver === "undefined") { return; }
        var observer = new MutationObserver(function (records) {
            var navChanged = false;
            for (var i = 0; i < records.length && !navChanged; i++) {
                var record = records[i];
                var target = record.target;
                if (target.nodeType === 1 && target.closest && target.closest("nav.top-nav, nav.navbar")) {
                    navChanged = true;
                    break;
                }
                for (var j = 0; j < record.addedNodes.length; j++) {
                    var node = record.addedNodes[j];
                    if (node.nodeType !== 1) { continue; }
                    if ((node.matches && node.matches("nav.top-nav, nav.navbar")) ||
                            (node.querySelector && node.querySelector("nav.top-nav, nav.navbar"))) {
                        navChanged = true;
                        break;
                    }
                }
            }
            if (navChanged) { ensureEntry(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        var themeObserver = new MutationObserver(function (records) {
            scheduleThemeSync();
            for (var i = 0; i < records.length; i++) {
                var record = records[i];
                for (var j = 0; j < record.addedNodes.length; j++) {
                    var node = record.addedNodes[j];
                    if (node.nodeType === 1 && node.tagName === "LINK" && node.rel === "stylesheet") {
                        node.addEventListener("load", scheduleThemeSync);
                    }
                }
            }
        });
        var themeAttributes = {
            attributes: true,
            attributeFilter: ["class", "style", "data-theme", "data-current-theme", "data-current-mode", "data-current-accent", "data-current-card-style"]
        };
        themeObserver.observe(document.documentElement, themeAttributes);
        themeObserver.observe(document.body, themeAttributes);
        var appRoot = document.getElementById("root");
        if (appRoot) { themeObserver.observe(appRoot, themeAttributes); }
        if (document.head) {
            themeObserver.observe(document.head, {
                attributes: true,
                attributeFilter: ["disabled", "href", "media"],
                childList: true,
                characterData: true,
                subtree: true
            });
        }
        window.addEventListener("load", scheduleThemeSync);
        window.addEventListener("current-theme:preferences-changed", scheduleThemeSync);
        if (window.matchMedia) {
            var colorScheme = window.matchMedia("(prefers-color-scheme: light)");
            if (colorScheme.addEventListener) { colorScheme.addEventListener("change", scheduleThemeSync); }
            else if (colorScheme.addListener) { colorScheme.addListener(scheduleThemeSync); }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
}());
