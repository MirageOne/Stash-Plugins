(function () {
    "use strict";

    var PAGE_SIZE = 50;
    var SCAN_PAGE_SIZE = 200;
    var REVIEWED_DUPLICATES_KEY = "library-doctor.reviewedDuplicates";
    var FRESH_SCENE_QUERY = "query LibraryDoctorFreshScene($id: ID!) { findScene(id: $id) { id title date } }";
    var UPDATE_SCENE_MUTATION = "mutation LibraryDoctorUpdateScene($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id title date } }";
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
        review: "Duplicate / version"
    };
    var results = [];
    var currentFilter = "all";
    var currentWorkspace = "health";
    var currentPage = 1;
    var scanController = null;
    var completeScan = false;
    var lastScanDate = null;
    var pendingFixScene = null;
    var applyingFix = false;
    var undoingFix = false;
    var undoStack = [];
    var reviewedDuplicateKeys = loadReviewedDuplicateKeys();
    var showReviewedDuplicates = false;
    var els = {};

    var ACCENTS = {
        orange: "#d83b01", blue: "#0078d4", pink: "#e3008c", red: "#d13438",
        yellow: "#f2c811", purple: "#8764b8", green: "#107c10", teal: "#038387"
    };

    function byId(id) { return document.getElementById(id); }

    function loadReviewedDuplicateKeys() {
        try {
            var value = JSON.parse(localStorage.getItem(REVIEWED_DUPLICATES_KEY) || "{}");
            return value && typeof value === "object" && !Array.isArray(value) ? value : {};
        } catch (e) { return {}; }
    }

    function fileBasename(path) {
        var value = String(path || "").split(/[\\/]/).pop() || "";
        try { value = decodeURIComponent(value); } catch (e) { /* retain original */ }
        return value;
    }

    function suggestTitleFromPath(path) {
        var source = fileBasename(path);
        if (!source) { return null; }
        var value = source.replace(/\.[^.]+$/, "");
        value = value.replace(/(?:^|[^\d])(?:19|20)\d{2}[-_.]?\d{2}[-_.]?\d{2}(?=$|[^\d])/g, " ");
        value = value.replace(/^\[[^\]]+\]\s*/, "").replace(/[._]+/g, " ").replace(/\s*-\s*/g, " ").replace(/[()[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
        if (!value || value.length < 2 || value.length > 120 || !/\p{L}/u.test(value)) { return null; }
        if (/^(?:IMG|VID|DSC|PXL|MOV|MVI|CAM|GOPR|DJI)[-_ ]?\d+$/i.test(value)) { return null; }
        if (/^[a-f0-9]{24,}$/i.test(value.replace(/\s+/g, ""))) { return null; }
        return { value: value, source: source };
    }

    function suggestDateFromPath(path) {
        var source = fileBasename(path);
        var value = String(path || "");
        var match = value.match(/(?:^|[^\d])((?:19|20)\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?:[^\d]|$)/);
        if (!match) { match = value.match(/(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?:[^\d]|$)/); }
        if (!match) { return null; }
        var date = match[1] + "-" + ("0" + match[2]).slice(-2) + "-" + ("0" + match[3]).slice(-2);
        return validDate(date) ? { value: date, source: source } : null;
    }

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

    function graphQLRequest(query, variables) {
        return fetch("/graphql", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query, variables: variables })
        }).then(function (response) {
            return response.text().then(function (text) {
                var payload;
                try { payload = JSON.parse(text); }
                catch (e) { throw new Error("Stash returned an unreadable response. Reload the page and try again."); }
                if (!response.ok) {
                    var httpMessage = payload && payload.errors && payload.errors[0] && payload.errors[0].message;
                    throw new Error(httpMessage || ("Stash returned HTTP " + response.status + "."));
                }
                if (payload.errors && payload.errors.length) {
                    throw new Error(payload.errors.map(function (item) { return item.message; }).join(" "));
                }
                if (!payload.data) { throw new Error("Stash did not confirm the requested change."); }
                return payload.data;
            });
        });
    }

    function addIssue(scene, label, kind) {
        scene._doctorIssues.push({ label: label, kind: kind });
    }

    function inspectScene(source) {
        var files = Array.isArray(source.files) ? source.files : [];
        var firstPath = files[0] && files[0].path ? String(files[0].path) : "";
        var title = String(source.title || "").trim();
        var date = String(source.date || "").trim();
        var scene = {
            id: String(source.id || ""),
            title: title,
            date: date,
            titleSuggestion: title ? null : suggestTitleFromPath(firstPath),
            dateSuggestion: date ? null : suggestDateFromPath(firstPath),
            organized: source.organized,
            studio: source.studio && source.studio.name ? String(source.studio.name).trim() : "",
            performers: Array.isArray(source.performers) ? source.performers.map(function (p) { return p && p.name ? String(p.name).trim() : ""; }).filter(Boolean) : [],
            tags: Array.isArray(source.tags) ? source.tags.length : 0,
            files: files,
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
                addIssue(scene, "Repeated title · compare", "review");
            });
        });
    }

    function duplicateMetadataSignature(scene) {
        return [
            normalizeTitle(scene.studio),
            String(scene.date || "").trim(),
            scene.performers.map(normalizeTitle).sort().join(",")
        ].join("|");
    }

    function fileMetricsClose(scenes, property, relativeLimit, absoluteLimit) {
        var values = scenes.map(function (scene) {
            var file = scene.files[0];
            var value = file ? Number(file[property]) : NaN;
            return isFinite(value) && value > 0 ? value : null;
        });
        if (values.some(function (value) { return value === null; })) { return false; }
        var min = Math.min.apply(Math, values);
        var max = Math.max.apply(Math, values);
        return max - min <= Math.max(max * relativeLimit, absoluteLimit || 0);
    }

    function fileMetricsDiffer(scenes, property, relativeLimit) {
        var values = scenes.map(function (scene) {
            var file = scene.files[0];
            var value = file ? Number(file[property]) : NaN;
            return isFinite(value) && value > 0 ? value : null;
        });
        if (values.some(function (value) { return value === null; })) { return false; }
        var min = Math.min.apply(Math, values);
        var max = Math.max.apply(Math, values);
        return max - min > max * relativeLimit;
    }

    function classifyDuplicateGroup(scenes) {
        var signatures = scenes.map(duplicateMetadataSignature);
        var hasMetadata = scenes.some(function (scene) {
            return !!(scene.studio || scene.date || scene.performers.length);
        });
        var sameMetadata = hasMetadata && signatures.every(function (signature) { return signature === signatures[0]; });
        var similarDuration = sameMetadata && fileMetricsClose(scenes, "duration", 0.03, 1);
        if (similarDuration && fileMetricsClose(scenes, "size", 0.02, 0)) {
            return {
                label: "Possible duplicate copies",
                explanation: "Title, scene details, duration, and file size are very close. Compare the files and paths before deciding."
            };
        }
        if (similarDuration && fileMetricsDiffer(scenes, "size", 0.10)) {
            return {
                label: "Possible alternate versions",
                explanation: "Title and scene details match, durations are close, and file sizes differ. These may be alternate encodes."
            };
        }
        return {
            label: "Repeated title · compare",
            explanation: "The title matches, while other details differ or are unavailable. Review each scene before grouping or changing anything."
        };
    }

    function buildDuplicateGroups(items) {
        var byTitle = Object.create(null);
        items.forEach(function (scene) {
            var key = normalizeTitle(scene.title);
            if (!key) { return; }
            if (!byTitle[key]) { byTitle[key] = []; }
            byTitle[key].push(scene);
        });
        return Object.keys(byTitle).filter(function (key) { return byTitle[key].length > 1; }).map(function (key) {
            var scenes = byTitle[key].slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
            var classification = classifyDuplicateGroup(scenes);
            return {
                key: scenes.map(function (scene) { return scene.id; }).join(","),
                title: scenes[0].title,
                scenes: scenes,
                label: classification.label,
                explanation: classification.explanation,
                reviewed: !!reviewedDuplicateKeys[scenes.map(function (scene) { return scene.id; }).join(",")]
            };
        });
    }

    function saveReviewedDuplicateKeys() {
        try { localStorage.setItem(REVIEWED_DUPLICATES_KEY, JSON.stringify(reviewedDuplicateKeys)); }
        catch (e) { /* review marks still work for this page session */ }
    }

    function formatBytes(bytes) {
        var value = Number(bytes);
        if (!isFinite(value) || value <= 0) { return "size unknown"; }
        var units = ["B", "KB", "MB", "GB", "TB"];
        var index = 0;
        while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
        return value.toFixed(index === 0 ? 0 : 1) + " " + units[index];
    }

    function formatDuration(seconds) {
        var value = Number(seconds);
        if (!isFinite(value) || value <= 0) { return "duration unknown"; }
        value = Math.round(value);
        var hours = Math.floor(value / 3600);
        var minutes = Math.floor((value % 3600) / 60);
        var remainder = value % 60;
        return hours
            ? hours + ":" + ("0" + minutes).slice(-2) + ":" + ("0" + remainder).slice(-2)
            : minutes + ":" + ("0" + remainder).slice(-2);
    }

    function renderDuplicateGroups() {
        var groups = buildDuplicateGroups(results);
        els.duplicateReview.hidden = false;
        var reviewedCount = groups.filter(function (group) { return group.reviewed; }).length;
        els.duplicateCount.textContent = groups.length.toLocaleString();
        els.duplicateToggle.textContent = showReviewedDuplicates ? "Show unreviewed" : "Show reviewed (" + reviewedCount.toLocaleString() + ")";
        els.duplicateToggle.setAttribute("aria-pressed", showReviewedDuplicates ? "true" : "false");
        var visibleGroups = groups.filter(function (group) { return group.reviewed === showReviewedDuplicates; });
        if (!groups.length) {
            els.duplicateGroups.replaceChildren();
            els.duplicateEmpty.textContent = results.length
                ? "No matching titles were found in this health check."
                : (lastScanDate ? "No scenes were found in the latest health check." : "Run Health Check to look for matching titles.");
            els.duplicateEmpty.hidden = false;
            return;
        }
        els.duplicateEmpty.textContent = showReviewedDuplicates
            ? "No reviewed groups are available yet."
            : "All current candidates have been reviewed. Show reviewed groups to revisit them.";
        els.duplicateGroups.replaceChildren.apply(els.duplicateGroups, visibleGroups.map(function (group) {
            var card = document.createElement("article");
            card.className = "ld-duplicate-card" + (group.reviewed ? " is-reviewed" : "");
            var heading = document.createElement("div");
            heading.className = "ld-duplicate-card-heading";
            var title = document.createElement("h3");
            title.textContent = group.title;
            var badge = document.createElement("span");
            badge.className = "ld-duplicate-badge";
            badge.textContent = group.label;
            heading.append(title, badge);
            var explanation = document.createElement("p");
            explanation.className = "ld-duplicate-explanation";
            explanation.textContent = group.explanation;
            var list = document.createElement("ul");
            list.className = "ld-duplicate-scenes";
            group.scenes.forEach(function (scene) {
                var item = document.createElement("li");
                var details = document.createElement("div");
                var sceneTitle = document.createElement("strong");
                sceneTitle.textContent = scene.title || "Untitled scene";
                var metadata = document.createElement("span");
                metadata.className = "ld-duplicate-meta";
                metadata.textContent = [scene.studio, scene.date, scene.performers.join(", ")].filter(Boolean).join(" · ") || "No additional scene details";
                var file = scene.files[0] || {};
                var fileInfo = document.createElement("span");
                fileInfo.className = "ld-duplicate-file";
                fileInfo.textContent = (fileBasename(file.path) || "File details unavailable") + " · " + formatDuration(file.duration) + " · " + formatBytes(file.size);
                details.append(sceneTitle, metadata, fileInfo);
                var open = document.createElement("a");
                open.className = "ld-open-scene";
                open.href = "/scenes/" + encodeURIComponent(scene.id);
                open.target = "_blank";
                open.rel = "noopener noreferrer";
                open.textContent = "Open scene";
                open.setAttribute("aria-label", "Open " + (scene.title || "scene") + " in Stash");
                item.append(details, open);
                list.appendChild(item);
            });
            var actions = document.createElement("div");
            actions.className = "ld-duplicate-actions";
            var review = document.createElement("button");
            review.className = "ld-fix-button";
            review.type = "button";
            review.textContent = group.reviewed ? "Mark unreviewed" : "Mark reviewed";
            review.setAttribute("aria-pressed", group.reviewed ? "true" : "false");
            review.addEventListener("click", function () {
                if (group.reviewed) { delete reviewedDuplicateKeys[group.key]; }
                else { reviewedDuplicateKeys[group.key] = true; }
                saveReviewedDuplicateKeys();
                renderDuplicateGroups();
            });
            actions.appendChild(review);
            card.append(heading, explanation, list, actions);
            return card;
        }));
        els.duplicateEmpty.hidden = visibleGroups.length > 0;
    }

    function renderMetadataQueue() {
        var scenes = results.filter(function (scene) {
            return hasIssue(scene, "Missing title") || hasIssue(scene, "Missing date");
        });
        els.metadataList.replaceChildren.apply(els.metadataList, scenes.map(function (scene) {
            var card = document.createElement("article");
            card.className = "ld-metadata-card";
            var heading = document.createElement("div");
            heading.className = "ld-metadata-card-heading";
            var title = document.createElement("h3");
            title.textContent = scene.title || "Untitled scene";
            var meta = document.createElement("span");
            meta.className = "ld-metadata-source-file";
            meta.textContent = fileBasename(scene.files[0] && scene.files[0].path) || "Scene file name unavailable";
            heading.append(title, meta);
            var fields = document.createElement("div");
            fields.className = "ld-metadata-suggestions";
            if (hasIssue(scene, "Missing title")) {
                fields.appendChild(makeMetadataSuggestion("Title", scene.titleSuggestion));
            }
            if (hasIssue(scene, "Missing date")) {
                fields.appendChild(makeMetadataSuggestion("Date", scene.dateSuggestion));
            }
            var actions = document.createElement("div");
            actions.className = "ld-metadata-actions";
            var fix = document.createElement("button");
            fix.className = "ld-fix-button";
            fix.type = "button";
            fix.textContent = "Review changes";
            fix.setAttribute("aria-label", "Review metadata suggestions for " + (scene.title || "untitled scene"));
            fix.addEventListener("click", function () { openFixDialog(scene); });
            var open = document.createElement("a");
            open.className = "ld-open-scene";
            open.href = "/scenes/" + encodeURIComponent(scene.id);
            open.target = "_blank";
            open.rel = "noopener noreferrer";
            open.textContent = "Open scene";
            actions.append(fix, open);
            card.append(heading, fields, actions);
            return card;
        }));
        if (!results.length) {
            els.metadataEmpty.textContent = lastScanDate
                ? "No scenes were found in the latest health check."
                : "Run Health Check to look for missing titles and dates.";
            els.metadataEmpty.hidden = false;
        } else if (!scenes.length) {
            els.metadataEmpty.textContent = "No missing titles or dates were found in this health check.";
            els.metadataEmpty.hidden = false;
        } else {
            els.metadataEmpty.hidden = true;
        }
    }

    function makeMetadataSuggestion(label, suggestion) {
        var row = document.createElement("div");
        row.className = "ld-metadata-suggestion";
        var name = document.createElement("span");
        name.className = "ld-metadata-label";
        name.textContent = label;
        var value = document.createElement("strong");
        value.textContent = suggestion ? suggestion.value : "No clear filename suggestion";
        var source = document.createElement("small");
        source.textContent = suggestion ? "Suggested from filename · " + suggestion.source : "Enter a value manually in the review dialog.";
        row.append(name, value, source);
        return row;
    }

    function setWorkspace(name) {
        currentWorkspace = name;
        document.querySelectorAll("[data-workspace-panel]").forEach(function (panel) {
            panel.hidden = panel.getAttribute("data-workspace-panel") !== name;
        });
        document.querySelectorAll(".ld-workspace-tab[data-workspace]").forEach(function (tab) {
            var active = tab.getAttribute("data-workspace") === name;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function updateWorkspaceCounts() {
        els.healthTabCount.textContent = results.length ? results.length.toLocaleString() : (lastScanDate ? "0" : "—");
        els.metadataTabCount.textContent = results.filter(function (scene) {
            return hasIssue(scene, "Missing title") || hasIssue(scene, "Missing date");
        }).length.toLocaleString();
        els.duplicatesTabCount.textContent = buildDuplicateGroups(results).length.toLocaleString();
    }

    function hasIssue(scene, label) {
        return scene._doctorIssues.some(function (issue) { return issue.label === label; });
    }

    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
        var parts = value.split("-").map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return date.getUTCFullYear() === parts[0]
            && date.getUTCMonth() === parts[1] - 1
            && date.getUTCDate() === parts[2];
    }

    function addPreviewLine(label, before, after) {
        var line = document.createElement("div");
        line.className = "ld-fix-preview-line";
        var name = document.createElement("strong");
        name.textContent = label;
        var values = document.createElement("span");
        values.textContent = (before || "Missing") + "  →  " + after;
        line.append(name, values);
        els.fixPreview.appendChild(line);
    }

    function readFixUpdates() {
        var updates = {};
        var error = "";
        if (els.fixTitleChoice.checked) {
            var title = els.fixTitle.value.trim();
            if (!title) { error = "Enter a title to include this fix."; }
            else { updates.title = title; }
        }
        if (els.fixDateChoice.checked) {
            var date = els.fixDate.value.trim();
            if (!validDate(date)) { error = "Enter a valid date in YYYY-MM-DD format."; }
            else { updates.date = date; }
        }
        if (!error && !Object.keys(updates).length) { error = "Select a field and enter its value to preview a fix."; }
        return { updates: updates, error: error };
    }

    function updateFixPreview() {
        var state = readFixUpdates();
        els.fixPreview.replaceChildren();
        if (state.updates.title) { addPreviewLine("Title", pendingFixScene.title, state.updates.title); }
        if (state.updates.date) { addPreviewLine("Date", pendingFixScene.date, state.updates.date); }
        if (!Object.keys(state.updates).length) {
            var empty = document.createElement("p");
            empty.textContent = "Choose a missing field, enter its value, then review the change here.";
            els.fixPreview.appendChild(empty);
        }
        els.fixValidation.textContent = state.error;
        els.fixValidation.hidden = !state.error;
        els.fixApply.disabled = applyingFix || !!state.error;
    }

    function openFixDialog(scene) {
        pendingFixScene = scene;
        els.fixApply.textContent = "Apply selected fixes";
        els.fixCancel.disabled = false;
        els.fixTitleField.hidden = !hasIssue(scene, "Missing title");
        els.fixDateField.hidden = !hasIssue(scene, "Missing date");
        els.fixTitleChoice.checked = false;
        els.fixTitle.disabled = true;
        els.fixTitle.value = scene.titleSuggestion ? scene.titleSuggestion.value : "";
        els.fixTitleHint.textContent = scene.titleSuggestion
            ? "Filename suggestion: “" + scene.titleSuggestion.value + "” · from " + scene.titleSuggestion.source + ". Review before applying."
            : "No clear title suggestion from the filename. You can enter one manually.";
        els.fixDateChoice.checked = false;
        els.fixDate.disabled = true;
        els.fixDate.value = scene.dateSuggestion ? scene.dateSuggestion.value : "";
        els.fixDateHint.textContent = scene.dateSuggestion
            ? "Filename suggestion: " + scene.dateSuggestion.value + " · from " + scene.dateSuggestion.source + ". Review before applying."
            : "No date found in the filename. You can enter one manually.";
        els.fixScene.textContent = scene.title || "Untitled scene";
        els.fixError.textContent = "";
        els.fixError.hidden = true;
        updateFixPreview();
        if (typeof els.fixDialog.showModal === "function") { els.fixDialog.showModal(); }
        else { els.fixDialog.setAttribute("open", "open"); }
        if (els.fixTitleField.hidden) { els.fixDateChoice.focus(); }
        else { els.fixTitleChoice.focus(); }
    }

    function closeFixDialog() {
        if (applyingFix) { return; }
        if (typeof els.fixDialog.close === "function" && els.fixDialog.open) { els.fixDialog.close(); }
        else { els.fixDialog.removeAttribute("open"); }
        pendingFixScene = null;
    }

    function updateScene(scene, updates) {
        var before = {};
        Object.keys(updates).forEach(function (field) { before[field] = String(scene[field] || ""); });
        return graphQLRequest(FRESH_SCENE_QUERY, { id: scene.id }).then(function (data) {
            var latest = data.findScene;
            if (!latest) { throw new Error("Stash no longer has this scene. Run a new library check."); }
            var changedSinceScan = Object.keys(updates).some(function (field) {
                return String(latest[field] || "").trim() !== String(scene[field] || "").trim();
            });
            if (changedSinceScan) {
                throw new Error("This scene changed after the check. Close this dialog and run the check again before applying a fix.");
            }
            var input = { id: scene.id };
            Object.keys(updates).forEach(function (field) { input[field] = updates[field]; });
            return graphQLRequest(UPDATE_SCENE_MUTATION, { input: input });
        }).then(function (data) {
            var updated = data.sceneUpdate;
            if (!updated || String(updated.id) !== scene.id) {
                throw new Error("Stash did not confirm the updated scene. Run a new library check to verify its state.");
            }
            scene.title = updated.title == null ? (updates.title || scene.title) : String(updated.title).trim();
            scene.date = updated.date == null ? (updates.date || scene.date) : String(updated.date).trim();
            var undo = { id: scene.id, sceneLabel: scene.title || "Untitled scene", before: before, after: {} };
            Object.keys(updates).forEach(function (field) { undo.after[field] = scene[field]; });
            undoStack.push(undo);
            if (undoStack.length > 20) { undoStack.shift(); }
            scene._doctorIssues = scene._doctorIssues.filter(function (issue) {
                return !(issue.label === "Missing title" && scene.title)
                    && !(issue.label === "Missing date" && scene.date);
            });
            results.forEach(function (item) {
                item._doctorIssues = item._doctorIssues.filter(function (issue) { return issue.kind !== "review"; });
            });
            markRepeatedTitles(results);
            render();
            return scene;
        });
    }

    function undoLastFix() {
        if (undoingFix || !undoStack.length) { return; }
        var undo = undoStack[undoStack.length - 1];
        undoingFix = true;
        clearError();
        els.scan.disabled = true;
        els.export.disabled = true;
        els.undo.disabled = true;
        els.statusMessage.textContent = "Undoing the last Library Doctor change…";
        graphQLRequest(FRESH_SCENE_QUERY, { id: undo.id }).then(function (data) {
            var latest = data.findScene;
            if (!latest) { throw new Error("Stash no longer has this scene. The change was not undone."); }
            var changedSinceFix = Object.keys(undo.after).some(function (field) {
                return String(latest[field] || "").trim() !== String(undo.after[field] || "").trim();
            });
            if (changedSinceFix) {
                throw new Error("This field changed after Library Doctor updated it. The change was not undone to avoid overwriting newer work.");
            }
            var input = { id: undo.id };
            Object.keys(undo.before).forEach(function (field) { input[field] = undo.before[field]; });
            return graphQLRequest(UPDATE_SCENE_MUTATION, { input: input });
        }).then(function (data) {
            var updated = data.sceneUpdate;
            if (!updated || String(updated.id) !== undo.id) {
                throw new Error("Stash did not confirm the undo. Run a new library check to verify the scene.");
            }
            undoStack.pop();
            var scene = results.filter(function (item) { return item.id === undo.id; })[0];
            if (scene) {
                Object.keys(undo.before).forEach(function (field) {
                    scene[field] = updated[field] == null ? "" : String(updated[field]).trim();
                    var issueLabel = field === "title" ? "Missing title" : "Missing date";
                    scene._doctorIssues = scene._doctorIssues.filter(function (issue) { return issue.label !== issueLabel; });
                    if (!scene[field]) { addIssue(scene, issueLabel, "metadata"); }
                });
                results.forEach(function (item) {
                    item._doctorIssues = item._doctorIssues.filter(function (issue) { return issue.kind !== "review"; });
                });
                markRepeatedTitles(results);
                render();
            }
            var fieldNames = Object.keys(undo.before).map(function (field) { return field === "title" ? "title" : "date"; });
            showStatus("Undid the " + fieldNames.join(" and ") + " update for “" + undo.sceneLabel + "”.", undoStack.length > 0);
        }).catch(function (error) {
            showError("Could not undo this fix: " + (error && error.message ? error.message : String(error)));
            showStatus("Undo was not applied. Your current library values were left unchanged.", true);
        }).then(function () {
            undoingFix = false;
            els.scan.disabled = !!scanController;
            els.export.disabled = !results.length;
            if (undoStack.length) {
                els.undo.hidden = false;
                els.undo.disabled = !!scanController;
            } else {
                els.undo.hidden = true;
            }
        });
    }

    function applyFix() {
        if (applyingFix || undoingFix || !pendingFixScene) { return; }
        var state = readFixUpdates();
        if (state.error) { updateFixPreview(); return; }
        var scene = pendingFixScene;
        var sceneLabel = scene.title || "Untitled scene";
        applyingFix = true;
        els.fixApply.textContent = "Applying…";
        els.fixApply.disabled = true;
        els.fixCancel.disabled = true;
        els.fixError.textContent = "";
        els.fixError.hidden = true;
        clearError();
        updateScene(scene, state.updates).then(function () {
            var labels = Object.keys(state.updates).map(function (field) { return field === "title" ? "title" : "date"; });
            var statusLabel = labels.join(" and ");
            applyingFix = false;
            closeFixDialog();
            showStatus("Updated " + statusLabel + " for “" + (scene.title || sceneLabel) + "”. You can undo this change during this session.", true);
        }).catch(function (error) {
            els.fixError.textContent = "Could not apply this fix: " + (error && error.message ? error.message : String(error));
            els.fixError.hidden = false;
        }).then(function () {
            applyingFix = false;
            if (els.fixDialog.open || els.fixDialog.hasAttribute("open")) {
                els.fixApply.textContent = "Apply selected fixes";
                els.fixCancel.disabled = false;
                updateFixPreview();
            }
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

    function showStatus(message, canUndo) {
        els.statusMessage.textContent = message;
        els.undo.hidden = !canUndo || !undoStack.length;
        els.undo.disabled = undoingFix;
        els.status.hidden = false;
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
        els.undo.disabled = scanning || undoingFix || !undoStack.length;
        if (!scanning) { scanController = null; }
    }

    function scan() {
        if (scanController) { return; }
        setWorkspace("health");
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
        els.undo.disabled = true;
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
        var actions = document.createElement("div");
        actions.className = "ld-row-actions";
        if (hasIssue(scene, "Missing title") || hasIssue(scene, "Missing date")) {
            var fix = document.createElement("button");
            fix.className = "ld-fix-button";
            fix.type = "button";
            fix.textContent = "Fix fields";
            fix.setAttribute("aria-label", "Review safe fixes for " + (scene.title || "untitled scene"));
            fix.addEventListener("click", function () { openFixDialog(scene); });
            actions.appendChild(fix);
        }
        var open = document.createElement("a");
        open.className = "ld-open-scene";
        open.href = "/scenes/" + encodeURIComponent(scene.id);
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.setAttribute("aria-label", "Open " + (scene.title || "scene") + " in Stash");
        open.innerHTML = "Open <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M14 4h6v6M20 4l-9 9'/><path d='M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'/></svg>";
        actions.appendChild(open);
        openCell.appendChild(actions);
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
        renderMetadataQueue();
        renderDuplicateGroups();
        updateWorkspaceCounts();

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
            pageStatus: byId("ld-page-status"), pagePrev: byId("ld-page-prev"), pageNext: byId("ld-page-next"),
            healthTabCount: byId("ld-tab-health-count"), metadataTabCount: byId("ld-tab-metadata-count"),
            duplicatesTabCount: byId("ld-tab-duplicates-count"), metadataEmpty: byId("ld-metadata-empty"),
            metadataList: byId("ld-metadata-list"),
            status: byId("ld-status"), statusMessage: byId("ld-status-message"), undo: byId("ld-undo"),
            duplicateReview: byId("ld-duplicate-review"), duplicateCount: byId("ld-duplicate-count"),
            duplicateToggle: byId("ld-duplicate-toggle-reviewed"),
            duplicateEmpty: byId("ld-duplicate-empty"), duplicateGroups: byId("ld-duplicate-groups"),
            fixDialog: byId("ld-fix-dialog"), fixScene: byId("ld-fix-scene"),
            fixTitleField: byId("ld-fix-title-field"), fixTitleChoice: byId("ld-fix-title-choice"), fixTitle: byId("ld-fix-title"),
            fixTitleHint: byId("ld-fix-title-suggestion"),
            fixDateField: byId("ld-fix-date-field"), fixDateChoice: byId("ld-fix-date-choice"), fixDate: byId("ld-fix-date"),
            fixDateHint: byId("ld-fix-date-suggestion"),
            fixPreview: byId("ld-fix-preview"), fixValidation: byId("ld-fix-validation"), fixError: byId("ld-fix-error"),
            fixApply: byId("ld-fix-apply"), fixCancel: byId("ld-fix-cancel"), fixClose: byId("ld-fix-close")
        };
        setWorkspace(currentWorkspace);
        document.querySelectorAll(".ld-workspace-tab[data-workspace]").forEach(function (tab) {
            tab.addEventListener("click", function () {
                setWorkspace(tab.getAttribute("data-workspace"));
            });
        });
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
        els.duplicateToggle.addEventListener("click", function () {
            showReviewedDuplicates = !showReviewedDuplicates;
            renderDuplicateGroups();
        });
        els.fixTitleChoice.addEventListener("change", function () {
            els.fixTitle.disabled = !els.fixTitleChoice.checked;
            updateFixPreview();
        });
        els.fixTitle.addEventListener("input", updateFixPreview);
        els.fixDateChoice.addEventListener("change", function () {
            els.fixDate.disabled = !els.fixDateChoice.checked;
            updateFixPreview();
        });
        els.fixDate.addEventListener("input", updateFixPreview);
        els.fixApply.addEventListener("click", applyFix);
        els.undo.addEventListener("click", undoLastFix);
        els.fixCancel.addEventListener("click", closeFixDialog);
        els.fixClose.addEventListener("click", closeFixDialog);
        els.fixDialog.addEventListener("cancel", function (event) {
            if (applyingFix) { event.preventDefault(); }
            else { pendingFixScene = null; }
        });
        els.fixDialog.addEventListener("close", function () { pendingFixScene = null; });
    }

    setAccent();
    bind();
}());
