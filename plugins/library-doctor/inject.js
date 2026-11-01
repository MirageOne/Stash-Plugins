/* Adds a Library Doctor utility button beside the other right-side navbar
   actions. The dashboard is served as a standalone same-origin plugin asset
   page, so opening it does not interfere with Stash's React route state. */
(function () {
    "use strict";

    var ENTRY_ID = "library-doctor-nav-entry";
    var DASHBOARD_URL = "/plugin/library-doctor/assets/index.html";
    var ICON = "<svg viewBox='0 0 24 24' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M7 3.8h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5.3a1.5 1.5 0 0 1 1-1.5Z'/><path d='M14 4v4h4M9 13h6M9 16h3'/><path d='m14.5 17 1.2 1.2 2.5-2.6'/></svg>";

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

        /* Fluent Mica orders Settings at 90, so this sits directly beside it.
           In stock Stash the high flex order keeps it with the right-side
           utility controls instead of the primary library routes. */
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
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
}());
