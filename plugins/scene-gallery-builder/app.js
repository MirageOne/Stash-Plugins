(function () {
    "use strict";

    var PLUGIN_ID = "scene-gallery-builder";
    var TASK_NAME = "Generate scene galleries";
    var STORAGE_KEY = "scene-gallery-builder.preferences";
    var HOST_THEME_KEY = "scene-gallery-builder.host-theme.v1";
    var PAGE_SIZE = 25;
    var SCAN_PAGE_SIZE = 100;
    var SCENES_WITH_GALLERY_CODES_QUERY = "query SceneGalleryBuilderScenesWithCodes($page:Int!,$perPage:Int!) { findScenes(filter:{page:$page,per_page:$perPage,sort:\"title\",direction:ASC}) { count scenes { id title date details url rating100 organized files { id path duration } studio { id name } performers { id name } tags { id name } galleries { id title code } } } }";
    var SCENES_WITH_GALLERIES_QUERY = "query SceneGalleryBuilderScenesWithGalleries($page:Int!,$perPage:Int!) { findScenes(filter:{page:$page,per_page:$perPage,sort:\"title\",direction:ASC}) { count scenes { id title date details url rating100 organized files { id path duration } studio { id name } performers { id name } tags { id name } galleries { id title } } } }";
    var SCENES_QUERY = "query SceneGalleryBuilderScenesFallback($page:Int!,$perPage:Int!) { findScenes(filter:{page:$page,per_page:$perPage,sort:\"title\",direction:ASC}) { count scenes { id title date details url rating100 organized files { id path duration } studio { id name } performers { id name } tags { id name } } } }";
    var CONFIG_QUERY = "query SceneGalleryBuilderConfiguration { configuration { general { stashes { path excludeImage } } plugins(include:[\"scene-gallery-builder\"]) } }";
    var CONFIG_GENERAL_QUERY = "query SceneGalleryBuilderGeneralConfiguration { configuration { general { stashes { path excludeImage } } } }";
    var RUN_TASK_MUTATION = "mutation SceneGalleryBuilderRun($pluginId:ID!,$taskName:String!,$args:Map!) { runPluginTask(plugin_id:$pluginId,task_name:$taskName,args_map:$args) }";
    var FIND_JOB_QUERY = "query SceneGalleryBuilderJob($input:FindJobInput!) { findJob(input:$input) { id status progress error } }";
    var STOP_JOB_MUTATION = "mutation SceneGalleryBuilderStop($jobId:ID!) { stopJob(job_id:$jobId) }";
    var scenes = [];
    var sceneStatuses = Object.create(null);
    var sceneGalleryQuerySupported = true;
    var libraries = [];
    var pluginSettings = {};
    var pluginSettingsLoaded = true;
    var currentPage = 1;
    var activeJobId = "";
    var taskStarting = false;
    var taskQueue = [];
    var taskQueueIndex = 0;
    var taskFailures = [];
    var taskWasCancelled = false;
    var currentTaskSceneId = "";
    var taskForce = false;
    var pollingTimer = null;
    var ui = {};

    function byId(id) { return document.getElementById(id); }

    function escapeText(value) { return String(value == null ? "" : value); }

    function setAccent() {
        var root = document.documentElement;
        var tokenMap = {
            "--sgb-bg": "--bg-0",
            "--sgb-surface": "--glass-bg",
            "--sgb-surface-strong": "--glass-bg-strong",
            "--sgb-border": "--glass-border",
            "--sgb-border-strong": "--glass-border-bright",
            "--sgb-text": "--text",
            "--sgb-muted": "--text-muted",
            "--sgb-subtle": "--text-muted",
            "--sgb-accent": "--accent",
            "--sgb-accent-contrast": "--accent-contrast",
            "--sgb-primary-bg": "--accent",
            "--sgb-primary-border": "--accent",
            "--sgb-primary-text": "--accent-contrast",
            "--sgb-accent-soft": "--accent-tint",
            "--sgb-accent-bright": "--accent-bright",
            "--sgb-accent-light": "--accent-light",
            "--sgb-accent-rgb": "--accent-rgb",
            "--sgb-font": "--theme-font-stack",
            "--sgb-radius": "--radius",
            "--sgb-radius-sm": "--radius-sm"
        };
        var fallbackAccents = { orange: "#d83b01", blue: "#0078d4", pink: "#e3008c", red: "#d13438", yellow: "#f2c811", purple: "#8764b8", green: "#107c10", teal: "#038387" };
        try {
            var hostTheme = JSON.parse(localStorage.getItem(HOST_THEME_KEY) || "null");
            if (hostTheme && hostTheme.version === 1 && hostTheme.tokens && typeof hostTheme.tokens === "object") {
                Object.keys(hostTheme.tokens).forEach(function (name) {
                    if (name.indexOf("--sgb-") === 0 && typeof hostTheme.tokens[name] === "string") {
                        root.style.setProperty(name, hostTheme.tokens[name]);
                    }
                });
                if (hostTheme.colorScheme === "light" || hostTheme.colorScheme === "dark") root.style.colorScheme = hostTheme.colorScheme;
                return;
            }
            var snapshot = JSON.parse(localStorage.getItem("stash.theme.tokens.v1") || "null");
            var tokens = snapshot && snapshot.version === 1 && snapshot.tokens && typeof snapshot.tokens === "object"
                ? snapshot.tokens : null;
            if (tokens) {
                Object.keys(tokenMap).forEach(function (target) {
                    var value = tokens[tokenMap[target]];
                    if (typeof value === "string" && value) root.style.setProperty(target, value);
                    else root.style.removeProperty(target);
                });
                if (snapshot.theme) root.setAttribute("data-stash-theme", String(snapshot.theme));
                root.style.colorScheme = snapshot.colorScheme || "dark";
                return;
            }

            /* Compatibility with earlier theme releases that shared only
               the accent values through the multiview handoff. */
            var sharedAccent = localStorage.getItem("mv.theme.accent");
            var sharedTint = localStorage.getItem("mv.theme.accentTint");
            var sharedRgb = localStorage.getItem("mv.theme.accentRgb");
            if (sharedAccent) root.style.setProperty("--sgb-accent", sharedAccent);
            if (sharedTint) root.style.setProperty("--sgb-accent-soft", sharedTint);
            if (sharedRgb) root.style.setProperty("--sgb-accent-rgb", sharedRgb);
            var legacyKey = localStorage.getItem("fluent-mica.accent");
            if (!sharedAccent && legacyKey && fallbackAccents[legacyKey]) {
                var color = fallbackAccents[legacyKey];
                var rgb = color.match(/[0-9a-f]{2}/gi).map(function (part) { return parseInt(part, 16); }).join(",");
                root.style.setProperty("--sgb-accent", color);
                root.style.setProperty("--sgb-accent-rgb", rgb);
                root.style.setProperty("--sgb-accent-soft", "rgba(" + rgb + ",.16)");
            }
        } catch (error) { /* Keep the default Fluent blue. */ }
    }

    window.addEventListener("storage", function (event) {
        if (event.key === HOST_THEME_KEY || event.key === "stash.theme.tokens.v1" || event.key === "mv.theme.accent" ||
                event.key === "mv.theme.accentTint" || event.key === "mv.theme.accentRgb" ||
                event.key === "fluent-mica.accent" || event.key === "noir-theme.accent") {
            setAccent();
        }
    });

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
        var expectedCode = "SGB-" + String(scene && scene.id || "");
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
                title.className = "sgb-scene-title";
                title.textContent = scene.title || "Untitled scene";
                var id = document.createElement("span");
                id.className = "sgb-scene-id";
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
                state.className = "sgb-gallery-state" + (generated ? " is-generated" : "");
                state.textContent = sceneGalleryQuerySupported ? (generated ? "Generated" : "Not generated") : "Check on run";
                galleryCell.appendChild(state);
                tr.appendChild(galleryCell);

                var statusCell = document.createElement("td");
                var taskState = document.createElement("span");
                var statusText = sceneStatuses[String(scene.id)] || (generated ? "Completed" : "Not started");
                taskState.className = "sgb-task-state is-" + statusText.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
                taskState.textContent = statusText;
                statusCell.appendChild(taskState);
                tr.appendChild(statusCell);

                var actionCell = document.createElement("td");
                var action = document.createElement("button");
                action.type = "button";
                action.className = "sgb-button sgb-button-secondary sgb-row-action";
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
        cell.colSpan = 5;
        cell.className = "sgb-table-message";
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
        ui.cancel.disabled = !busy || !activeJobId;
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
        var options = extraArgs || {};
        var requestedSceneId = String(options.scene_id || "");
        taskQueue = requestedSceneId
            ? scenes.filter(function (scene) { return String(scene.id) === requestedSceneId; })
            : scenes.filter(function (scene) { return scene.files.length > 0; });
        if (!taskQueue.length) {
            showStatus(requestedSceneId ? "The selected scene is no longer available." : "No scenes with video files were found.");
            return Promise.resolve();
        }
        taskQueueIndex = 0;
        taskFailures = [];
        taskWasCancelled = false;
        currentTaskSceneId = "";
        taskForce = requestedSceneId ? options.force === true : false;
        taskQueue.forEach(function (scene) { sceneStatuses[String(scene.id)] = "Queued"; });
        taskStarting = true;
        setBusy(true);
        setProgress("Queueing gallery generation…", label || "Preparing scene queue", 0);
        startNextScene();
        return Promise.resolve();
    }

    function startNextScene() {
        if (taskQueueIndex >= taskQueue.length) {
            finishTaskQueue();
            return;
        }
        var scene = taskQueue[taskQueueIndex];
        currentTaskSceneId = String(scene.id);
        sceneStatuses[currentTaskSceneId] = "Running";
        taskStarting = true;
        setBusy(true);
        var index = taskQueueIndex + 1;
        var detail = "Scene " + index + " of " + taskQueue.length + ": " + (scene.title || "Scene " + scene.id);
        setProgress("Generating scene galleries…", detail, (taskQueueIndex / taskQueue.length));
        var args = {
            mode: "generate",
            scene_id: currentTaskSceneId,
            image_count: getImageCount(),
            sampling_mode: getSamplingMode(),
            library_path: ui.library.value,
            force: taskForce
        };
        graphQLRequest(RUN_TASK_MUTATION, { pluginId: PLUGIN_ID, taskName: TASK_NAME, args: args }).then(function (data) {
            var jobId = data.runPluginTask;
            if (!jobId) throw new Error("Stash did not create a background job.");
            activeJobId = String(jobId);
            taskStarting = false;
            setBusy(true);
            setProgress("Generating scene galleries…", detail + " · Queued in Stash", (taskQueueIndex / taskQueue.length));
            pollJob();
        }).catch(function (error) {
            sceneStatuses[currentTaskSceneId] = "Failed";
            taskFailures.push({ sceneId: currentTaskSceneId, message: error.message || String(error) });
            taskQueueIndex += 1;
            startNextScene();
        });
    }

    function finishTaskQueue() {
        var completed = taskQueue.filter(function (scene) { return sceneStatuses[String(scene.id)] === "Completed"; }).length;
        var failures = taskFailures.slice();
        var cancelled = taskWasCancelled;
        taskQueue = [];
        currentTaskSceneId = "";
        activeJobId = "";
        taskStarting = false;
        setBusy(false);
        if (cancelled) showStatus("Generation cancelled after " + completed + " scene(s) completed.");
        else if (failures.length) showError(failures.length + " scene(s) failed. First failure: scene " + failures[0].sceneId + ": " + failures[0].message);
        else showStatus("Generation completed for " + completed + " scene(s).");
        loadScenes();
    }

    function pollJob() {
        if (!activeJobId) return;
        graphQLRequest(FIND_JOB_QUERY, { input: { id: activeJobId } }).then(function (data) {
            var job = data.findJob;
            if (!job) throw new Error("Stash could not find the gallery generation job.");
            var status = String(job.status || "").toUpperCase();
            var scene = taskQueue[taskQueueIndex];
            var detail = "Scene " + (taskQueueIndex + 1) + " of " + taskQueue.length + ": " + (scene && (scene.title || "Scene " + scene.id) || "");
            if (status === "READY") detail += " · Waiting in the Stash job queue.";
            else if (status === "RUNNING") detail += " · FFmpeg is extracting frames and Stash is indexing the gallery.";
            else if (status === "STOPPING") detail += " · Stopping after the current frame.";
            var localProgress = Number(job.progress || 0);
            if (localProgress > 1) localProgress /= 100;
            var overallProgress = (taskQueueIndex + Math.max(0, Math.min(1, localProgress))) / Math.max(1, taskQueue.length);
            setProgress("Generating scene galleries…", detail, overallProgress);
            if (status === "FINISHED") {
                sceneStatuses[currentTaskSceneId] = "Completed";
                activeJobId = "";
                taskStarting = false;
                taskQueueIndex += 1;
                renderScenes();
                startNextScene();
                return;
            }
            if (status === "FAILED") {
                sceneStatuses[currentTaskSceneId] = "Failed";
                taskFailures.push({ sceneId: currentTaskSceneId, message: job.error || "Stash marked the job as failed." });
                activeJobId = "";
                taskStarting = false;
                taskQueueIndex += 1;
                renderScenes();
                startNextScene();
                return;
            }
            if (status === "CANCELLED") {
                sceneStatuses[currentTaskSceneId] = "Cancelled";
                taskWasCancelled = true;
                taskQueue.slice(taskQueueIndex + 1).forEach(function (queuedScene) {
                    if (sceneStatuses[String(queuedScene.id)] === "Queued") sceneStatuses[String(queuedScene.id)] = "Not started";
                });
                taskQueueIndex = taskQueue.length;
                activeJobId = "";
                taskStarting = false;
                renderScenes();
                finishTaskQueue();
                return;
            }
            pollingTimer = window.setTimeout(pollJob, 1400);
        }).catch(function (error) {
            if (currentTaskSceneId) {
                showError("Could not read the current Stash job. The scene is still running; checking again shortly.");
                pollingTimer = window.setTimeout(pollJob, 3000);
                return;
            }
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
        }).finally(function () { ui.cancel.disabled = !activeJobId; });
    }

    function hideMessages() {
        ui.error.hidden = true;
        ui.status.hidden = true;
    }

    function cacheElements() {
        ui.error = byId("sgb-error");
        ui.status = byId("sgb-status");
        ui.progress = byId("sgb-progress");
        ui.progressTitle = byId("sgb-progress-title");
        ui.progressDetail = byId("sgb-progress-detail");
        ui.progressBar = byId("sgb-progress-bar");
        ui.cancel = byId("sgb-cancel");
        ui.imageCount = byId("sgb-image-count");
        ui.sampling = byId("sgb-sampling");
        ui.library = byId("sgb-library");
        ui.generateMissing = byId("sgb-generate-missing");
        ui.sceneCount = byId("sgb-scene-count");
        ui.autoStatus = byId("sgb-auto-status");
        ui.search = byId("sgb-search");
        ui.sceneBody = byId("sgb-scenes-body");
        ui.pageSummary = byId("sgb-page-summary");
        ui.pagePrev = byId("sgb-page-prev");
        ui.pageNext = byId("sgb-page-next");
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
