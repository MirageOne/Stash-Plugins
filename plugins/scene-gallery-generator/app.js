(function () {
    "use strict";

    var PLUGIN_ID = "scene-gallery-generator";
    var TASK_NAME = "Generate scene galleries";
    var STORAGE_KEY = "scene-gallery-generator.preferences";
    var PAGE_SIZE = 25;
    var SCAN_PAGE_SIZE = 100;
    var SCENES_WITH_GALLERY_CODES_QUERY = "query SceneGalleryGeneratorScenesWithCodes($page:Int!,$perPage:Int!) { findScenes(filter:{page:$page,per_page:$perPage,sort:\"title\",direction:ASC}) { count scenes { id title date details url rating100 organized files { id path duration } studio { id name } performers { id name } tags { id name } galleries { id title code } } } }";
    var SCENES_WITH_GALLERIES_QUERY = "query SceneGalleryGeneratorScenesWithGalleries($page:Int!,$perPage:Int!) { findScenes(filter:{page:$page,per_page:$perPage,sort:\"title\",direction:ASC}) { count scenes { id title date details url rating100 organized files { id path duration } studio { id name } performers { id name } tags { id name } galleries { id title } } } }";
    var SCENES_QUERY = "query SceneGalleryGeneratorScenesFallback($page:Int!,$perPage:Int!) { findScenes(filter:{page:$page,per_page:$perPage,sort:\"title\",direction:ASC}) { count scenes { id title date details url rating100 organized files { id path duration } studio { id name } performers { id name } tags { id name } } } }";
    var CONFIG_QUERY = "query SceneGalleryGeneratorConfiguration { configuration { general { stashes { path excludeImage } } plugins(include:[\"scene-gallery-generator\"]) } }";
    var CONFIG_GENERAL_QUERY = "query SceneGalleryGeneratorGeneralConfiguration { configuration { general { stashes { path excludeImage } } } }";
    var RUN_TASK_MUTATION = "mutation SceneGalleryGeneratorRun($pluginId:ID!,$taskName:String!,$args:Map!) { runPluginTask(plugin_id:$pluginId,task_name:$taskName,args_map:$args) }";
    var FIND_JOB_QUERY = "query SceneGalleryGeneratorJob($input:FindJobInput!) { findJob(input:$input) { id status progress error } }";
    var STOP_JOB_MUTATION = "mutation SceneGalleryGeneratorStop($jobId:ID!) { stopJob(job_id:$jobId) }";
    var scenes = [];
    var sceneGalleryQuerySupported = true;
    var libraries = [];
    var pluginSettings = {};
    var pluginSettingsLoaded = true;
    var currentPage = 1;
    var activeJobId = "";
    var taskStarting = false;
    var pollingTimer = null;
    var ui = {};

    function byId(id) { return document.getElementById(id); }

    function escapeText(value) { return String(value == null ? "" : value); }

    function setAccent() {
        var accents = { orange: "#d83b01", blue: "#0078d4", pink: "#e3008c", red: "#d13438", yellow: "#f2c811", purple: "#8764b8", green: "#107c10", teal: "#038387" };
        try {
            var key = localStorage.getItem("fluent-mica.accent");
            if (!key || !accents[key]) return;
            var color = accents[key];
            document.documentElement.style.setProperty("--sgg-accent", color);
            var rgb = color.match(/[0-9a-f]{2}/gi).map(function (part) { return parseInt(part, 16); }).join(",");
            document.documentElement.style.setProperty("--sgg-accent-soft", "rgba(" + rgb + ",.16)");
        } catch (error) { /* Keep the default Fluent blue. */ }
    }

    function graphQLRequest(query, variables) {
        return fetch("/graphql", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query, variables: variables || {} })
        }).then(function (response) {
            return response.text().then(function (text) {
                var payload;
                try { payload = JSON.parse(text); }
                catch (error) { throw new Error("Stash returned an unreadable response. Reload the page and try again."); }
                var errors = payload && payload.errors;
                if (!response.ok || (errors && errors.length)) {
                    throw new Error(errors && errors.length ? errors.map(function (item) { return item.message; }).join(" ") : "Stash returned HTTP " + response.status + ".");
                }
                if (!payload || !payload.data) throw new Error("Stash did not return data for this request.");
                return payload.data;
            });
        });
    }

    function loadPreferences() {
        try {
            var value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            return value && typeof value === "object" ? value : {};
        } catch (error) { return {}; }
    }

    function savePreferences() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                imageCount: getImageCount(),
                samplingMode: getSamplingMode(),
                libraryPath: ui.library && ui.library.value || ""
            }));
        } catch (error) { /* Generation still works if browser storage is unavailable. */ }
    }

    function getImageCount() {
        var value = Number(ui.imageCount && ui.imageCount.value);
        return Number.isInteger(value) && value >= 1 && value <= 30 ? value : 0;
    }

    function getSamplingMode() {
        return ui.sampling && ui.sampling.value === "uniform" ? "uniform" : "smart";
    }

    function applyImageCount() {
        var count = getImageCount();
        if (!count) {
            ui.imageCount.setCustomValidity("Enter a whole number between 1 and 30.");
            ui.imageCount.setAttribute("aria-invalid", "true");
            updateActionAvailability();
            return;
        }
        ui.imageCount.setCustomValidity("");
        ui.imageCount.removeAttribute("aria-invalid");
        ui.imageCount.value = String(count);
        savePreferences();
        updateActionAvailability();
    }

    function loadConfiguration() {
        return graphQLRequest(CONFIG_QUERY).catch(function () {
            pluginSettingsLoaded = false;
            return graphQLRequest(CONFIG_GENERAL_QUERY);
        }).then(function (data) {
            var config = data.configuration || {};
            var general = config.general || {};
            libraries = (Array.isArray(general.stashes) ? general.stashes : []).filter(function (stash) {
                return stash && stash.path && stash.excludeImage !== true;
            });
            pluginSettings = config.plugins && config.plugins[PLUGIN_ID] || {};
            var preferences = loadPreferences();
            if (!Number.isFinite(Number.parseInt(preferences.imageCount, 10))) {
                var configuredCount = Number.parseInt(pluginSettings.defaultImageCount, 10);
                if (Number.isFinite(configuredCount)) ui.imageCount.value = String(Math.max(1, Math.min(30, configuredCount)));
            }
            renderLibraries();
            renderAutomaticStatus();
        });
    }

    function renderLibraries() {
        var prefs = loadPreferences();
        var settingsPath = String(pluginSettings.imageLibraryPath || "");
        var preferredPath = String(prefs.libraryPath || settingsPath || "");
        ui.library.replaceChildren();
        if (!libraries.length) {
            var empty = document.createElement("option");
            empty.value = "";
            empty.textContent = "No image-enabled libraries found";
            ui.library.appendChild(empty);
            ui.library.disabled = true;
            return;
        }
        libraries.forEach(function (library) {
            var option = document.createElement("option");
            option.value = library.path;
            option.textContent = library.path;
            ui.library.appendChild(option);
        });
        ui.library.disabled = false;
        ui.library.value = libraries.some(function (library) { return library.path === preferredPath; }) ? preferredPath : libraries[0].path;
        savePreferences();
    }

    function renderAutomaticStatus() {
        if (!pluginSettingsLoaded) {
            ui.autoStatus.textContent = "Automatic setting could not be read. Check Stash → Settings → Plugins.";
            return;
        }
        var enabled = pluginSettings.autoGenerate === true || String(pluginSettings.autoGenerate).toLowerCase() === "true";
        ui.autoStatus.textContent = enabled
            ? "Automatic generation is on for new scenes. Default: " + parseImageCountSetting(pluginSettings.defaultImageCount) + " images per scene."
            : "Automatic generation is off. Enable it in Stash → Settings → Plugins if desired.";
    }

    function parseImageCountSetting(value) {
        var count = Number.parseInt(value, 10);
        return Number.isFinite(count) ? Math.max(1, Math.min(30, count)) : 8;
    }

    function queryScenes(page, mode) {
        var query = mode === "code" ? SCENES_WITH_GALLERY_CODES_QUERY : mode === "title" ? SCENES_WITH_GALLERIES_QUERY : SCENES_QUERY;
        return graphQLRequest(query, { page: page, perPage: SCAN_PAGE_SIZE })
            .then(function (data) { return data.findScenes; });
    }

    function loadScenes() {
        setTableMessage("Loading scenes from Stash…");
        var queryMode = "code";
        var result = [];
        var total = 0;
        function loadPage(page) {
            return queryScenes(page, queryMode).catch(function (error) {
                if (page === 1 && queryMode === "code") {
                    queryMode = "title";
                    return queryScenes(page, queryMode).catch(function () {
                        queryMode = "none";
                        sceneGalleryQuerySupported = false;
                        return queryScenes(page, queryMode);
                    });
                }
                if (page === 1 && queryMode === "title") {
                    queryMode = "none";
                    sceneGalleryQuerySupported = false;
                    return queryScenes(page, queryMode);
                }
                throw error;
            }).then(function (payload) {
                if (!payload) return;
                total = Number(payload.count || 0);
                var rows = Array.isArray(payload.scenes) ? payload.scenes : [];
                result = result.concat(rows.map(function (scene) {
                    scene.galleries = Array.isArray(scene.galleries) ? scene.galleries : [];
                    scene.files = Array.isArray(scene.files) ? scene.files : [];
                    return scene;
                }));
                if (result.length < total && rows.length) return loadPage(page + 1);
            });
        }
        return loadPage(1).then(function () {
            scenes = result;
            updateSceneSummary(total);
            renderScenes();
        }).catch(function (error) {
            setTableMessage("Could not load scenes: " + (error.message || String(error)));
            showError(error.message || String(error));
        });
    }

    function isManagedGallery(gallery, scene) {
        var expectedCode = "SGG-" + String(scene && scene.id || "");
        return String(gallery && gallery.code || "") === expectedCode || String(gallery && gallery.title || "").endsWith(" — Scene Gallery");
    }

    function updateSceneSummary(total) {
        var managed = scenes.filter(function (scene) { return scene.galleries.some(function (gallery) { return isManagedGallery(gallery, scene); }); }).length;
        var totalScenes = total || scenes.length;
        if (sceneGalleryQuerySupported) {
            ui.sceneCount.textContent = totalScenes.toLocaleString() + " scenes · " + managed.toLocaleString() + " generated galleries";
        } else {
            ui.sceneCount.textContent = totalScenes.toLocaleString() + " scenes found. Generated gallery status will be checked by the server task.";
        }
    }

    function filteredScenes() {
        var needle = String(ui.search.value || "").trim().toLocaleLowerCase();
        if (!needle) return scenes;
        return scenes.filter(function (scene) {
            var values = [scene.title, scene.studio && scene.studio.name];
            (scene.performers || []).forEach(function (performer) { values.push(performer && performer.name); });
            (scene.files || []).forEach(function (file) { values.push(file && file.path); });
            return values.join(" ").toLocaleLowerCase().indexOf(needle) >= 0;
        });
    }

    function renderScenes() {
        var matching = filteredScenes();
        var pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
        currentPage = Math.max(1, Math.min(currentPage, pageCount));
        var start = (currentPage - 1) * PAGE_SIZE;
        var rows = matching.slice(start, start + PAGE_SIZE);
        ui.sceneBody.replaceChildren();
        if (!rows.length) {
            setTableMessage(scenes.length ? "No scenes match your search." : "No scenes were found in this library.");
        } else {
            rows.forEach(function (scene) {
                var tr = document.createElement("tr");
                var sceneCell = document.createElement("td");
                var title = document.createElement("span");
                title.className = "sgg-scene-title";
                title.textContent = scene.title || "Untitled scene";
                var id = document.createElement("span");
                id.className = "sgg-scene-id";
                id.textContent = "Scene ID " + scene.id;
                sceneCell.appendChild(title);
                sceneCell.appendChild(id);
                tr.appendChild(sceneCell);

                var studioCell = document.createElement("td");
                studioCell.textContent = scene.studio && scene.studio.name || "—";
                tr.appendChild(studioCell);

                var galleryCell = document.createElement("td");
                var state = document.createElement("span");
                var generated = scene.galleries.some(function (gallery) { return isManagedGallery(gallery, scene); });
                state.className = "sgg-gallery-state" + (generated ? " is-generated" : "");
                state.textContent = sceneGalleryQuerySupported ? (generated ? "Generated" : "Not generated") : "Check on run";
                galleryCell.appendChild(state);
                tr.appendChild(galleryCell);

                var actionCell = document.createElement("td");
                var action = document.createElement("button");
                action.type = "button";
                action.className = "sgg-button sgg-button-secondary sgg-row-action";
                action.textContent = generated ? "Refresh" : "Generate";
                action.disabled = !scene.files.length || !!activeJobId || taskStarting || !libraries.length || !getImageCount();
                action.title = scene.files.length ? "Generate or refresh this scene gallery" : "This scene has no video file";
                action.addEventListener("click", function () { startTask({ scene_id: String(scene.id), force: true }, scene.title || "Scene " + scene.id); });
                actionCell.appendChild(action);
                tr.appendChild(actionCell);
                ui.sceneBody.appendChild(tr);
            });
        }
        ui.pageSummary.textContent = matching.length ? "Showing " + (start + 1) + "–" + Math.min(start + PAGE_SIZE, matching.length) + " of " + matching.length.toLocaleString() : "0 scenes";
        ui.pagePrev.disabled = currentPage <= 1;
        ui.pageNext.disabled = currentPage >= pageCount;
    }

    function setTableMessage(message) {
        ui.sceneBody.replaceChildren();
        var row = document.createElement("tr");
        var cell = document.createElement("td");
        cell.colSpan = 4;
        cell.className = "sgg-table-message";
        cell.textContent = message;
        row.appendChild(cell);
        ui.sceneBody.appendChild(row);
        ui.pageSummary.textContent = "—";
        ui.pagePrev.disabled = true;
        ui.pageNext.disabled = true;
    }

    function updateActionAvailability() {
        var validCount = !!getImageCount();
        var busy = !!activeJobId || taskStarting;
        ui.generateMissing.disabled = busy || !libraries.length || !validCount || !scenes.some(function (scene) { return scene.files.length > 0; });
        ui.library.disabled = busy || !libraries.length;
        ui.imageCount.disabled = busy;
        ui.sampling.disabled = busy;
        if (ui.sceneBody.querySelector("button")) renderScenes();
    }

    function setBusy(busy) {
        taskStarting = busy && !activeJobId;
        ui.generateMissing.disabled = busy || !libraries.length;
        ui.library.disabled = busy || !libraries.length;
        ui.imageCount.disabled = busy;
        ui.sampling.disabled = busy;
        ui.progress.hidden = !busy;
        renderScenes();
        if (!busy) updateActionAvailability();
    }

    function showError(message) {
        ui.error.textContent = String(message || "An unexpected error occurred.");
        ui.error.hidden = false;
        ui.status.hidden = true;
    }

    function showStatus(message) {
        ui.status.textContent = String(message || "");
        ui.status.hidden = !message;
        ui.error.hidden = true;
    }

    function setProgress(title, detail, progress) {
        ui.progressTitle.textContent = title;
        ui.progressDetail.textContent = detail;
        var value = Number(progress || 0);
        if (value > 1) value /= 100;
        value = Math.max(0, Math.min(1, value));
        ui.progressBar.style.width = (value * 100) + "%";
        var track = ui.progressBar.parentElement;
        track.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    }

    function startTask(extraArgs, label) {
        if (activeJobId || taskStarting) return Promise.resolve();
        hideMessages();
        var args = Object.assign({
            mode: "generate",
            image_count: getImageCount(),
            sampling_mode: getSamplingMode(),
            library_path: ui.library.value,
            scope: "missing"
        }, extraArgs || {});
        taskStarting = true;
        setBusy(true);
        setProgress("Queueing gallery generation…", label || "Preparing library scan", 0);
        return graphQLRequest(RUN_TASK_MUTATION, { pluginId: PLUGIN_ID, taskName: TASK_NAME, args: args }).then(function (data) {
            var jobId = data.runPluginTask;
            if (!jobId) throw new Error("Stash did not create a background job.");
            activeJobId = String(jobId);
            taskStarting = false;
            setBusy(true);
            setProgress("Generating scene galleries…", label || "Queued in Stash", 0);
            pollJob();
        }).catch(function (error) {
            activeJobId = "";
            taskStarting = false;
            setBusy(false);
            showError(error.message || String(error));
        });
    }

    function pollJob() {
        if (!activeJobId) return;
        graphQLRequest(FIND_JOB_QUERY, { input: { id: activeJobId } }).then(function (data) {
            var job = data.findJob;
            if (!job) throw new Error("Stash could not find the gallery generation job.");
            var status = String(job.status || "").toUpperCase();
            var detail = status === "RUNNING" ? "FFmpeg is extracting frames and Stash is indexing the gallery." : status === "READY" ? "Waiting in the Stash job queue." : status;
            setProgress(status === "FINISHED" ? "Generation complete" : "Generating scene galleries…", detail, job.progress);
            if (status === "FINISHED") {
                activeJobId = "";
                taskStarting = false;
                setBusy(false);
                showStatus("Gallery generation finished. Scenes with a usable video and image-enabled library were processed; see Stash logs for any skipped scenes.");
                loadScenes();
                return;
            }
            if (status === "FAILED" || status === "CANCELLED" || status === "STOPPING") {
                activeJobId = "";
                taskStarting = false;
                setBusy(false);
                if (status === "FAILED") showError(job.error || "Gallery generation failed. Check the Stash log for details.");
                else showStatus("Gallery generation was cancelled.");
                return;
            }
            pollingTimer = window.setTimeout(pollJob, 1400);
        }).catch(function (error) {
            activeJobId = "";
            taskStarting = false;
            setBusy(false);
            showError(error.message || String(error));
        });
    }

    function cancelJob() {
        if (!activeJobId) return;
        ui.cancel.disabled = true;
        graphQLRequest(STOP_JOB_MUTATION, { jobId: activeJobId }).then(function () {
            setProgress("Stopping generation…", "FFmpeg will stop at the current frame.", 0);
        }).catch(function (error) {
            showError("Could not cancel the Stash job: " + (error.message || String(error)));
        }).finally(function () { ui.cancel.disabled = false; });
    }

    function hideMessages() {
        ui.error.hidden = true;
        ui.status.hidden = true;
    }

    function cacheElements() {
        ui.error = byId("sgg-error");
        ui.status = byId("sgg-status");
        ui.progress = byId("sgg-progress");
        ui.progressTitle = byId("sgg-progress-title");
        ui.progressDetail = byId("sgg-progress-detail");
        ui.progressBar = byId("sgg-progress-bar");
        ui.cancel = byId("sgg-cancel");
        ui.imageCount = byId("sgg-image-count");
        ui.sampling = byId("sgg-sampling");
        ui.library = byId("sgg-library");
        ui.generateMissing = byId("sgg-generate-missing");
        ui.sceneCount = byId("sgg-scene-count");
        ui.autoStatus = byId("sgg-auto-status");
        ui.search = byId("sgg-search");
        ui.sceneBody = byId("sgg-scenes-body");
        ui.pageSummary = byId("sgg-page-summary");
        ui.pagePrev = byId("sgg-page-prev");
        ui.pageNext = byId("sgg-page-next");
    }

    function bindEvents() {
        ui.imageCount.addEventListener("change", applyImageCount);
        ui.imageCount.addEventListener("blur", applyImageCount);
        ui.imageCount.addEventListener("keydown", function (event) {
            if (event.key === "Enter") { event.preventDefault(); applyImageCount(); }
        });
        document.querySelectorAll("[data-count-step]").forEach(function (button) {
            button.addEventListener("click", function () {
                var next = (getImageCount() || 8) + Number(button.getAttribute("data-count-step"));
                ui.imageCount.value = String(Math.max(1, Math.min(30, next)));
                applyImageCount();
            });
        });
        ui.sampling.addEventListener("change", savePreferences);
        ui.library.addEventListener("change", savePreferences);
        ui.generateMissing.addEventListener("click", function () {
            startTask({ scope: "missing", force: false }, "Reviewing scenes and updating galleries that need attention");
        });
        ui.search.addEventListener("input", function () { currentPage = 1; renderScenes(); });
        ui.pagePrev.addEventListener("click", function () { currentPage -= 1; renderScenes(); });
        ui.pageNext.addEventListener("click", function () { currentPage += 1; renderScenes(); });
        ui.cancel.addEventListener("click", cancelJob);
    }

    function boot() {
        cacheElements();
        setAccent();
        var prefs = loadPreferences();
        var initialCount = Number.parseInt(prefs.imageCount, 10);
        if (Number.isFinite(initialCount)) ui.imageCount.value = String(Math.max(1, Math.min(30, initialCount)));
        if (prefs.samplingMode === "uniform") ui.sampling.value = "uniform";
        bindEvents();
        Promise.all([loadConfiguration(), loadScenes()]).then(function () {
            updateActionAvailability();
        }).catch(function (error) {
            showError(error.message || String(error));
            updateActionAvailability();
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
}());
