(function () {
    "use strict";

    var PAGE_SIZE = 50;
    var SCAN_PAGE_SIZE = 200;
    var QUERY = "query LibraryDoctorScenes($page: Int!, $perPage: Int!) { " +
        "findScenes(filter: { page: $page, per_page: $perPage, sort: \"title\", direction: ASC }) { " +
        "count scenes { id title date organized files { id path size duration } " +
        "paths { screenshot preview } studio { id name } performers { id name } tags { id name } } } }";
    var CATEGORY_ORDER = ["files", "metadata", "generated", "organization", "review"];
    var CATEGORY_LABELS = {
        files: "File reference",
        metadata: "Metadata",
        generated: "Generated file",
        organization: "Organization",
        review: "Review"
    };
    var results = [];
    var currentFilter = "all";
    var currentPage = 1;
    var scanController = null;
    var completeScan = false;
    var lastScanDate = null;
    var els = {};

    var ACCENTS = {
        orange: "#d83b01", blue: "#0078d4", pink: "#e3008c", red: "#d13438",
        yellow: "#f2c811", purple: "#8764b8", green: "#107c10", teal: "#038387"
    };

    function byId(id) { return document.getElementById(id); }

    function setAccent() {
        try {
            var key = localStorage.getItem("fluent-mica.accent");
            if (key && ACCENTS[key]) {
                document.documentElement.style.setProperty("--ld-accent", ACCENTS[key]);
                var rgb = ACCENTS[key].match(/[0-9a-f]{2}/gi).map(function (v) { return parseInt(v, 16); }).join(", ");
                document.documentElement.style.setProperty("--ld-accent-soft", "rgba(" + rgb + ", 0.16)");
            }
        } catch (e) { /* the default Fluent blue remains usable */ }
    }

    function queryScenes(page, signal) {
        return fetch("/graphql", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: QUERY,
                variables: { page: page, perPage: SCAN_PAGE_SIZE }
            })
        }).then(function (response) {
            return response.text().then(function (text) {
                var payload;
                try { payload = JSON.parse(text); }
                catch (e) { throw new Error("Stash returned an unreadable response. Make sure you are signed in and try again."); }
                if (!response.ok) {
                    var httpMessage = payload && payload.errors && payload.errors[0] && payload.errors[0].message;
                    throw new Error(httpMessage || ("Stash returned HTTP " + response.status + "."));
                }
                if (payload.errors && payload.errors.length) {
                    throw new Error(payload.errors.map(function (item) { return item.message; }).join(" "));
                }
                if (!payload.data || !payload.data.findScenes) {
                    throw new Error("Stash did not return scene data. Check the plugin log or reload Stash.");
                }
                return payload.data.findScenes;
            });
        });
    }

    function addIssue(scene, label, kind) {
        scene._doctorIssues.push({ label: label, kind: kind });
    }

    function inspectScene(source) {
        var scene = {
            id: String(source.id || ""),
            title: String(source.title || "").trim(),
            date: String(source.date || "").trim(),
            organized: source.organized,
            studio: source.studio && source.studio.name ? String(source.studio.name).trim() : "",
            performers: Array.isArray(source.performers) ? source.performers.map(function (p) { return p && p.name ? String(p.name).trim() : ""; }).filter(Boolean) : [],
            tags: Array.isArray(source.tags) ? source.tags.length : 0,
            files: Array.isArray(source.files) ? source.files : [],
            paths: source.paths || {},
            _doctorIssues: []
        };
        if (!scene.files.some(function (file) { return file && String(file.path || "").trim(); })) {
            addIssue(scene, "No file reference", "files");
        }
        if (!scene.title) { addIssue(scene, "Missing title", "metadata"); }
        if (!scene.date) { addIssue(scene, "Missing date", "metadata"); }
        if (!scene.performers.length) { addIssue(scene, "No performers", "metadata"); }
        if (!scene.studio) { addIssue(scene, "No studio", "metadata"); }
        if (!scene.tags) { addIssue(scene, "No tags", "metadata"); }
        if (!scene.paths.screenshot) { addIssue(scene, "No screenshot", "generated"); }
        if (!scene.paths.preview) { addIssue(scene, "No preview", "generated"); }
        if (scene.organized === false) { addIssue(scene, "Unorganized", "organization"); }
        return scene;
    }

    function normalizeTitle(title) {
        return String(title || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    }

    function markRepeatedTitles(items) {
        var byTitle = Object.create(null);
        items.forEach(function (scene) {
            var key = normalizeTitle(scene.title);
            if (!key) { return; }
            if (!byTitle[key]) { byTitle[key] = []; }
            byTitle[key].push(scene);
        });
        Object.keys(byTitle).forEach(function (key) {
            if (byTitle[key].length < 2) { return; }
            byTitle[key].forEach(function (scene) {
                addIssue(scene, "Repeated title · review", "review");
            });
        });
    }

    function setProgress(percent, detail) {
        var value = Math.max(0, Math.min(100, Math.round(percent)));
        els.progressBar.style.width = value + "%";
        els.progressTrack.setAttribute("aria-valuenow", String(value));
        if (detail) { els.progressDetail.textContent = detail; }
    }

    function showError(message) {
        els.error.textContent = message;
        els.error.hidden = false;
    }

    function clearError() {
        els.error.textContent = "";
        els.error.hidden = true;
    }

    function setScanning(scanning) {
        els.scan.disabled = scanning;
        els.export.disabled = scanning || !results.length;
        els.cancel.hidden = !scanning;
        els.progressCard.hidden = !scanning;
        if (!scanning) { scanController = null; }
    }

    function scan() {
        if (scanController) { return; }
        scanController = new AbortController();
        var controller = scanController;
        var collected = [];
        var total = 0;
        var page = 1;
        completeScan = false;
        results = [];
        currentPage = 1;
        els.summary.hidden = true;
        els.findings.hidden = true;
        els.emptyState.hidden = true;
        els.scanTitle.textContent = "Checking scenes…";
        els.progressCard.hidden = false;
        els.cancel.hidden = false;
        els.scan.disabled = true;
        els.export.disabled = true;
        clearError();
        setProgress(0, "Connecting to Stash");
        els.rows.replaceChildren();

        function loadPage() {
            return queryScenes(page, controller.signal).then(function (pageData) {
                total = Number(pageData.count) || 0;
                var scenes = Array.isArray(pageData.scenes) ? pageData.scenes : [];
                scenes.forEach(function (item) { collected.push(inspectScene(item)); });
                els.scanTitle.textContent = "Checking scenes…";
                if (total === 0) {
                    setProgress(100, "No scenes found");
                    return finish(true);
                }
                var loaded = Math.min(collected.length, total);
                setProgress((loaded / total) * 100, "Checked " + loaded.toLocaleString() + " of " + total.toLocaleString() + " scenes");
                if (!scenes.length || collected.length >= total) {
                    return finish(true);
                }
                page += 1;
                return new Promise(function (resolve) { window.setTimeout(resolve, 0); }).then(loadPage);
            });
        }

        function finish(isComplete) {
            markRepeatedTitles(collected);
            results = collected;
            completeScan = isComplete;
            lastScanDate = new Date();
            setProgress(100, (isComplete ? "Finished checking " : "Stopped after checking ") + collected.length.toLocaleString() + " scenes");
            els.progressCard.hidden = true;
            setScanning(false);
            render();
            if (!collected.length && isComplete) {
                els.findings.hidden = true;
                els.summary.hidden = false;
                els.emptyState.hidden = false;
                els.emptyState.querySelector(".ld-eyebrow").textContent = "LIBRARY CHECK COMPLETE";
                els.emptyState.querySelector("h2").textContent = "No scenes found yet.";
                els.emptyState.querySelector("p:not(.ld-eyebrow)").textContent = "Add or scan media in Stash, then run Library Doctor again.";
                els.emptyState.querySelector("[data-start-scan]").hidden = true;
            }
        }

        loadPage().catch(function (error) {
            if (error && error.name === "AbortError") {
                markRepeatedTitles(collected);
                results = collected;
                completeScan = false;
                scanController = null;
                if (collected.length) {
                    lastScanDate = new Date();
                    render();
                    els.scanTitle.textContent = "Scan stopped";
                    els.progressDetail.textContent = "Partial results include " + collected.length.toLocaleString() + " scenes.";
                    els.progressBar.style.width = "100%";
                    els.progressTrack.setAttribute("aria-valuenow", "100");
                    els.progressCard.hidden = false;
                    els.cancel.hidden = true;
                    els.scan.disabled = false;
                } else {
                    setScanning(false);
                    els.progressCard.hidden = true;
                    els.emptyState.hidden = false;
                }
                return;
            }
            setScanning(false);
            els.progressCard.hidden = true;
            showError("Library check failed: " + (error && error.message ? error.message : String(error)));
            if (collected.length) {
                results = collected;
                lastScanDate = new Date();
                render();
            } else {
                els.emptyState.hidden = false;
            }
        });
    }

    function categoryCounts() {
        var counts = { all: results.filter(function (s) { return s._doctorIssues.length > 0; }).length };
        CATEGORY_ORDER.forEach(function (category) {
            counts[category] = results.filter(function (scene) {
                return scene._doctorIssues.some(function (issue) { return issue.kind === category; });
            }).length;
        });
        return counts;
    }

    function currentItems() {
        var query = els.search.value.trim().toLocaleLowerCase();
        return results.filter(function (scene) {
            if (!scene._doctorIssues.length) { return false; }
            if (currentFilter !== "all" && !scene._doctorIssues.some(function (issue) { return issue.kind === currentFilter; })) { return false; }
            if (!query) { return true; }
            var haystack = [scene.title, scene.studio, scene.date, scene.performers.join(" "), scene._doctorIssues.map(function (i) { return i.label; }).join(" ")].join(" ").toLocaleLowerCase();
            return haystack.indexOf(query) !== -1;
        });
    }

    function makeCell(label, className) {
        var cell = document.createElement("td");
        cell.dataset.label = label;
        if (className) { cell.className = className; }
        return cell;
    }

    function makeSceneRow(scene) {
        var row = document.createElement("tr");
        var sceneCell = makeCell("Scene");
        var title = document.createElement("span");
        title.className = "ld-scene-title";
        title.textContent = scene.title || "Untitled scene";
        var meta = document.createElement("span");
        meta.className = "ld-scene-meta";
        meta.textContent = scene.performers.length ? scene.performers.join(", ") : "No performers listed";
        sceneCell.append(title, meta);

        var studioCell = makeCell("Studio");
        studioCell.textContent = scene.studio || "—";
        var dateCell = makeCell("Date");
        dateCell.textContent = scene.date || "—";
        var issueCell = makeCell("Findings");
        var issueList = document.createElement("div");
        issueList.className = "ld-issue-list";
        scene._doctorIssues.forEach(function (issue) {
            var chip = document.createElement("span");
            chip.className = "ld-issue-chip";
            chip.dataset.kind = issue.kind;
            chip.textContent = issue.label;
            chip.title = CATEGORY_LABELS[issue.kind] || issue.kind;
            issueList.appendChild(chip);
        });
        issueCell.appendChild(issueList);

        var openCell = makeCell("Open");
        var open = document.createElement("a");
        open.className = "ld-open-scene";
        open.href = "/scenes/" + encodeURIComponent(scene.id);
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.setAttribute("aria-label", "Open " + (scene.title || "scene") + " in Stash");
        open.innerHTML = "Open <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M14 4h6v6M20 4l-9 9'/><path d='M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'/></svg>";
        openCell.appendChild(open);
        row.append(sceneCell, studioCell, dateCell, issueCell, openCell);
        return row;
    }

    function renderFilters() {
        var counts = categoryCounts();
        els.filters.querySelectorAll(".ld-filter").forEach(function (button) {
            var name = button.dataset.filter;
            var count = button.querySelector("span");
            if (count) { count.textContent = String(counts[name] || 0); }
            button.classList.toggle("is-active", name === currentFilter);
            button.setAttribute("aria-pressed", name === currentFilter ? "true" : "false");
        });
    }

    function render() {
        var flagged = results.filter(function (scene) { return scene._doctorIssues.length > 0; });
        var fileFlags = results.filter(function (scene) { return scene._doctorIssues.some(function (i) { return i.kind === "files"; }); }).length;
        var metadataFlags = results.filter(function (scene) { return scene._doctorIssues.some(function (i) { return i.kind === "metadata"; }); }).length;
        els.countScenes.textContent = results.length.toLocaleString();
        els.countFlagged.textContent = flagged.length.toLocaleString();
        els.countFiles.textContent = fileFlags.toLocaleString();
        els.countMetadata.textContent = metadataFlags.toLocaleString();
        els.summary.hidden = false;
        els.emptyState.hidden = true;
        els.findings.hidden = false;
        els.export.disabled = !results.length;
        els.scanTitle.textContent = completeScan ? "Check complete" : "Partial results";
        if (lastScanDate) {
            els.scanTime.textContent = (completeScan ? "Completed " : "Partial scan · ") + lastScanDate.toLocaleString();
        }
        renderFilters();

        var filtered = currentItems();
        var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        currentPage = Math.min(currentPage, pages);
        var start = (currentPage - 1) * PAGE_SIZE;
        var visible = filtered.slice(start, start + PAGE_SIZE);
        els.rows.replaceChildren.apply(els.rows, visible.map(makeSceneRow));
        els.emptyResults.hidden = visible.length > 0;
        var emptyTitle = els.emptyResults.querySelector("strong");
        var emptyMessage = els.emptyResults.querySelector("span:last-child");
        if (!flagged.length && currentFilter === "all" && !els.search.value.trim()) {
            emptyTitle.textContent = "No issues found";
            emptyMessage.textContent = "Your scanned scenes passed these checks.";
        } else {
            emptyTitle.textContent = "No scenes match this view";
            emptyMessage.textContent = "Try another filter or search term.";
        }
        els.resultRange.textContent = filtered.length
            ? (start + 1).toLocaleString() + "–" + Math.min(start + PAGE_SIZE, filtered.length).toLocaleString() + " of " + filtered.length.toLocaleString() + " scenes"
            : "0 scenes";
        els.pageStatus.textContent = currentPage + " of " + pages;
        els.pagePrev.disabled = currentPage <= 1;
        els.pageNext.disabled = currentPage >= pages;
    }

    function exportCsv() {
        var flagged = results.filter(function (scene) { return scene._doctorIssues.length > 0; });
        var lines = [["Scene ID", "Title", "Date", "Studio", "Performers", "Findings"]];
        flagged.forEach(function (scene) {
            lines.push([
                scene.id,
                scene.title,
                scene.date,
                scene.studio,
                scene.performers.join("; "),
                scene._doctorIssues.map(function (issue) { return issue.label; }).join("; ")
            ]);
        });
        var csv = lines.map(function (row) {
            return row.map(function (field) {
                var value = String(field == null ? "" : field);
                /* Spreadsheet apps may interpret metadata beginning with a
                   formula marker even when it is CSV-quoted. Neutralize that
                   input before writing a review export. */
                if (/^[\t\r\n ]*[=+\-@]/.test(value)) { value = "'" + value; }
                return '"' + value.replace(/"/g, '""') + '"';
            }).join(",");
        }).join("\r\n");
        var blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "stash-library-doctor-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function bind() {
        els = {
            scan: byId("ld-scan"), export: byId("ld-export"), cancel: byId("ld-cancel"),
            progressCard: byId("ld-progress-card"), progressTitle: byId("ld-progress-title"),
            progressDetail: byId("ld-progress-detail"), progressTrack: document.querySelector(".ld-progress-track"),
            progressBar: byId("ld-progress-bar"), error: byId("ld-error"), summary: byId("ld-summary"),
            findings: byId("ld-findings"), emptyState: byId("ld-empty-state"), emptyResults: byId("ld-empty-results"),
            rows: byId("ld-rows"), filters: byId("ld-filters"), search: byId("ld-search"),
            countScenes: byId("ld-count-scenes"), countFlagged: byId("ld-count-flagged"),
            countFiles: byId("ld-count-files"), countMetadata: byId("ld-count-metadata"),
            scanTitle: byId("ld-progress-title"), scanTime: byId("ld-scan-time"), resultRange: byId("ld-result-range"),
            pageStatus: byId("ld-page-status"), pagePrev: byId("ld-page-prev"), pageNext: byId("ld-page-next")
        };
        els.scan.addEventListener("click", scan);
        document.querySelectorAll("[data-start-scan]").forEach(function (button) { button.addEventListener("click", scan); });
        els.cancel.addEventListener("click", function () { if (scanController) { scanController.abort(); } });
        els.export.addEventListener("click", exportCsv);
        els.filters.addEventListener("click", function (event) {
            var button = event.target.closest(".ld-filter");
            if (!button) { return; }
            currentFilter = button.dataset.filter || "all";
            currentPage = 1;
            render();
        });
        els.search.addEventListener("input", function () { currentPage = 1; render(); });
        els.pagePrev.addEventListener("click", function () { if (currentPage > 1) { currentPage--; render(); } });
        els.pageNext.addEventListener("click", function () { currentPage++; render(); });
    }

    setAccent();
    bind();
}());
