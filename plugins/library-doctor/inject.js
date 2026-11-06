/* Adds a Library Doctor utility button beside the other right-side navbar
   actions. The dashboard is served as a standalone same-origin plugin asset
   page, so opening it does not interfere with Stash's React route state. */
(function () {
    "use strict";

    var ENTRY_ID = "library-doctor-nav-entry";
    var DASHBOARD_URL = "/plugin/library-doctor/assets/index.html";
    var HOST_THEME_KEY = "library-doctor.host-theme.v1";
    var ICON = "<svg viewBox='0 0 24 24' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M7 3.8h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5.3a1.5 1.5 0 0 1 1-1.5Z'/><path d='M14 4v4h4M9 13h6M9 16h3'/><path d='m14.5 17 1.2 1.2 2.5-2.6'/></svg>";

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

    function ensureEntry() {
        if (!document.body || location.pathname.indexOf("/plugin/library-doctor/") === 0) {
            return false;
        }
        var buttons = findUtilityButtons();
        if (!buttons || document.getElementById(ENTRY_ID)) { return false; }

        /* The dashboard opens in a standalone document, so store the host's
           computed theme before navigating to it. */
        syncHostTheme();

        var link = document.createElement("a");
        link.id = ENTRY_ID;
        link.className = "btn btn-secondary minimal nav-utility";
        link.href = DASHBOARD_URL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = "Audit library metadata and generated files";
        link.setAttribute("aria-label", "Library Doctor");
        link.style.order = "89";
        link.innerHTML = ICON;

        /* Place the action beside Settings in the utility controls instead of
           among the primary library routes. */
        var settings = buttons.querySelector('a[href="/settings"]');
        if (settings) {
            buttons.insertBefore(link, settings);
        } else {
            buttons.appendChild(link);
        }
        return true;
    }

    function start() {
        if (!document.body) { return; }
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
