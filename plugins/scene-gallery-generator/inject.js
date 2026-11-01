/* Adds a utility button beside Settings and opens the generator in its own tab. */
(function () {
    "use strict";
    var ENTRY_ID = "scene-gallery-generator-nav-entry";
    var URL = "/plugin/scene-gallery-generator/assets/index.html";
    var ICON = "<svg viewBox='0 0 24 24' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><rect x='3.5' y='4.5' width='17' height='15' rx='2'/><path d='m4.5 16 4.5-4.5 3.2 3.2 2.3-2.3 5 5M8 8.5h.01'/><path d='M12 2v4M10 4h4'/></svg>";

    function getButtons() {
        return document.querySelector("nav.top-nav .navbar-buttons") ||
            document.querySelector("nav.navbar .navbar-buttons");
    }

    function insertButton() {
        if (!document.body || location.pathname.indexOf("/plugin/scene-gallery-generator/") === 0) return false;
        var buttons = getButtons();
        if (!buttons) return false;
        var link = document.getElementById(ENTRY_ID);
        if (link && link.parentElement === buttons) return true;
        if (!link) {
            link = document.createElement("a");
            link.id = ENTRY_ID;
            link.className = "btn btn-secondary minimal nav-utility";
            link.href = URL;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.title = "Generate scene galleries";
            link.setAttribute("aria-label", "Scene Gallery Generator");
            link.style.order = "89";
            link.innerHTML = ICON;
        }
        var settings = buttons.querySelector('a[href="/settings"]');
        if (settings) buttons.insertBefore(link, settings);
        else buttons.appendChild(link);
        return true;
    }

    function start() {
        if (!document.body) return;
        insertButton();
        if (typeof MutationObserver === "undefined") return;
        var observer = new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var target = records[i].target;
                if (target.nodeType === 1 && target.closest && target.closest("nav.top-nav, nav.navbar")) {
                    insertButton();
                    return;
                }
                for (var j = 0; j < records[i].addedNodes.length; j++) {
                    var node = records[i].addedNodes[j];
                    if (node.nodeType === 1 && ((node.matches && node.matches("nav.top-nav, nav.navbar")) ||
                            (node.querySelector && node.querySelector("nav.top-nav, nav.navbar")))) {
                        insertButton();
                        return;
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
}());
