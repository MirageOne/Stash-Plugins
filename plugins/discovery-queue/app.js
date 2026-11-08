(function () {
    "use strict";

    var Core = window.StashDiscoveryQueueCore;
    var HOST_THEME_KEY = "discovery-queue.host-theme.v1";
    var USER_PROFILE_KEY = "discoveryQueue";
    var PAGE_SIZE = 100;
    var MAX_POOL = 1000;
    var DISPLAY_LIMIT = 24;
    var PROFILE_QUERY = "query DiscoveryQueueProfile { configuration { ui } }";
    var SAVE_PROFILE_MUTATION = "mutation DiscoveryQueueSaveProfile($partial: Map!) { configureUI(partial: $partial) }";
    var SCENES_QUERY = "query DiscoveryQueueScenes($filter: FindFilterType!, $sceneFilter: SceneFilterType!) { findScenes(filter: $filter, scene_filter: $sceneFilter) { count scenes { id title date created_at rating100 play_count last_played_at resume_time studio { id name } performers { id name } tags { id name } files { duration height } paths { screenshot } } } }";
    var state = {
        profile: Core.defaultProfile(),
        pool: [],
        displayed: [],
        sessionHidden: Object.create(null),
        busy: false,
        loading: false,
        saveTimer: null,
        loadedCount: 0,
        totalCount: 0
    };

    var els = {
        error: document.getElementById("dq-error"),
        status: document.getElementById("dq-status"),
        statusMessage: document.getElementById("dq-status-message"),
        progress: document.getElementById("dq-progress"),
        progressTitle: document.getElementById("dq-progress-title"),
        progressDetail: document.getElementById("dq-progress-detail"),
        progressBar: document.getElementById("dq-progress-bar"),
        queue: document.getElementById("dq-queue"),
        summary: document.getElementById("dq-result-summary"),
        poolNote: document.getElementById("dq-pool-note"),
        learningCount: document.getElementById("dq-learning-count"),
        profile: document.getElementById("dq-profile"),
        mode: document.getElementById("dq-mode"),
        rating: document.getElementById("dq-minimum-rating"),
        ratingOutput: document.getElementById("dq-rating-output"),
        duration: document.getElementById("dq-duration"),
        unplayed: document.getElementById("dq-unplayed-only"),
        title: document.getElementById("dq-title-filter"),
        tag: document.getElementById("dq-tag-filter"),
        performer: document.getElementById("dq-performer-filter"),
        studio: document.getElementById("dq-studio-filter"),
        build: document.getElementById("dq-build"),
        refresh: document.getElementById("dq-refresh"),
        reset: document.getElementById("dq-reset-learning")
    };

    var THEME_PROPERTIES = [
        "--ld-bg", "--ld-surface", "--ld-surface-strong", "--ld-border", "--ld-border-strong",
        "--ld-text", "--ld-muted", "--ld-subtle", "--ld-accent", "--ld-accent-contrast",
        "--ld-primary-bg", "--ld-primary-border", "--ld-primary-text", "--ld-accent-bright",
        "--ld-accent-light", "--ld-accent-rgb", "--ld-accent-soft", "--ld-green", "--ld-orange", "--ld-red",
        "--ld-radius", "--ld-radius-sm", "--ld-font", "--ld-button-font", "--ld-button-size",
        "--ld-button-weight", "--ld-button-line-height", "--ld-button-radius"
    ];

    function applyHostTheme() {
        var root = document.documentElement;
        try {
            var snapshot = JSON.parse(localStorage.getItem(HOST_THEME_KEY) || "null");
            if (snapshot && snapshot.version === 1 && snapshot.tokens && typeof snapshot.tokens === "object") {
                THEME_PROPERTIES.forEach(function (name) {
                    if (typeof snapshot.tokens[name] === "string" && snapshot.tokens[name]) { root.style.setProperty(name, snapshot.tokens[name]); }
                });
                if (snapshot.colorScheme === "light" || snapshot.colorScheme === "dark") { root.style.colorScheme = snapshot.colorScheme; }
                return;
            }
        } catch (error) { /* Keep the Library Doctor defaults if theme handoff is unavailable. */ }
    }

    function setError(message) {
        els.error.textContent = message || "";
        els.error.hidden = !message;
    }

    function setStatus(message) {
        els.statusMessage.textContent = message || "";
        els.status.hidden = !message;
    }

    function setProgress(title, detail, percent) {
        els.progress.hidden = false;
        els.progressTitle.textContent = title;
        els.progressDetail.textContent = detail || "";
        els.progressBar.style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + "%";
    }

    function finishProgress() {
        els.progress.hidden = true;
        els.progressBar.style.width = "0%";
    }

    function request(query, variables) {
        return fetch("/graphql", {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query, variables: variables || {} })
        }).then(function (response) {
            return response.text().then(function (text) {
                var payload;
                try { payload = JSON.parse(text); }
                catch (error) { throw new Error("Stash returned an unreadable response. Confirm you are signed in and reload the page."); }
                if (!response.ok) { throw new Error(payload.errors && payload.errors[0] && payload.errors[0].message || "Stash returned HTTP " + response.status + "."); }
                if (payload.errors && payload.errors.length) { throw new Error(payload.errors.map(function (item) { return item.message || "GraphQL error"; }).join("; ")); }
                return payload.data || {};
            });
        });
    }

    function loadProfile() {
        return request(PROFILE_QUERY).then(function (data) {
            var ui = data && data.configuration && data.configuration.ui;
            state.profile = Core.normalizeProfile(ui && ui[USER_PROFILE_KEY]);
            syncSettingsControls();
            renderLearningProfile();
            return state.profile;
        });
    }

    function saveProfile(profile) {
        var partial = {};
        partial[USER_PROFILE_KEY] = Core.normalizeProfile(profile);
        return request(SAVE_PROFILE_MUTATION, { partial: partial }).then(function (data) {
            var saved = data && data.configureUI;
            if (!saved || typeof saved !== "object" || !saved[USER_PROFILE_KEY]) {
                throw new Error("Stash did not confirm saving Discovery Queue preferences to this user's UI settings.");
            }
            return true;
        });
    }

    function persistProfile(nextProfile, message) {
        var previous = state.profile;
        state.profile = Core.normalizeProfile(nextProfile);
        renderLearningProfile();
        return saveProfile(state.profile).then(function () {
            if (message) { setStatus(message); }
            return true;
        }).catch(function (error) {
            state.profile = previous;
            renderLearningProfile();
            setError("Your account did not save this learning choice. " + error.message);
            return false;
        });
    }

    function syncSettingsControls() {
        var settings = state.profile.settings;
        els.mode.value = settings.mode;
        els.rating.value = String(settings.minimumRating);
        els.ratingOutput.value = settings.minimumRating + (settings.minimumRating ? "+" : "");
        els.duration.value = settings.duration;
        els.unplayed.checked = Boolean(settings.unplayedOnly);
        els.title.value = settings.title;
        els.tag.value = settings.tag;
        els.performer.value = settings.performer;
        els.studio.value = settings.studio;
    }

    function settingsFromControls() {
        return {
            mode: els.mode.value,
            minimumRating: Number(els.rating.value) || 0,
            duration: els.duration.value,
            unplayedOnly: els.unplayed.checked,
            title: els.title.value.trim(),
            tag: els.tag.value.trim(),
            performer: els.performer.value.trim(),
            studio: els.studio.value.trim()
        };
    }

    function saveCurrentSettings(showMessage) {
        var next = Core.normalizeProfile(state.profile);
        next.settings = settingsFromControls();
        if (state.saveTimer) { window.clearTimeout(state.saveTimer); }
        if (showMessage) {
            return persistProfile(next, "Your queue settings are saved to this Stash account.");
        }
        state.profile = next;
        renderLearningProfile();
        state.saveTimer = window.setTimeout(function () {
            state.saveTimer = null;
            saveProfile(state.profile).catch(function (error) { setError("Could not save your queue settings. " + error.message); });
        }, 350);
        return Promise.resolve(true);
    }

    function renderLearningProfile() {
        var events = state.profile.events || [];
        var counts = { like: 0, finished: 0, skip: 0, less: 0 };
        events.forEach(function (event) { if (counts[event.action] !== undefined) { counts[event.action] += 1; } });
        els.learningCount.textContent = events.length ? events.length + " learning choice" + (events.length === 1 ? "" : "s") : "Learning from your choices";
        els.profile.textContent = "";
        var label = document.createElement("span");
        label.className = "dq-profile-label";
        label.textContent = events.length ? "Your taste" : "Learning is ready";
        els.profile.appendChild(label);
        if (events.length) {
            var summary = document.createElement("span");
            summary.textContent = counts.like + " liked · " + counts.finished + " finished · " + counts.skip + " skipped · " + counts.less + " marked less like this";
            els.profile.appendChild(summary);
        } else {
            var intro = document.createElement("span");
            intro.textContent = "Use Like, Finished, Skip, or Less like this to tune future picks.";
            els.profile.appendChild(intro);
        }
        Core.topAffinities(state.profile, 5).forEach(function (item) {
            var chip = document.createElement("span");
            chip.className = "dq-affinity-chip" + (item.weight < 0 ? " is-avoid" : "");
            chip.textContent = item.weight < 0 ? "Less " + item.name : item.name;
            chip.title = item.type.slice(0, -1) + " preference";
            els.profile.appendChild(chip);
        });
    }

    function sceneDuration(scene) { return Core.sceneDuration(scene); }

    function formatDuration(seconds) {
        var value = Math.floor(Number(seconds) || 0);
        var hours = Math.floor(value / 3600);
        var minutes = Math.floor(value % 3600 / 60);
        return hours ? hours + "h " + minutes + "m" : minutes + " min";
    }

    function sceneHeight(scene) {
        return (Array.isArray(scene.files) ? scene.files : []).reduce(function (max, file) { return Math.max(max, Number(file && file.height) || 0); }, 0);
    }

    function sceneRating(scene) {
        return Number(scene.rating100) > 0 ? Math.round(Number(scene.rating100)) + "/100" : "Not rated";
    }

    function sceneReason(scene) {
        var candidates = [];
        var affinities = state.profile.affinities;
        (scene.tags || []).forEach(function (item) { var pref = affinities.tags[String(item.id)]; if (pref && pref.weight > 0) { candidates.push({ name: item.name, type: "tag", weight: pref.weight }); } });
        (scene.performers || []).forEach(function (item) { var pref = affinities.performers[String(item.id)]; if (pref && pref.weight > 0) { candidates.push({ name: item.name, type: "performer", weight: pref.weight }); } });
        if (scene.studio) { var studio = affinities.studios[String(scene.studio.id)]; if (studio && studio.weight > 0) { candidates.push({ name: scene.studio.name, type: "studio", weight: studio.weight }); } }
        candidates.sort(function (a, b) { return b.weight - a.weight; });
        return candidates.length ? "Because you liked " + candidates[0].type + " " + candidates[0].name : "Picked from your current filters";
    }

    function createText(tagName, className, value) {
        var element = document.createElement(tagName);
        if (className) { element.className = className; }
        if (value !== undefined && value !== null) { element.textContent = value; }
        return element;
    }

    function createSceneCard(scene, position) {
        var card = createText("article", "dq-card");
        var path = scene.paths && scene.paths.screenshot || "";
        var imageLink = document.createElement("a");
        imageLink.className = "dq-card-image-link";
        imageLink.href = "/scenes/" + encodeURIComponent(String(scene.id));
        imageLink.target = "_blank";
        imageLink.rel = "noopener";
        imageLink.setAttribute("aria-label", "Open scene " + (scene.title || "Untitled scene"));
        if (path) {
            var image = document.createElement("img");
            image.className = "dq-card-image";
            image.src = path;
            image.alt = "";
            image.loading = "lazy";
            image.onerror = function () { image.remove(); imageLink.appendChild(createText("span", "dq-card-image is-missing", "▶")); };
            imageLink.appendChild(image);
        } else {
            imageLink.appendChild(createText("span", "dq-card-image is-missing", "▶"));
        }
        card.appendChild(imageLink);

        var content = createText("div", "dq-card-content");
        var topline = createText("div", "dq-card-topline");
        var heading = createText("h3", "dq-card-title");
        var titleLink = createText("a", "", scene.title || "Untitled scene");
        titleLink.href = "/scenes/" + encodeURIComponent(String(scene.id));
        titleLink.target = "_blank";
        titleLink.rel = "noopener";
        heading.appendChild(titleLink);
        topline.appendChild(heading);
        topline.appendChild(createText("span", "dq-card-rank", String(position + 1).padStart(2, "0")));
        content.appendChild(topline);

        var metadata = [];
        if (scene.studio && scene.studio.name) { metadata.push(scene.studio.name); }
        if (scene.date) { metadata.push(String(scene.date).slice(0, 10)); }
        var duration = sceneDuration(scene);
        if (duration) { metadata.push(formatDuration(duration)); }
        var height = sceneHeight(scene);
        if (height) { metadata.push(Math.round(height) + "p"); }
        metadata.push(sceneRating(scene));
        content.appendChild(createText("p", "dq-card-meta", metadata.join(" · ")));

        var taxonomy = createText("div", "dq-card-taxonomy");
        (scene.tags || []).slice(0, 4).forEach(function (tag) { taxonomy.appendChild(createText("span", "dq-chip", tag.name)); });
        (scene.performers || []).slice(0, 3).forEach(function (performer) { taxonomy.appendChild(createText("span", "dq-chip", performer.name)); });
        if (taxonomy.childNodes.length) { content.appendChild(taxonomy); }
        content.appendChild(createText("p", "dq-reason", sceneReason(scene)));

        var prior = state.profile.sceneFeedback[String(scene.id)];
        if (prior) { content.appendChild(createText("span", "dq-card-feedback", feedbackLabel(prior.action))); }
        var actions = createText("div", "dq-card-actions");
        var play = createText("a", "ld-button ld-button-primary", "Play");
        play.href = "/scenes/" + encodeURIComponent(String(scene.id));
        play.target = "_blank";
        play.rel = "noopener";
        actions.appendChild(play);
        [
            ["like", "More like this", "ld-button ld-button-secondary"],
            ["finished", "Finished", "ld-button ld-button-secondary"],
            ["skip", "Skip", "ld-button ld-button-quiet"],
            ["less", "Less like this", "ld-button ld-button-quiet"]
        ].forEach(function (definition) {
            var button = createText("button", definition[2], definition[1]);
            button.type = "button";
            button.dataset.action = definition[0];
            button.dataset.sceneId = String(scene.id);
            button.title = definition[0] === "finished" ? "Teach the queue that you watched this scene. Stash play history is unchanged." : definition[1];
            if (prior && prior.action === definition[0]) { button.disabled = true; button.setAttribute("aria-pressed", "true"); }
            actions.appendChild(button);
        });
        content.appendChild(actions);
        card.appendChild(content);
        return card;
    }

    function feedbackLabel(action) {
        return { like: "Taste saved", finished: "Marked finished for this queue", skip: "Skipped for now", less: "Preference updated" }[action] || "Feedback saved";
    }

    function renderQueue(message) {
        var filters = settingsFromControls();
        var candidates = Core.filterScenes(state.pool, state.profile, filters).filter(function (scene) { return !state.sessionHidden[String(scene.id)]; });
        var ranked = Core.rankScenes(candidates, state.profile, filters).slice(0, DISPLAY_LIMIT);
        state.displayed = ranked;
        els.queue.textContent = "";
        if (!ranked.length) {
            var empty = createText("div", "ld-empty-results");
            empty.appendChild(createText("span", "ld-empty-icon", "✦"));
            empty.appendChild(createText("strong", "", state.pool.length ? "No scenes match those filters." : "No scenes are ready for this queue."));
            empty.appendChild(createText("span", "", state.pool.length ? "Try changing a filter or widening the rating and runtime range." : "Reload your scene pool or clear the filters to try again."));
            els.queue.appendChild(empty);
        } else {
            ranked.forEach(function (scene, index) { els.queue.appendChild(createSceneCard(scene, index)); });
        }
        var hiddenCount = Math.max(0, state.pool.length - candidates.length);
        var modeNames = { "for-you": "For you", random: "Surprise me", rating: "Highest rated", recent: "Recently added" };
        els.summary.textContent = ranked.length + " picks · " + (modeNames[filters.mode] || "For you") + (hiddenCount ? " · " + hiddenCount + " filtered out" : "");
        els.poolNote.textContent = state.totalCount ? "Loaded " + state.pool.length.toLocaleString() + " of " + state.totalCount.toLocaleString() + " scenes" : "";
        if (message) { setStatus(message); }
    }

    function updateProgress(page, count) {
        var percent = count > 0 ? Math.min(100, state.pool.length / Math.min(count, MAX_POOL) * 100) : page * 10;
        setProgress("Loading your library…", state.pool.length.toLocaleString() + (count ? " of " + count.toLocaleString() : "") + " scenes", percent);
    }

    function queryScenePage(page, titleQuery) {
        var filter = { page: page, per_page: PAGE_SIZE, sort: "created_at", direction: "DESC" };
        if (titleQuery) { filter.q = titleQuery; }
        return request(SCENES_QUERY, { filter: filter, sceneFilter: {} }).then(function (data) {
            var result = data && data.findScenes;
            if (!result) { throw new Error("Stash did not return a scene list."); }
            return result;
        });
    }

    function buildQueue(options) {
        if (state.loading) { return; }
        state.loading = true;
        state.sessionHidden = Object.create(null);
        state.pool = [];
        state.displayed = [];
        els.build.disabled = true;
        els.refresh.disabled = true;
        setError("");
        els.queue.textContent = "";
        var titleQuery = options.title || "";
        var page = 1;
        function loadPage() {
            return queryScenePage(page, titleQuery).then(function (result) {
                state.totalCount = Number(result.count) || 0;
                var items = Array.isArray(result.scenes) ? result.scenes : [];
                state.pool = state.pool.concat(items);
                updateProgress(page, state.totalCount);
                var canContinue = state.pool.length < Math.min(state.totalCount, MAX_POOL) && items.length === PAGE_SIZE;
                if (canContinue) { page += 1; return loadPage(); }
                state.loadedCount = state.pool.length;
                finishProgress();
                renderQueue("Queue ready from your library.");
            });
        }
        loadPage().catch(function (error) {
            finishProgress();
            setError("Could not build the queue. " + error.message);
            els.queue.innerHTML = '<div class="ld-empty-results"><strong>Could not load scenes.</strong><span>Check that Stash is available and reload the queue.</span></div>';
        }).finally(function () {
            state.loading = false;
            els.build.disabled = false;
            els.refresh.disabled = false;
        });
    }

    function onFeedback(event) {
        var button = event.target.closest && event.target.closest("button[data-action][data-scene-id]");
        if (!button || button.disabled) { return; }
        var scene = state.pool.filter(function (item) { return String(item.id) === button.dataset.sceneId; })[0];
        if (!scene) { return; }
        var action = button.dataset.action;
        var next = Core.applyFeedback(state.profile, scene, action);
        if (["finished", "skip", "less"].indexOf(action) !== -1) { state.sessionHidden[String(scene.id)] = true; }
        button.disabled = true;
        persistProfile(next, "Choice saved to your Stash account. Future picks will adapt.").then(function (saved) {
            if (!saved) { delete state.sessionHidden[String(scene.id)]; return; }
            renderQueue("Future picks will reflect your choice.");
        });
    }

    function refreshSettings() {
        els.ratingOutput.value = Number(els.rating.value) ? Number(els.rating.value) + "+" : "0";
        saveCurrentSettings(false);
        if (state.pool.length) { renderQueue(); }
    }

    function resetLearning() {
        if (!window.confirm("Reset learned scene, tag, performer, and studio preferences for this Stash account? Your queue filters will stay saved.")) { return; }
        var next = Core.resetLearning(state.profile);
        persistProfile(next, "Learned preferences were reset for this account.").then(function (saved) {
            if (saved && state.pool.length) { renderQueue(); }
        });
    }

    function bindEvents() {
        els.build.addEventListener("click", function () { saveCurrentSettings(false).then(function () { buildQueue(settingsFromControls()); }); });
        els.refresh.addEventListener("click", function () { if (state.pool.length) { state.sessionHidden = Object.create(null); renderQueue("Picks refreshed from the current scene pool."); } else { buildQueue(settingsFromControls()); } });
        els.reset.addEventListener("click", resetLearning);
        els.queue.addEventListener("click", onFeedback);
        [els.mode, els.duration, els.unplayed, els.title, els.tag, els.performer, els.studio].forEach(function (control) {
            control.addEventListener("change", refreshSettings);
            if (control.type === "search") { control.addEventListener("input", refreshSettings); }
        });
        els.rating.addEventListener("input", refreshSettings);
        window.addEventListener("storage", function (event) { if (event.key === HOST_THEME_KEY) { applyHostTheme(); } });
        window.addEventListener("current-theme:preferences-changed", applyHostTheme);
    }

    function start() {
        applyHostTheme();
        bindEvents();
        loadProfile().then(function () {
            setStatus("Ready to build your queue.");
        }).catch(function (error) {
            setError("Could not load account preferences. " + error.message);
        });
    }

    start();
}());
