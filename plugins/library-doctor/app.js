(function () {
    "use strict";

    var PAGE_SIZE = 50;
    var SCAN_PAGE_SIZE = 200;
    var SCRAPE_BATCH_SIZE = 25;
    var REVIEWED_DUPLICATES_KEY = "library-doctor.reviewedDuplicates";
    var HOST_THEME_KEY = "library-doctor.host-theme.v1";
    var HOST_THEME_PROPERTIES = [
        "--ld-bg", "--ld-surface", "--ld-surface-strong", "--ld-border", "--ld-border-strong",
        "--ld-text", "--ld-muted", "--ld-subtle", "--ld-accent", "--ld-accent-contrast",
        "--ld-primary-bg", "--ld-primary-border", "--ld-primary-text",
        "--ld-accent-bright", "--ld-accent-light", "--ld-accent-rgb", "--ld-accent-soft",
        "--ld-green", "--ld-orange", "--ld-red", "--ld-radius", "--ld-radius-sm",
        "--ld-font", "--ld-button-font", "--ld-button-size", "--ld-button-weight",
        "--ld-button-line-height", "--ld-button-radius"
    ];
    var FRESH_SCENE_QUERY = "query LibraryDoctorFreshScene($id: ID!) { findScene(id: $id) { id title date tags { id name } } }";
    var UPDATE_SCENE_MUTATION = "mutation LibraryDoctorUpdateScene($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id title date tags { id name } } }";
    var SCRAPERS_QUERY = "query LibraryDoctorScrapers { listScrapers(types: [SCENE]) { id name } }";
    var IDENTIFY_SOURCES_QUERY = "query LibraryDoctorIdentifySources { configuration { general { stashBoxes { name endpoint } } defaults { identify { sources { source { scraper_id stash_box_endpoint stash_box_index } } } } } }";
    var SCRAPE_SCENES_QUERY = "query LibraryDoctorScrapeScenes($source: ScraperSourceInput!, $input: ScrapeMultiScenesInput!) { scrapeMultiScenes(source: $source, input: $input) { title date tags { stored_id name } } }";
    var TAG_CATALOG_QUERY = "query LibraryDoctorTagCatalog($page: Int!, $perPage: Int!) { findTags(filter: { page: $page, per_page: $perPage }) { count tags { id name aliases } } }";
    var TAG_CREATE_MUTATION = "mutation LibraryDoctorCreateTag($input: TagCreateInput!) { tagCreate(input: $input) { id name aliases } }";
    var DELETE_FILES_MUTATION = "mutation LibraryDoctorDeleteDuplicateFile($ids: [ID!]!) { deleteFiles(ids: $ids) }";
    var SET_PRIMARY_FILE_MUTATION = "mutation LibraryDoctorSetPrimaryFile($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }";
    var QUERY = "query LibraryDoctorScenes($page: Int!, $perPage: Int!) { " +
        "findScenes(filter: { page: $page, per_page: $perPage, sort: \"title\", direction: ASC }) { " +
        "count scenes { id title date organized files { id path size duration ... on VideoFile { format width height video_codec audio_codec frame_rate bit_rate } } " +
        "paths { screenshot preview } studio { id name } performers { id name } tags { id name } } } }";
    var RUN_ENCODING_TASK = "mutation LibraryDoctorReencode($args: Map!) { runPluginTask(plugin_id: \"library-doctor\", task_name: \"Re-encode scene file\", args_map: $args) }";
    var FIND_JOB_QUERY = "query LibraryDoctorEncodingJob($input: FindJobInput!) { findJob(input: $input) { id status progress error subTasks } }";
    var ENCODING_CONFIG_QUERY = "query LibraryDoctorEncodingConfig { configuration { general { metadataPath } } }";
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
    var scrapers = [];
    var configuredScraperCount = 0;
    var scrapersLoaded = false;
    var scrapersLoading = false;
    var tagCatalog = null;
    var tagCatalogPromise = null;
    var fixSelectedTags = [];
    var scrapeEntries = [];
    var scrapeAttempted = Object.create(null);
    var scrapeStats = { total: 0, processed: 0, exact: 0, applied: 0, review: 0, noMatch: 0, errors: 0, tagsAdded: 0, tagsCreated: 0 };
    var scrapeBusy = false;
    var encodingFiles = [];
    var encodingFilesForResults = null;
    var encodingBusy = false;
    var encodingJobTimer = null;
    var encodingMetadataPath = "";
    var encodingSettings = {
        h264_compat: { codec: "libx264", crf: 22, speed: "medium", height: 0, audio: "aac192" },
        h264_quality: { codec: "libx264", crf: 18, speed: "slow", height: 0, audio: "copy" },
        hevc_saver: { codec: "libx265", crf: 28, speed: "medium", height: 0, audio: "copy" },
        hevc_quality: { codec: "libx265", crf: 23, speed: "slow", height: 0, audio: "copy" }
    };
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

    function applyHostTheme() {
        var root = document.documentElement;
        var tokenMap = {
            "--ld-bg": "--bg-0",
            "--ld-surface": "--glass-bg",
            "--ld-surface-strong": "--glass-bg-strong",
            "--ld-border": "--glass-border",
            "--ld-border-strong": "--glass-border-bright",
            "--ld-text": "--text",
            "--ld-muted": "--text-muted",
            "--ld-subtle": "--text-muted",
            "--ld-accent": "--accent",
            "--ld-accent-contrast": "--accent-contrast",
            "--ld-accent-soft": "--accent-tint",
            "--ld-accent-bright": "--accent-bright",
            "--ld-accent-light": "--accent-light",
            "--ld-accent-rgb": "--accent-rgb",
            "--ld-font": "--theme-font-stack",
            "--ld-radius": "--radius",
            "--ld-radius-sm": "--radius-sm"
        };
        try {
            var hostTheme = JSON.parse(localStorage.getItem(HOST_THEME_KEY) || "null");
            if (hostTheme && hostTheme.version === 1 && hostTheme.tokens && typeof hostTheme.tokens === "object") {
                HOST_THEME_PROPERTIES.forEach(function (name) {
                    var value = hostTheme.tokens[name];
                    if (typeof value === "string" && value) { root.style.setProperty(name, value); }
                });
                if (hostTheme.colorScheme === "light" || hostTheme.colorScheme === "dark") {
                    root.style.colorScheme = hostTheme.colorScheme;
                }
                return;
            }
            HOST_THEME_PROPERTIES.forEach(function (name) { root.style.removeProperty(name); });
            root.style.removeProperty("color-scheme");

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
            if (sharedAccent) root.style.setProperty("--ld-accent", sharedAccent);
            if (sharedTint) root.style.setProperty("--ld-accent-soft", sharedTint);
            if (sharedRgb) root.style.setProperty("--ld-accent-rgb", sharedRgb);
            var legacyKey = localStorage.getItem("fluent-mica.accent");
            if (!sharedAccent && legacyKey && ACCENTS[legacyKey]) {
                var rgb = ACCENTS[legacyKey].match(/[0-9a-f]{2}/gi).map(function (v) { return parseInt(v, 16); }).join(", ");
                root.style.setProperty("--ld-accent", ACCENTS[legacyKey]);
                root.style.setProperty("--ld-accent-rgb", rgb);
                root.style.setProperty("--ld-accent-soft", "rgba(" + rgb + ", 0.16)");
            }
        } catch (e) { /* the default Fluent blue remains usable */ }
    }

    window.addEventListener("storage", function (event) {
        if (event.key === HOST_THEME_KEY || event.key === "stash.theme.tokens.v1" || event.key === "mv.theme.accent" ||
                event.key === "mv.theme.accentTint" || event.key === "mv.theme.accentRgb" ||
                event.key === "fluent-mica.accent" || event.key === "noir-theme.accent") {
            applyHostTheme();
        }
    });

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
            tags: Array.isArray(source.tags) ? source.tags.map(function (tag) {
                return { id: String(tag && tag.id || ""), name: String(tag && tag.name || "").trim() };
            }).filter(function (tag) { return !!tag.id; }) : [],
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
        if (!scene.tags.length) { addIssue(scene, "No tags", "metadata"); }
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

    function fileResolutionPixels(file) {
        var width = Number(file && file.width);
        var height = Number(file && file.height);
        return isFinite(width) && width > 0 && isFinite(height) && height > 0 ? width * height : null;
    }

    function formatFileResolution(file) {
        var width = Number(file && file.width);
        var height = Number(file && file.height);
        return isFinite(width) && width > 0 && isFinite(height) && height > 0
            ? Math.round(width) + " × " + Math.round(height)
            : "Resolution unavailable";
    }

    function formatFileBitrate(value) {
        var bitrate = Number(value);
        return isFinite(bitrate) && bitrate > 0 ? (bitrate / 1000000).toFixed(1) + " Mb/s" : "Bitrate unavailable";
    }

    function formatFileFrameRate(value) {
        var frameRate = Number(value);
        return isFinite(frameRate) && frameRate > 0 ? frameRate.toFixed(2).replace(/\.?0+$/, "") + " fps" : "Frame rate unavailable";
    }

    function duplicateFileEntries(scenes) {
        var entries = [];
        scenes.forEach(function (scene) {
            (scene.files || []).forEach(function (file) {
                if (file) { entries.push({ scene: scene, file: file }); }
            });
        });
        return entries;
    }

    function recommendKeepFile(scenes) {
        var candidates = duplicateFileEntries(scenes);
        if (candidates.length < 2) {
            return { entry: null, reason: "A recommendation needs at least two file records to compare." };
        }
        var criteria = [
            { name: "resolution", value: function (file) { return fileResolutionPixels(file); }, display: function (file) { return formatFileResolution(file); } },
            { name: "video bitrate", value: function (file) { var value = Number(file.bit_rate); return isFinite(value) && value > 0 ? value : null; }, display: function (file) { return formatFileBitrate(file.bit_rate); } },
            { name: "frame rate", value: function (file) { var value = Number(file.frame_rate); return isFinite(value) && value > 0 ? value : null; }, display: function (file) { return formatFileFrameRate(file.frame_rate); } },
            { name: "file size", value: function (file) { var value = Number(file.size); return isFinite(value) && value > 0 ? value : null; }, display: function (file) { return formatBytes(file.size); } }
        ];
        var remaining = candidates.slice();
        var reasons = [];
        criteria.some(function (criterion) {
            if (remaining.length < 2) { return true; }
            var values = remaining.map(function (entry) { return criterion.value(entry.file); });
            if (values.some(function (value) { return value === null; })) { return false; }
            var highest = Math.max.apply(Math, values);
            var lowest = Math.min.apply(Math, values);
            if (highest === lowest) { return false; }
            remaining = remaining.filter(function (entry) { return criterion.value(entry.file) === highest; });
            reasons.push("highest " + criterion.name + " (" + criterion.display(remaining[0].file) + ")");
            return remaining.length === 1;
        });
        return remaining.length === 1
            ? { entry: remaining[0], reason: "Recommended by " + reasons.join(", then ") + "." }
            : { entry: null, reason: "No clear recommendation: the available file details are tied or incomplete. Compare the files manually." };
    }

    function deleteDuplicateFile(scene, file, button) {
        if (!file || !file.id || button.disabled) { return; }
        var path = String(file.path || "").trim() || ("file ID " + file.id);
        var confirmed = window.confirm("Delete this file from Stash?\n\n" + path + "\n\nStash will remove the file and its library record. If required, another attached file will be promoted to primary first. This review has no undo.");
        if (!confirmed) { return; }
        button.disabled = true;
        button.textContent = "Deleting…";
        clearError();
        var changedPrimary = false;
        var newPrimaryFilePath = "";
        function requestDelete() {
            return graphQLRequest(DELETE_FILES_MUTATION, { ids: [String(file.id)] }).then(function (data) {
                if (data.deleteFiles !== true) { throw new Error("Stash did not confirm deleting the file."); }
            });
        }
        requestDelete().catch(function (error) {
            var message = error && error.message ? error.message : String(error);
            if (!/cannot delete primary file/i.test(message)) { throw error; }
            var alternate = scene.files.find(function (candidate) {
                return candidate && candidate.id && String(candidate.id) !== String(file.id);
            });
            if (!alternate) {
                throw new Error("Stash prevents deleting a scene's only primary file unless the entire scene is deleted. Library Doctor kept the scene metadata intact; delete the scene and file together in Stash if that is intended.");
            }
            return graphQLRequest(SET_PRIMARY_FILE_MUTATION, {
                input: { id: String(scene.id), primary_file_id: String(alternate.id) }
            }).then(function (data) {
                if (!data.sceneUpdate || String(data.sceneUpdate.id) !== String(scene.id)) {
                    throw new Error("Stash did not confirm changing the scene's primary file.");
                }
                changedPrimary = true;
                newPrimaryFilePath = String(alternate.path || "");
                return requestDelete();
            });
        }).then(function () {
            var removedFromScan = false;
            results.forEach(function (scene) {
                var previousLength = scene.files.length;
                scene.files = scene.files.filter(function (candidate) { return String(candidate.id) !== String(file.id); });
                if (scene.files.length === previousLength) { return; }
                removedFromScan = true;
                scene._doctorIssues = scene._doctorIssues.filter(function (issue) { return issue.label !== "No file reference"; });
                if (!scene.files.some(function (candidate) { return candidate && String(candidate.path || "").trim(); })) {
                    addIssue(scene, "No file reference", "files");
                }
            });
            encodingFilesForResults = null;
            encodingFiles = [];
            render();
            var statusMessage = removedFromScan
                ? "Deleted " + path + " from Stash."
                : "Deleted " + path + ". Run Health Check again to refresh the review results.";
            if (changedPrimary) {
                statusMessage += " Set " + (fileBasename(newPrimaryFilePath) || "another attached file") + " as the scene's primary file.";
            }
            showStatus(statusMessage);
        }).catch(function (error) {
            var errorMessage = "Could not delete " + path + ": " + (error && error.message ? error.message : String(error));
            if (changedPrimary) {
                errorMessage += " Stash did set " + (fileBasename(newPrimaryFilePath) || "another attached file") + " as the scene's primary file.";
            }
            showError(errorMessage);
        }).then(function () {
            if (button.isConnected) {
                button.disabled = false;
                button.textContent = "Delete file";
            }
        });
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
            var recommendation = recommendKeepFile(group.scenes);
            var recommendationBox = document.createElement("div");
            recommendationBox.className = "ld-duplicate-recommendation" + (recommendation.entry ? " has-recommendation" : "");
            var recommendationTitle = document.createElement("strong");
            recommendationTitle.textContent = recommendation.entry ? "Suggested file to keep" : "No clear keep recommendation";
            var recommendationReason = document.createElement("span");
            recommendationReason.textContent = recommendation.reason + (recommendation.entry
                ? " This technical heuristic does not assess visual quality or codec efficiency; compare before deleting."
                : "");
            recommendationBox.append(recommendationTitle, recommendationReason);
            var list = document.createElement("ul");
            list.className = "ld-duplicate-scenes";
            group.scenes.forEach(function (scene) {
                var item = document.createElement("li");
                var sceneHeading = document.createElement("div");
                sceneHeading.className = "ld-duplicate-scene-heading";
                var details = document.createElement("div");
                details.className = "ld-duplicate-scene-details";
                var sceneTitle = document.createElement("strong");
                sceneTitle.textContent = scene.title || "Untitled scene";
                var metadata = document.createElement("span");
                metadata.className = "ld-duplicate-meta";
                metadata.textContent = [scene.studio, scene.date, scene.performers.join(", ")].filter(Boolean).join(" · ") || "No additional scene details";
                details.append(sceneTitle, metadata);
                var open = document.createElement("a");
                open.className = "ld-open-scene";
                open.href = "/scenes/" + encodeURIComponent(scene.id);
                open.target = "_blank";
                open.rel = "noopener noreferrer";
                open.textContent = "Open scene";
                open.setAttribute("aria-label", "Open " + (scene.title || "scene") + " in Stash");
                sceneHeading.append(details, open);
                item.appendChild(sceneHeading);
                var fileList = document.createElement("ul");
                fileList.className = "ld-duplicate-files";
                if (!scene.files.length) {
                    var noFiles = document.createElement("li");
                    noFiles.className = "ld-duplicate-no-files";
                    noFiles.textContent = "No file records are attached to this scene.";
                    fileList.appendChild(noFiles);
                }
                scene.files.forEach(function (file) {
                    var recommended = recommendation.entry && recommendation.entry.file === file;
                    var fileItem = document.createElement("li");
                    fileItem.className = "ld-duplicate-file-card" + (recommended ? " is-recommended" : "");
                    var fileDetails = document.createElement("div");
                    fileDetails.className = "ld-duplicate-file-details";
                    var fileName = document.createElement("strong");
                    fileName.textContent = fileBasename(file.path) || "File path unavailable";
                    var fullPath = document.createElement("span");
                    fullPath.className = "ld-duplicate-file-path";
                    fullPath.textContent = String(file.path || "Full path unavailable");
                    var videoCodec = String(file.video_codec || "Video codec unavailable");
                    var fileInfo = document.createElement("span");
                    fileInfo.className = "ld-duplicate-file-info";
                    fileInfo.textContent = [
                        formatFileResolution(file),
                        videoCodec,
                        formatFileBitrate(file.bit_rate),
                        formatFileFrameRate(file.frame_rate),
                        formatDuration(file.duration),
                        formatBytes(file.size)
                    ].join(" · ");
                    fileDetails.append(fileName, fullPath, fileInfo);
                    var fileActions = document.createElement("div");
                    fileActions.className = "ld-duplicate-file-actions";
                    if (recommended) {
                        var keepBadge = document.createElement("span");
                        keepBadge.className = "ld-duplicate-keep-badge";
                        keepBadge.textContent = "Recommended keep";
                        fileActions.appendChild(keepBadge);
                    }
                    if (file.id) {
                        var deleteButton = document.createElement("button");
                        deleteButton.className = "ld-delete-file-button";
                        deleteButton.type = "button";
                        deleteButton.textContent = "Delete file";
                        deleteButton.setAttribute("aria-label", "Delete file " + (file.path || file.id));
                        deleteButton.addEventListener("click", function () { deleteDuplicateFile(scene, file, deleteButton); });
                        fileActions.appendChild(deleteButton);
                    } else {
                        var deleteUnavailable = document.createElement("span");
                        deleteUnavailable.className = "ld-duplicate-delete-unavailable";
                        deleteUnavailable.textContent = "File ID unavailable";
                        fileActions.appendChild(deleteUnavailable);
                    }
                    fileItem.append(fileDetails, fileActions);
                    fileList.appendChild(fileItem);
                });
                item.appendChild(fileList);
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
            card.append(heading, explanation, recommendationBox, list, actions);
            return card;
        }));
        els.duplicateEmpty.hidden = visibleGroups.length > 0;
    }

    function renderMetadataQueue() {
        var scenes = results.filter(function (scene) {
            return hasIssue(scene, "Missing title") || hasIssue(scene, "Missing date") || hasIssue(scene, "No tags");
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
            if (hasIssue(scene, "No tags")) {
                fields.appendChild(makeTagSuggestion());
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
                : "Run Health Check to look for missing titles, dates, and tags.";
            els.metadataEmpty.hidden = false;
        } else if (!scenes.length) {
            els.metadataEmpty.textContent = "No missing titles, dates, or tags were found in this health check.";
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

    function makeTagSuggestion() {
        var row = document.createElement("div");
        row.className = "ld-metadata-suggestion";
        var name = document.createElement("span");
        name.className = "ld-metadata-label";
        name.textContent = "Tags";
        var value = document.createElement("strong");
        value.textContent = "Choose one or more existing tags";
        var source = document.createElement("small");
        source.textContent = "Add tags from your Stash tag list in the review dialog.";
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
            return hasIssue(scene, "Missing title") || hasIssue(scene, "Missing date") || hasIssue(scene, "No tags");
        }).length.toLocaleString();
        els.duplicatesTabCount.textContent = buildDuplicateGroups(results).length.toLocaleString();
        els.scrapeTabCount.textContent = results.filter(hasScrapeGaps).length.toLocaleString();
        els.encodingTabCount.textContent = listEncodingFiles().length.toLocaleString();
        if (currentWorkspace === "encoding") { renderEncodingAuditor(); }
        updateScrapeControls();
    }

    function listEncodingFiles() {
        if (encodingFilesForResults === results) { return encodingFiles; }
        encodingFiles = results.reduce(function (all, scene) {
            (scene.files || []).forEach(function (file) {
                if (file && file.id && file.path && Number(file.width) > 0 && Number(file.height) > 0) {
                    all.push({
                        id: String(file.id), sceneId: scene.id, title: scene.title || "Untitled scene",
                        path: String(file.path), size: Number(file.size) || 0, duration: Number(file.duration) || 0,
                        width: Number(file.width) || 0, height: Number(file.height) || 0,
                        codec: String(file.video_codec || "unknown"), audio: String(file.audio_codec || "unknown"),
                        format: String(file.format || "unknown"), frameRate: Number(file.frame_rate) || 0,
                        bitRate: Number(file.bit_rate) || 0
                    });
                }
            });
            return all;
        }, []);
        encodingFilesForResults = results;
        return encodingFiles;
    }

    function formatBytes(bytes) {
        if (!bytes) { return "size unavailable"; }
        var units = ["B", "KB", "MB", "GB", "TB"];
        var value = bytes;
        var index = 0;
        while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
        return value.toFixed(index > 1 ? 1 : 0) + " " + units[index];
    }

    function fileName(path) { return String(path || "").split(/[\\/]/).pop() || String(path || ""); }

    function fileExtension(path) {
        var name = fileName(path);
        var dot = name.lastIndexOf(".");
        return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : "mkv";
    }

    function fileStem(path) {
        var name = fileName(path);
        var dot = name.lastIndexOf(".");
        return dot > 0 ? name.slice(0, dot) : name;
    }

    function encodingFileLabel(file) {
        return file.title + " — " + fileName(file.path) + " · " + file.width + "×" + file.height + " · " + file.codec + " · " + formatBytes(file.size);
    }

    function buildEncodingResolutionFilters(files) {
        var filters = [{ value: "all", label: "All resolutions", type: "all", count: files.length }];
        var ranges = [
            { value: "range:0:480", label: "480p and below", min: 0, max: 480 },
            { value: "range:481:720", label: "Above 480p to 720p", min: 481, max: 720 },
            { value: "range:721:1080", label: "Above 720p to 1080p", min: 721, max: 1080 },
            { value: "range:1081:0", label: "Above 1080p", min: 1081, max: Infinity }
        ];
        ranges.forEach(function (range) {
            var count = files.filter(function (file) { return file.height >= range.min && file.height <= range.max; }).length;
            if (count) {
                filters.push({ value: range.value, label: range.label, type: "range", min: range.min, max: range.max, count: count });
            }
        });

        var dimensions = Object.create(null);
        files.forEach(function (file) {
            var key = file.width + "x" + file.height;
            if (!dimensions[key]) { dimensions[key] = { width: file.width, height: file.height, count: 0 }; }
            dimensions[key].count += 1;
        });
        Object.keys(dimensions).map(function (key) { return dimensions[key]; })
            .sort(function (left, right) { return right.height - left.height || right.width - left.width; })
            .forEach(function (dimension) {
                filters.push({
                    value: "exact:" + dimension.width + "x" + dimension.height,
                    label: dimension.width + " × " + dimension.height + " (" + dimension.height + "p)",
                    type: "exact", width: dimension.width, height: dimension.height, count: dimension.count
                });
            });
        return filters;
    }

    function updateEncodingResolutionFilter(files) {
        var previous = els.encodingResolution.value || "all";
        var filters = buildEncodingResolutionFilters(files);
        var allOption = document.createElement("option");
        allOption.value = filters[0].value;
        allOption.textContent = filters[0].label + " · " + filters[0].count.toLocaleString();
        els.encodingResolution.replaceChildren(allOption);

        var rangeOptions = filters.filter(function (filter) { return filter.type === "range"; });
        if (rangeOptions.length) {
            var rangeGroup = document.createElement("optgroup");
            rangeGroup.label = "Resolution ranges";
            rangeOptions.forEach(function (filter) {
                var option = document.createElement("option");
                option.value = filter.value;
                option.textContent = filter.label + " · " + filter.count.toLocaleString();
                rangeGroup.appendChild(option);
            });
            els.encodingResolution.appendChild(rangeGroup);
        }

        var exactOptions = filters.filter(function (filter) { return filter.type === "exact"; });
        if (exactOptions.length) {
            var exactGroup = document.createElement("optgroup");
            exactGroup.label = "Exact resolutions in this scan";
            exactOptions.forEach(function (filter) {
                var option = document.createElement("option");
                option.value = filter.value;
                option.textContent = filter.label + " · " + filter.count.toLocaleString();
                exactGroup.appendChild(option);
            });
            els.encodingResolution.appendChild(exactGroup);
        }

        var selected = filters.filter(function (filter) { return filter.value === previous; })[0] || filters[0];
        els.encodingResolution.value = selected.value;
        return selected;
    }

    function matchesEncodingResolution(file, filter) {
        if (filter.type === "all") { return true; }
        if (filter.type === "range") { return file.height >= filter.min && file.height <= filter.max; }
        return file.width === filter.width && file.height === filter.height;
    }

    function currentEncodingSettings() {
        var preset = els.encodingPreset.value;
        if (encodingSettings[preset]) {
            var selected = encodingSettings[preset];
            return { codec: selected.codec, crf: selected.crf, speed: selected.speed, height: selected.height, audio: selected.audio };
        }
        return {
            codec: els.encodingCodec.value,
            crf: Number.isInteger(Number(els.encodingCrf.value)) ? Number(els.encodingCrf.value) : 23,
            speed: els.encodingSpeed.value,
            height: parseInt(els.encodingHeight.value, 10) || 0,
            audio: els.encodingAudio.value
        };
    }

    function describeEncodingSettings(settings) {
        var codec = settings.codec === "libx265" ? "H.265 / HEVC" : "H.264";
        var audio = settings.audio === "copy" ? "copy audio" : "AAC " + settings.audio.slice(3) + " kb/s";
        var height = settings.height ? "up to " + settings.height + "p" : "keep source resolution";
        return codec + " · CRF " + settings.crf + " · " + settings.speed + " speed · " + audio + " · " + height;
    }

    function updateEncodingControls() {
        var custom = els.encodingPreset.value === "custom";
        els.encodingCustom.hidden = !custom;
        els.encodingFile.disabled = encodingBusy || !els.encodingFile.options.length;
        [els.encodingResolution, els.encodingPreset, els.encodingContainer, els.encodingCodec, els.encodingCrf, els.encodingSpeed, els.encodingHeight, els.encodingAudio, els.encodingReplace].forEach(function (control) { control.disabled = encodingBusy; });
        els.encodingRun.disabled = encodingBusy || !els.encodingFile.value || !!scanController;
        els.encodingRun.textContent = encodingBusy ? "Re-encoding…" : "Run re-encode";
        els.encodingPreview.textContent = describeEncodingSettings(currentEncodingSettings()) + " · " + els.encodingContainer.value.toUpperCase();
    }

    function renderEncodingAuditor() {
        if (!els.encodingFile) { return; }
        encodingFiles = listEncodingFiles();
        var rawQuery = String(els.encodingSearch.value || "").trim();
        var query = rawQuery.toLocaleLowerCase();
        var resolutionFilter = updateEncodingResolutionFilter(encodingFiles);
        var filteredFiles = encodingFiles.filter(function (file) {
            if (!matchesEncodingResolution(file, resolutionFilter)) { return false; }
            var searchable = file.title + " " + file.path + " " + file.codec + " " + file.audio + " " + file.width + " " + file.height + " " + file.format;
            return !query || searchable.toLocaleLowerCase().indexOf(query) !== -1;
        });
        var previous = els.encodingFile.value;
        var visibleFiles = filteredFiles.slice(0, 100);
        var options = visibleFiles.map(function (file) {
            var option = document.createElement("option");
            option.value = file.id;
            option.textContent = encodingFileLabel(file);
            return option;
        });
        els.encodingFile.replaceChildren.apply(els.encodingFile, options);
        if (visibleFiles.some(function (file) { return file.id === previous; })) { els.encodingFile.value = previous; }
        if (visibleFiles.length && !els.encodingFile.value) { els.encodingFile.value = visibleFiles[0].id; }
        var matchReasons = [];
        if (resolutionFilter.type !== "all") { matchReasons.push(resolutionFilter.label); }
        if (rawQuery) { matchReasons.push("search ‘" + rawQuery + "’"); }
        els.encodingCount.textContent = lastScanDate
            ? matchReasons.length
                ? filteredFiles.length.toLocaleString() + " of " + encodingFiles.length.toLocaleString() + " video files match " + matchReasons.join(" and ") + "."
                : encodingFiles.length.toLocaleString() + " video file" + (encodingFiles.length === 1 ? "" : "s") + " available from the latest health check."
            : "Run Health Check to load video files.";
        els.encodingEmpty.hidden = !lastScanDate || filteredFiles.length > 0;
        if (!lastScanDate) {
            els.encodingEmpty.textContent = "Run Health Check before reviewing encoding details.";
        } else if (!encodingFiles.length) {
            els.encodingEmpty.textContent = "No video files with encoding details were found in this scan.";
        } else if (!filteredFiles.length) {
            els.encodingEmpty.textContent = "No video files match " + (matchReasons.length ? matchReasons.join(" and ") : "the selected filters") + ".";
        }
        var list = visibleFiles.slice(0, 20).map(function (file) {
            var card = document.createElement("article");
            card.className = "ld-encoding-file-card";
            var heading = document.createElement("strong");
            heading.textContent = file.title;
            var path = document.createElement("span");
            path.className = "ld-encoding-file-path";
            path.textContent = file.path;
            var details = document.createElement("span");
            details.className = "ld-encoding-file-details";
            details.textContent = file.width + "×" + file.height + " · " + file.codec + " video · " + file.audio + " audio · " + (file.frameRate ? file.frameRate.toFixed(2) + " fps · " : "") + (file.bitRate ? (file.bitRate / 1000000).toFixed(1) + " Mb/s · " : "") + file.format + " · " + formatBytes(file.size) + (file.duration ? " · " + Math.round(file.duration / 60) + " min" : "");
            card.append(heading, path, details);
            return card;
        });
        if (filteredFiles.length > 20) {
            var more = document.createElement("p");
            more.className = "ld-encoding-file-details";
            more.textContent = "Showing 20 of " + filteredFiles.length.toLocaleString() + " matches. Use the search or resolution filter to narrow the list.";
            list.push(more);
        }
        if (filteredFiles.length > 100) {
            els.encodingCount.textContent += " The scene-file selector shows the first 100 matches.";
        }
        els.encodingList.replaceChildren.apply(els.encodingList, list);
        updateEncodingControls();
    }

    function outputMetadataPath(file, token, folder, extension) {
        var separator = encodingMetadataPath.indexOf("\\") !== -1 ? "\\" : "/";
        var stem = fileStem(file.path);
        var root = encodingMetadataPath.replace(/[\\/]+$/, "");
        return root + separator + "LibraryDoctor" + separator + folder + separator + stem + ".ld-" + (folder === "Backups" ? "backup-" : "reencoded-") + token + "." + extension;
    }

    function startEncoding() {
        if (encodingBusy || scanController || !els.encodingFile.value) { return; }
        var file = encodingFiles.filter(function (item) { return item.id === els.encodingFile.value; })[0];
        if (!file) { return; }
        var replaceOriginal = els.encodingReplace.checked;
        if (els.encodingPreset.value === "custom") {
            var customCRF = Number(els.encodingCrf.value);
            if (!Number.isInteger(customCRF) || customCRF < 16 || customCRF > 35) {
                els.encodingError.textContent = "Set Custom CRF to a whole number from 16 to 35.";
                els.encodingError.hidden = false;
                return;
            }
        }
        var settings = currentEncodingSettings();
        if (replaceOriginal) {
            var sourceExtension = fileExtension(file.path).toLowerCase();
            var matchingContainer = sourceExtension === "mkv" ? "mkv" : sourceExtension === "mp4" ? "mp4" : "";
            if (matchingContainer !== els.encodingContainer.value) {
                els.encodingError.textContent = "For an in-place replacement, choose a matching MP4 or MKV source and output container. For other extensions, save a new file instead.";
                els.encodingError.hidden = false;
                return;
            }
        }
        if (replaceOriginal && !window.confirm("Replace this source only after FFmpeg verifies the new file? Library Doctor will keep a full backup in Stash's metadata directory. Make sure there is free space for both the temporary re-encode and the backup.")) { return; }
        els.encodingError.hidden = true;
        els.encodingJob.hidden = false;
        els.encodingJobTitle.textContent = "Starting re-encode…";
        els.encodingJobStatus.textContent = "Queued";
        els.encodingJobDetail.textContent = encodingFileLabel(file);
        els.encodingProgressBar.style.width = "0%";
        els.encodingProgressTrack.setAttribute("aria-valuenow", "0");
        encodingBusy = true;
        updateEncodingControls();
        var token = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID().replace(/-/g, "") : (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, 24);
        graphQLRequest(ENCODING_CONFIG_QUERY, {}).then(function (configData) {
            var general = configData.configuration && configData.configuration.general;
            encodingMetadataPath = general && general.metadataPath ? String(general.metadataPath) : "";
            if (!encodingMetadataPath) { throw new Error("Stash did not return its metadata directory. Check the plugin log and server configuration."); }
            var args = {
                scene_id: file.sceneId, file_id: file.id, token: token, preset: els.encodingPreset.value,
                codec: settings.codec, crf: settings.crf, speed: settings.speed, max_height: settings.height,
                audio: settings.audio, container: els.encodingContainer.value, replace_original: replaceOriginal
            };
            return graphQLRequest(RUN_ENCODING_TASK, { args: args });
        }).then(function (data) {
            var jobId = data.runPluginTask;
            if (!jobId) { throw new Error("Stash did not start the FFmpeg task."); }
            els.encodingJobTitle.textContent = "Re-encoding " + file.title;
            els.encodingJobStatus.textContent = "Running";
            pollEncodingJob(String(jobId), file, token, replaceOriginal);
        }).catch(function (error) {
            encodingBusy = false;
            updateEncodingControls();
            els.encodingJob.hidden = true;
            els.encodingError.textContent = error && error.message ? error.message : String(error);
            els.encodingError.hidden = false;
        });
    }

    function pollEncodingJob(jobId, file, token, replaceOriginal) {
        graphQLRequest(FIND_JOB_QUERY, { input: { id: jobId } }).then(function (data) {
            var job = data.findJob;
            if (!job) { throw new Error("Stash no longer has this encoding job in its queue."); }
            var progress = Number(job.progress) || 0;
            if (progress > 0 && progress <= 1) { progress *= 100; }
            progress = Math.max(0, Math.min(100, progress));
            els.encodingProgressBar.style.width = progress + "%";
            els.encodingProgressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
            els.encodingJobStatus.textContent = job.status + (progress ? " · " + Math.round(progress) + "%" : "");
            els.encodingJobDetail.textContent = Array.isArray(job.subTasks) && job.subTasks.length ? job.subTasks[job.subTasks.length - 1] : "FFmpeg is processing the selected video on the Stash server.";
            if (job.status === "FINISHED") {
                encodingBusy = false;
                updateEncodingControls();
                els.encodingProgressBar.style.width = "100%";
                els.encodingProgressTrack.setAttribute("aria-valuenow", "100");
                els.encodingJobTitle.textContent = replaceOriginal ? "Original replaced and verified" : "Re-encode complete";
                els.encodingJobStatus.textContent = "Finished";
                els.encodingJobDetail.textContent = replaceOriginal
                    ? "Updated " + file.path + ". Backup saved to " + outputMetadataPath(file, token, "Backups", fileExtension(file.path)) + ". Stash metadata refresh is queued; run Health Check after it finishes."
                    : "New file saved to " + outputMetadataPath(file, token, "Reencoded", els.encodingContainer.value);
                return;
            }
            if (["FAILED", "CANCELLED"].indexOf(job.status) !== -1) {
                encodingBusy = false;
                updateEncodingControls();
                els.encodingError.textContent = job.error || (job.status === "CANCELLED" ? "The re-encode was cancelled. The source file was kept." : "FFmpeg could not complete this re-encode. The source file was kept.");
                els.encodingError.hidden = false;
                els.encodingJobTitle.textContent = "Re-encode " + job.status.toLowerCase();
                return;
            }
            encodingJobTimer = window.setTimeout(function () { pollEncodingJob(jobId, file, token, replaceOriginal); }, 1200);
        }).catch(function (error) {
            encodingBusy = false;
            updateEncodingControls();
            els.encodingError.textContent = error && error.message ? error.message : String(error);
            els.encodingError.hidden = false;
        });
    }

    function updateScrapeControls() {
        var selection = String(els.scrapeSource.value || "");
        var needingScrape = results.filter(hasScrapeGaps);
        var remaining = scrapeTargets(selection).length;
        var hasSources = getSelectedScrapers(selection).length > 0;
        els.scrapeRun.disabled = scrapeBusy || !!scanController || !lastScanDate || !hasSources || !needingScrape.length;
        els.scrapeRun.textContent = scrapeBusy ? "Scraping…" : (remaining
            ? "Scrape " + remaining.toLocaleString() + " scenes with metadata gaps"
            : (needingScrape.length ? "Retry " + needingScrape.length.toLocaleString() + " unresolved scenes" : "No metadata gaps to scrape"));
        if (scrapeBusy) {
            els.scrapeRemaining.textContent = "Checking " + scrapeStats.processed.toLocaleString() + " of " + scrapeStats.total.toLocaleString() + " scenes…";
        } else if (!lastScanDate) {
            els.scrapeRemaining.textContent = "Run Health Check before scraping scenes.";
        } else if (!hasSources) {
            els.scrapeRemaining.textContent = "Configure scene identify sources in Stash under Settings → Metadata Providers.";
        } else if (!needingScrape.length) {
            els.scrapeRemaining.textContent = "Every scanned scene has a title, date, and at least one tag.";
        } else if (!remaining) {
            els.scrapeRemaining.textContent = needingScrape.length.toLocaleString() + " scenes still have missing metadata; retry the selected source set or choose another source.";
        } else {
            els.scrapeRemaining.textContent = remaining.toLocaleString() + " scenes with missing title, date, or tags have not been checked with this source set.";
        }
    }

    function hasScrapeGaps(scene) {
        return !scene.title || !scene.date || !scene.tags.length;
    }

    function scrapeAttemptKey(sourceSet, sceneId) { return String(sourceSet) + ":" + String(sceneId); }

    function scrapeTargets(sourceSet) {
        return results.filter(function (scene) {
            return hasScrapeGaps(scene) && !scrapeAttempted[scrapeAttemptKey(sourceSet, scene.id)];
        });
    }

    function getSelectedScrapers(selection) {
        if (!scrapers.length) { return []; }
        if (!selection || selection === "all") { return scrapers.slice(0, configuredScraperCount || scrapers.length); }
        var index = Number(selection);
        return isFinite(index) && index >= 0 && index < scrapers.length ? [scrapers[index]] : [];
    }

    function loadScrapers(force) {
        if (scrapersLoading || (scrapersLoaded && !force)) { return Promise.resolve(scrapers); }
        scrapersLoading = true;
        els.scrapeSource.disabled = true;
        els.scrapeSource.replaceChildren();
        var loadingOption = document.createElement("option");
        loadingOption.value = "";
        loadingOption.textContent = "Loading scene scrapers…";
        els.scrapeSource.appendChild(loadingOption);
        els.scrapeSourceStatus.textContent = "Loading installed scene scrapers and Stash's configured identify sources.";
        var installedRequest = graphQLRequest(SCRAPERS_QUERY, {}).then(function (data) {
            return { data: data, error: null };
        }).catch(function (error) {
            return { data: null, error: error };
        });
        var identifyRequest = graphQLRequest(IDENTIFY_SOURCES_QUERY, {}).then(function (data) {
            return { data: data, error: null };
        }).catch(function (error) {
            return { data: null, error: error };
        });
        return Promise.all([installedRequest, identifyRequest]).then(function (responses) {
            var installedResult = responses[0];
            var identifyResult = responses[1];
            if (!installedResult.data && !identifyResult.data) {
                throw new Error("Could not read installed scrapers or configured identify sources. " + [installedResult.error, identifyResult.error].filter(Boolean).map(function (error) { return error.message || String(error); }).join(" "));
            }
            var installedScrapers = installedResult.data && Array.isArray(installedResult.data.listScrapers)
                ? installedResult.data.listScrapers : [];
            var data = identifyResult.data || {};
            var scraperNames = Object.create(null);
            installedScrapers.forEach(function (scraper) {
                scraperNames[String(scraper.id)] = scraper.name;
            });
            var boxes = data.configuration && data.configuration.general && Array.isArray(data.configuration.general.stashBoxes)
                ? data.configuration.general.stashBoxes : [];
            var boxNames = Object.create(null);
            boxes.forEach(function (box) { boxNames[String(box.endpoint)] = box.name; });
            var defaults = data.configuration && data.configuration.defaults && data.configuration.defaults.identify;
            var configuredSources = defaults && Array.isArray(defaults.sources) ? defaults.sources.map(function (item) {
                var source = item && item.source;
                if (!source) { return null; }
                var id = source.scraper_id ? String(source.scraper_id) : "";
                var endpoint = source.stash_box_endpoint ? String(source.stash_box_endpoint) : "";
                var stashBoxIndex = source.stash_box_index == null ? null : Number(source.stash_box_index);
                if (!id && !endpoint && stashBoxIndex == null) { return null; }
                return {
                    source: id ? { scraper_id: id } : (endpoint ? { stash_box_endpoint: endpoint } : { stash_box_index: stashBoxIndex }),
                    configured: true,
                    name: id ? (scraperNames[id] || ("Scene scraper " + id)) : (endpoint
                        ? (boxNames[endpoint] || endpoint)
                        : ((boxes[stashBoxIndex] && boxes[stashBoxIndex].name) || ("Stash-box " + (stashBoxIndex + 1))))
                };
            }).filter(Boolean) : [];
            var configuredIds = Object.create(null);
            configuredSources.forEach(function (scraper) {
                if (scraper.source.scraper_id) { configuredIds[String(scraper.source.scraper_id)] = true; }
            });
            var additionalScrapers = installedScrapers.filter(function (scraper) {
                return scraper && scraper.id != null && !configuredIds[String(scraper.id)];
            }).map(function (scraper) {
                return { source: { scraper_id: String(scraper.id) }, configured: false, name: String(scraper.name || ("Scene scraper " + scraper.id)) };
            });
            configuredScraperCount = configuredSources.length;
            scrapers = configuredSources.concat(additionalScrapers);
            scrapersLoaded = true;
            els.scrapeSource.replaceChildren();
            if (!scrapers.length) {
                var empty = document.createElement("option");
                empty.value = "";
                empty.textContent = installedResult.error || identifyResult.error ? "Scraper sources unavailable" : "No scene scrapers found";
                els.scrapeSource.appendChild(empty);
                var loadErrors = [installedResult.error, identifyResult.error].filter(Boolean).map(function (error) { return error.message || String(error); });
                els.scrapeSourceStatus.textContent = loadErrors.length
                    ? "Could not load scraper sources: " + loadErrors.join(" · ")
                    : "No installed scene scrapers or configured identify sources were returned. Check Settings → Metadata Providers and reload this list.";
            } else {
                var allOption = document.createElement("option");
                allOption.value = "all";
                allOption.textContent = configuredScraperCount
                    ? "All configured sources, in order (" + configuredScraperCount.toLocaleString() + ")"
                    : "All installed scene scrapers (" + scrapers.length.toLocaleString() + ")";
                els.scrapeSource.appendChild(allOption);
                function appendSourceOption(scraper, index, parent) {
                    var option = document.createElement("option");
                    option.value = String(index);
                    option.textContent = scraper.name;
                    parent.appendChild(option);
                }
                scrapers.slice(0, configuredScraperCount).forEach(function (scraper, index) {
                    appendSourceOption(scraper, index, els.scrapeSource);
                });
                if (additionalScrapers.length) {
                    if (configuredScraperCount) {
                        var group = document.createElement("optgroup");
                        group.label = "Other installed scene scrapers";
                        additionalScrapers.forEach(function (scraper, index) {
                            appendSourceOption(scraper, configuredScraperCount + index, group);
                        });
                        els.scrapeSource.appendChild(group);
                    } else {
                        additionalScrapers.forEach(function (scraper, index) {
                            appendSourceOption(scraper, index, els.scrapeSource);
                        });
                    }
                }
                els.scrapeSource.value = "all";
                if (configuredScraperCount) {
                    els.scrapeSourceStatus.textContent = configuredScraperCount.toLocaleString() + " configured source" + (configuredScraperCount === 1 ? " is" : "s are") + " available in Stash's saved order." + (additionalScrapers.length ? " " + additionalScrapers.length.toLocaleString() + " other installed scraper" + (additionalScrapers.length === 1 ? " is" : "s are") + " available individually." : "");
                    if (installedResult.error) {
                        els.scrapeSourceStatus.textContent += " Installed scraper names could not be loaded; configured sources are still available.";
                    }
                } else {
                    els.scrapeSourceStatus.textContent = "No configured identify order was found; showing the installed scene scrapers." + (identifyResult.error ? " Configuration details could not be loaded: " + (identifyResult.error.message || String(identifyResult.error)) : "");
                }
            }
            return scrapers;
        }).catch(function (error) {
            scrapersLoaded = false;
            scrapers = [];
            configuredScraperCount = 0;
            els.scrapeSource.replaceChildren();
            var failed = document.createElement("option");
            failed.value = "";
            failed.textContent = "Could not load scene scrapers";
            els.scrapeSource.appendChild(failed);
            els.scrapeSourceStatus.textContent = "Could not load Stash scene scrapers: " + (error && error.message ? error.message : String(error));
            return [];
        }).then(function (loaded) {
            scrapersLoading = false;
            els.scrapeSource.disabled = !loaded.length;
            updateScrapeControls();
            return loaded;
        });
    }

    function addTagToCatalog(tag) {
        if (!tagCatalog || !tag || !tag.id) { return; }
        [tag.name].concat(Array.isArray(tag.aliases) ? tag.aliases : []).forEach(function (name) {
            var key = normalizeTitle(name);
            if (!key) { return; }
            if (!tagCatalog[key]) { tagCatalog[key] = []; }
            if (!tagCatalog[key].some(function (item) { return String(item.id) === String(tag.id); })) {
                tagCatalog[key].push({ id: String(tag.id), name: String(tag.name || name), aliases: tag.aliases || [] });
            }
        });
    }

    function loadTagCatalog() {
        if (tagCatalogPromise) { return tagCatalogPromise; }
        if (tagCatalog) { return Promise.resolve(tagCatalog); }
        tagCatalog = Object.create(null);
        var pageSize = 200;
        var page = 1;
        var count = Infinity;
        function loadPage() {
            return graphQLRequest(TAG_CATALOG_QUERY, { page: page, perPage: pageSize }).then(function (data) {
                var result = data.findTags || {};
                count = Number(result.count) || 0;
                var tags = Array.isArray(result.tags) ? result.tags : [];
                tags.forEach(addTagToCatalog);
                if (!tags.length || page * pageSize >= count) { return tagCatalog; }
                page += 1;
                return loadPage();
            });
        }
        tagCatalogPromise = loadPage().catch(function (error) {
            tagCatalog = null;
            tagCatalogPromise = null;
            throw error;
        });
        return tagCatalogPromise;
    }

    function resolveScrapedTags(scrapedTags, createMissing) {
        var unique = [];
        var seenNames = Object.create(null);
        (Array.isArray(scrapedTags) ? scrapedTags : []).forEach(function (tag) {
            var name = String(tag && tag.name || "").trim();
            var key = normalizeTitle(name);
            if (!key || name.length > 120 || seenNames[key]) { return; }
            seenNames[key] = true;
            unique.push({ id: tag && tag.stored_id ? String(tag.stored_id) : "", name: name });
        });
        var state = { ids: [], created: [], skipped: [] };
        function include(id) {
            var value = String(id || "");
            if (value && state.ids.indexOf(value) === -1) { state.ids.push(value); }
        }
        function process(index) {
            if (index >= unique.length) { return Promise.resolve(state); }
            var tag = unique[index];
            if (tag.id) {
                include(tag.id);
                return process(index + 1);
            }
            return loadTagCatalog().then(function (catalog) {
                var matches = catalog[normalizeTitle(tag.name)] || [];
                if (matches.length === 1) {
                    include(matches[0].id);
                    return process(index + 1);
                }
                if (matches.length > 1 || !createMissing) {
                    state.skipped.push(tag.name);
                    return process(index + 1);
                }
                return graphQLRequest(TAG_CREATE_MUTATION, { input: { name: tag.name } }).then(function (data) {
                    var created = data.tagCreate;
                    if (!created || !created.id) { throw new Error("Stash did not confirm creation of the tag “" + tag.name + "”."); }
                    addTagToCatalog(created);
                    include(created.id);
                    state.created.push(String(created.name || tag.name));
                    return process(index + 1);
                }).catch(function () {
                    state.skipped.push(tag.name);
                    return process(index + 1);
                });
            });
        }
        return process(0);
    }

    function scrapeCandidateUpdates(scene, candidate, createMissingTags) {
        var title = String(candidate && candidate.title || "").trim();
        var date = String(candidate && candidate.date || "").trim();
        return graphQLRequest(FRESH_SCENE_QUERY, { id: scene.id }).then(function (data) {
            var latest = data.findScene;
            if (!latest) { throw new Error("Stash no longer has this scene. Run a new library check."); }
            scene.title = String(latest.title || "").trim();
            scene.date = String(latest.date || "").trim();
            scene.tags = (Array.isArray(latest.tags) ? latest.tags : []).map(function (tag) {
                return { id: String(tag.id), name: String(tag.name || "").trim() };
            });
            scene._doctorIssues = scene._doctorIssues.filter(function (issue) {
                return issue.label !== "Missing title" && issue.label !== "Missing date" && issue.label !== "No tags";
            });
            if (!scene.title) { addIssue(scene, "Missing title", "metadata"); }
            if (!scene.date) { addIssue(scene, "Missing date", "metadata"); }
            if (!scene.tags.length) { addIssue(scene, "No tags", "metadata"); }
            var updates = {};
            if (!scene.title && title) { updates.title = title.slice(0, 500); }
            if (!scene.date && validDate(date)) { updates.date = date; }
            return resolveScrapedTags(candidate && candidate.tags, createMissingTags).then(function (tagState) {
                var existing = scene.tags.map(function (tag) { return String(tag.id); });
                var additions = tagState.ids.filter(function (id) { return existing.indexOf(id) === -1; });
                if (additions.length) { updates.tag_ids = additions; }
                var result = {
                    tagsAdded: additions.length,
                    tagsCreated: tagState.created.length,
                    skippedTags: tagState.skipped,
                    titleFilled: !!updates.title,
                    dateFilled: !!updates.date
                };
                if (!Object.keys(updates).length) { return result; }
                return updateScene(scene, updates, { render: false }).then(function () { return result; });
            });
        });
    }

    function renderScrapeResults() {
        var unresolved = scrapeEntries.filter(function (entry) { return entry.status === "review" || entry.status === "error"; });
        els.scrapeList.replaceChildren.apply(els.scrapeList, unresolved.map(function (entry) {
            var card = document.createElement("article");
            card.className = "ld-scrape-card";
            var heading = document.createElement("div");
            heading.className = "ld-scrape-card-heading";
            var title = document.createElement("h3");
            title.textContent = entry.scene.title || fileBasename(entry.scene.files[0] && entry.scene.files[0].path) || "Untitled scene";
            var status = document.createElement("span");
            status.className = "ld-scrape-status";
            status.textContent = entry.status === "review"
                ? entry.candidates.length.toLocaleString() + " matches from " + entry.sourceName + " · review required"
                : "Could not scrape";
            heading.append(title, status);
            var file = document.createElement("p");
            file.className = "ld-scrape-file";
            file.textContent = fileBasename(entry.scene.files[0] && entry.scene.files[0].path) || "File name unavailable";
            card.append(heading, file);
            if (entry.status === "error") {
                var error = document.createElement("p");
                error.className = "ld-scrape-error";
                error.textContent = entry.message;
                card.appendChild(error);
            } else {
                var matches = document.createElement("div");
                matches.className = "ld-scrape-matches";
                entry.candidates.forEach(function (candidate, index) {
                    var match = document.createElement("div");
                    match.className = "ld-scrape-match";
                    var details = document.createElement("div");
                    var matchTitle = document.createElement("strong");
                    matchTitle.textContent = candidate.title || "Untitled scraper result";
                    var meta = document.createElement("span");
                    meta.textContent = [candidate.date, (Array.isArray(candidate.tags) ? candidate.tags : []).map(function (tag) { return tag.name; }).filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No date or tags returned";
                    details.append(matchTitle, meta);
                    var apply = document.createElement("button");
                    apply.className = "ld-fix-button";
                    apply.type = "button";
                    apply.textContent = "Apply this match";
                    apply.disabled = scrapeBusy;
                    apply.addEventListener("click", function () { applyScrapeReview(entry, candidate, apply); });
                    match.append(details, apply);
                    matches.appendChild(match);
                });
                card.appendChild(matches);
            }
            return card;
        }));
        els.scrapeResults.hidden = unresolved.length === 0;
        els.scrapeEmpty.hidden = unresolved.length > 0;
        if (scrapeStats.processed) {
            els.scrapeEmpty.textContent = scrapeStats.applied.toLocaleString() + " unique matches applied · " + scrapeStats.noMatch.toLocaleString() + " with no match · " + scrapeStats.review.toLocaleString() + " awaiting review · " + scrapeStats.errors.toLocaleString() + " errors.";
        } else if (!lastScanDate) {
            els.scrapeEmpty.textContent = "Run Health Check before scraping scenes.";
        } else if (!results.length) {
            els.scrapeEmpty.textContent = "No scenes were found in the latest health check.";
        } else if (!results.some(hasScrapeGaps)) {
            els.scrapeEmpty.textContent = "Every scanned scene has a title, date, and at least one tag.";
        } else {
            els.scrapeEmpty.textContent = "No unresolved matches. Run a scrape to fill missing tags and metadata.";
        }
        els.scrapeCountApplied.textContent = scrapeStats.applied.toLocaleString();
        els.scrapeCountTags.textContent = scrapeStats.tagsAdded.toLocaleString();
        els.scrapeCountReview.textContent = scrapeStats.review.toLocaleString();
        els.scrapeCountNoMatch.textContent = scrapeStats.noMatch.toLocaleString();
        els.scrapeCountErrors.textContent = scrapeStats.errors.toLocaleString();
    }

    function applyScrapeReview(entry, candidate, button) {
        if (entry.status !== "review") { return; }
        button.disabled = true;
        button.textContent = "Applying…";
        scrapeCandidateUpdates(entry.scene, candidate, els.scrapeCreateTags.checked).then(function (applied) {
            entry.status = "applied";
            scrapeStats.review = Math.max(0, scrapeStats.review - 1);
            if (applied.tagsAdded || applied.titleFilled || applied.dateFilled) { scrapeStats.applied += 1; }
            scrapeStats.tagsAdded += applied.tagsAdded;
            scrapeStats.tagsCreated += applied.tagsCreated;
            render();
            showStatus("Applied the selected scraper match to “" + (entry.scene.title || "scene") + "”. Undo removes its scene tags and restores fields; created tag records remain.", true);
        }).catch(function (error) {
            entry.status = "error";
            entry.message = error && error.message ? error.message : String(error);
            scrapeStats.review = Math.max(0, scrapeStats.review - 1);
            scrapeStats.errors += 1;
            renderScrapeResults();
        });
    }

    function scrapeMetadataGaps() {
        if (scrapeBusy) { return; }
        var sourceSet = String(els.scrapeSource.value || "all");
        var selectedSources = getSelectedScrapers(sourceSet);
        var needingScrape = results.filter(hasScrapeGaps);
        var targets = scrapeTargets(sourceSet);
        if (!targets.length && needingScrape.length) {
            targets = needingScrape;
            targets.forEach(function (scene) { delete scrapeAttempted[scrapeAttemptKey(sourceSet, scene.id)]; });
        }
        if (!selectedSources.length || !targets.length || !lastScanDate) { updateScrapeControls(); return; }
        scrapeBusy = true;
        els.scan.disabled = true;
        els.export.disabled = true;
        els.undo.disabled = true;
        scrapeEntries = [];
        scrapeStats = { total: targets.length, processed: 0, exact: 0, applied: 0, review: 0, noMatch: 0, errors: 0, tagsAdded: 0, tagsCreated: 0 };
        els.scrapeProgress.hidden = false;
        els.scrapeProgressBar.style.width = "0%";
        els.scrapeProgressTrack.setAttribute("aria-valuenow", "0");
        els.scrapeProgressDetail.textContent = "Preparing fingerprint lookups.";
        updateScrapeControls();
        renderScrapeResults();
        var createMissingTags = els.scrapeCreateTags.checked;
        var offset = 0;

        function processBatch() {
            var batch = targets.slice(offset, offset + SCRAPE_BATCH_SIZE);
            if (!batch.length) { finish(); return Promise.resolve(); }
            batch.forEach(function (scene) { scrapeAttempted[scrapeAttemptKey(sourceSet, scene.id)] = true; });
            els.scrapeProgressDetail.textContent = "Checking scenes " + (offset + 1).toLocaleString() + "–" + Math.min(offset + batch.length, targets.length).toLocaleString() + " of " + targets.length.toLocaleString() + " against configured sources.";
            var sourceErrors = Object.create(null);

            function recordError(scene, sourceName, error) {
                if (!sourceErrors[scene.id]) { sourceErrors[scene.id] = []; }
                sourceErrors[scene.id].push(sourceName + ": " + (error && error.message ? error.message : String(error)));
            }

            function trySource(sourceIndex, pending) {
                if (!pending.length) { return Promise.resolve(); }
                if (sourceIndex >= selectedSources.length) {
                    pending.forEach(function (scene) {
                        if (sourceErrors[scene.id] && sourceErrors[scene.id].length) {
                            scrapeEntries.push({ scene: scene, candidates: [], status: "error", message: sourceErrors[scene.id].join(" · ") });
                            scrapeStats.errors += 1;
                        } else {
                            scrapeStats.noMatch += 1;
                        }
                    });
                    return Promise.resolve();
                }
                var scraper = selectedSources[sourceIndex];
                return graphQLRequest(SCRAPE_SCENES_QUERY, {
                    source: scraper.source,
                    input: { scene_ids: pending.map(function (scene) { return scene.id; }) }
                }).then(function (data) {
                    var groups = Array.isArray(data.scrapeMultiScenes) ? data.scrapeMultiScenes : [];
                    var retryWithNextSource = [];
                    var uniqueMatches = [];
                    pending.forEach(function (scene, index) {
                        var candidates = Array.isArray(groups[index]) ? groups[index] : [];
                        if (!candidates.length) {
                            retryWithNextSource.push(scene);
                        } else if (candidates.length > 1) {
                            scrapeEntries.push({ scene: scene, candidates: candidates, status: "review", sourceName: scraper.name });
                            scrapeStats.review += 1;
                        } else {
                            uniqueMatches.push({ scene: scene, candidate: candidates[0] });
                        }
                    });
                    return uniqueMatches.reduce(function (chain, match) {
                        return chain.then(function () {
                            scrapeStats.exact += 1;
                            return scrapeCandidateUpdates(match.scene, match.candidate, createMissingTags).then(function (applied) {
                                if (applied.tagsAdded || applied.titleFilled || applied.dateFilled) { scrapeStats.applied += 1; }
                                scrapeStats.tagsAdded += applied.tagsAdded;
                                scrapeStats.tagsCreated += applied.tagsCreated;
                            }).catch(function (error) {
                                scrapeEntries.push({
                                    scene: match.scene,
                                    candidates: [],
                                    status: "error",
                                    message: scraper.name + ": " + (error && error.message ? error.message : String(error))
                                });
                                scrapeStats.errors += 1;
                            });
                        });
                    }, Promise.resolve()).then(function () {
                        return trySource(sourceIndex + 1, retryWithNextSource);
                    });
                }).catch(function (error) {
                    pending.forEach(function (scene) { recordError(scene, scraper.name, error); });
                    return trySource(sourceIndex + 1, pending);
                });
            }

            return trySource(0, batch).then(function () {
                offset += batch.length;
                scrapeStats.processed = offset;
                var percent = Math.round((offset / targets.length) * 100);
                els.scrapeProgressBar.style.width = percent + "%";
                els.scrapeProgressTrack.setAttribute("aria-valuenow", String(percent));
                renderScrapeResults();
                updateScrapeControls();
                render();
                if (offset < targets.length) {
                    return new Promise(function (resolve) { window.setTimeout(resolve, 0); }).then(processBatch);
                }
                finish();
            });
        }

        function finish() {
            scrapeBusy = false;
            els.scan.disabled = !!scanController;
            els.export.disabled = !results.length;
            els.undo.disabled = !undoStack.length || !!scanController;
            els.undo.hidden = !undoStack.length;
            els.scrapeProgress.hidden = true;
            results.forEach(function (scene) {
                scene._doctorIssues = scene._doctorIssues.filter(function (issue) { return issue.kind !== "review"; });
            });
            markRepeatedTitles(results);
            renderScrapeResults();
            render();
            showStatus("Scrape complete: " + scrapeStats.applied.toLocaleString() + " scenes updated, " + scrapeStats.review.toLocaleString() + " need review, " + scrapeStats.noMatch.toLocaleString() + " had no match.", undoStack.length > 0);
        }

        processBatch();
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

    function tagCatalogEntries() {
        var seen = Object.create(null);
        var entries = [];
        if (!tagCatalog) { return entries; }
        Object.keys(tagCatalog).forEach(function (key) {
            tagCatalog[key].forEach(function (tag) {
                var id = String(tag.id);
                if (!seen[id]) {
                    seen[id] = true;
                    entries.push({ id: id, name: String(tag.name || ""), aliases: Array.isArray(tag.aliases) ? tag.aliases : [] });
                }
            });
        });
        entries.sort(function (left, right) { return left.name.localeCompare(right.name); });
        return entries;
    }

    function renderFixTagPicker() {
        var selected = Object.create(null);
        fixSelectedTags.forEach(function (tag) { selected[String(tag.id)] = true; });
        els.fixTagSelected.replaceChildren.apply(els.fixTagSelected, fixSelectedTags.map(function (tag) {
            var chip = document.createElement("span");
            chip.className = "ld-fix-tag-chip";
            var name = document.createElement("span");
            name.textContent = tag.name;
            var remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "×";
            remove.setAttribute("aria-label", "Remove tag " + tag.name);
            remove.addEventListener("click", function () {
                fixSelectedTags = fixSelectedTags.filter(function (item) { return String(item.id) !== String(tag.id); });
                renderFixTagPicker();
                updateFixPreview();
            });
            chip.append(name, remove);
            return chip;
        }));

        var query = normalizeTitle(els.fixTagSearch.value);
        var entries = tagCatalogEntries();
        var matches = entries.filter(function (tag) {
            return !query || [tag.name].concat(tag.aliases).some(function (value) {
                return normalizeTitle(value).indexOf(query) !== -1;
            });
        });
        var visible = matches.slice(0, 30);
        els.fixTagOptions.replaceChildren.apply(els.fixTagOptions, visible.map(function (tag) {
            var option = document.createElement("label");
            option.className = "ld-fix-tag-option";
            var checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !!selected[tag.id];
            checkbox.addEventListener("change", function () {
                if (checkbox.checked && !selected[tag.id]) { fixSelectedTags.push({ id: tag.id, name: tag.name }); }
                else if (!checkbox.checked) { fixSelectedTags = fixSelectedTags.filter(function (item) { return String(item.id) !== tag.id; }); }
                renderFixTagPicker();
                updateFixPreview();
            });
            var name = document.createElement("span");
            name.textContent = tag.name;
            option.append(checkbox, name);
            return option;
        }));
        if (!entries.length) {
            els.fixTagStatus.textContent = "No tags exist in Stash yet. Create tags in Stash, then reload the list.";
        } else if (!matches.length) {
            els.fixTagStatus.textContent = "No existing tags match this search.";
        } else {
            els.fixTagStatus.textContent = matches.length > visible.length
                ? "Showing the first 30 matches. Type to narrow the list."
                : matches.length.toLocaleString() + " matching tag" + (matches.length === 1 ? "" : "s") + ".";
        }
    }

    function loadFixTags() {
        els.fixTagStatus.textContent = "Loading existing Stash tags…";
        els.fixTagOptions.replaceChildren();
        loadTagCatalog().then(function () {
            renderFixTagPicker();
        }).catch(function (error) {
            els.fixTagStatus.textContent = "Could not load Stash tags: " + (error && error.message ? error.message : String(error));
        });
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
        if (els.fixTagsChoice.checked) {
            if (!fixSelectedTags.length) { error = "Choose at least one tag to include this fix."; }
            else { updates.tag_ids = fixSelectedTags.map(function (tag) { return String(tag.id); }); }
        }
        if (!error && !Object.keys(updates).length) { error = "Select a field and enter its value or choose tags to preview a fix."; }
        return { updates: updates, error: error };
    }

    function updateFixPreview() {
        var state = readFixUpdates();
        els.fixPreview.replaceChildren();
        if (state.updates.title) { addPreviewLine("Title", pendingFixScene.title, state.updates.title); }
        if (state.updates.date) { addPreviewLine("Date", pendingFixScene.date, state.updates.date); }
        if (state.updates.tag_ids) {
            addPreviewLine("Tags", pendingFixScene.tags.map(function (tag) { return tag.name; }).join(", ") || "Missing", fixSelectedTags.map(function (tag) { return tag.name; }).join(", "));
        }
        if (!Object.keys(state.updates).length) {
            var empty = document.createElement("p");
            empty.textContent = "Choose a missing field, enter its value or select tags, then review the change here.";
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
        fixSelectedTags = [];
        els.fixTagsChoice.checked = false;
        els.fixTagSearch.value = "";
        els.fixTagSearch.disabled = true;
        els.fixTagPicker.hidden = true;
        els.fixTagSelected.replaceChildren();
        els.fixTagsField.hidden = !hasIssue(scene, "No tags");
        if (!els.fixTagsField.hidden) { loadFixTags(); }
        els.fixScene.textContent = scene.title || "Untitled scene";
        els.fixError.textContent = "";
        els.fixError.hidden = true;
        updateFixPreview();
        if (typeof els.fixDialog.showModal === "function") { els.fixDialog.showModal(); }
        else { els.fixDialog.setAttribute("open", "open"); }
        if (!els.fixTitleField.hidden) { els.fixTitleChoice.focus(); }
        else if (!els.fixDateField.hidden) { els.fixDateChoice.focus(); }
        else { els.fixTagsChoice.focus(); }
    }

    function closeFixDialog() {
        if (applyingFix) { return; }
        if (typeof els.fixDialog.close === "function" && els.fixDialog.open) { els.fixDialog.close(); }
        else { els.fixDialog.removeAttribute("open"); }
        pendingFixScene = null;
    }

    function updateScene(scene, updates, options) {
        var settings = options || {};
        var before = {};
        var input = { id: scene.id };
        Object.keys(updates).forEach(function (field) {
            if (field !== "tag_ids") { before[field] = String(scene[field] || ""); }
        });
        return graphQLRequest(FRESH_SCENE_QUERY, { id: scene.id }).then(function (data) {
            var latest = data.findScene;
            if (!latest) { throw new Error("Stash no longer has this scene. Run a new library check."); }
            var changedSinceScan = ["title", "date"].some(function (field) {
                return Object.prototype.hasOwnProperty.call(updates, field)
                    && String(latest[field] || "").trim() !== String(scene[field] || "").trim();
            });
            if (changedSinceScan) {
                throw new Error("This scene changed after the check. Close this dialog and run the check again before applying a fix.");
            }
            Object.keys(updates).forEach(function (field) {
                if (field !== "tag_ids") { input[field] = updates[field]; }
            });
            if (Object.prototype.hasOwnProperty.call(updates, "tag_ids")) {
                before.tag_ids = (Array.isArray(latest.tags) ? latest.tags : []).map(function (tag) { return String(tag.id); });
                input.tag_ids = before.tag_ids.slice();
                updates.tag_ids.forEach(function (id) {
                    var value = String(id);
                    if (input.tag_ids.indexOf(value) === -1) { input.tag_ids.push(value); }
                });
            }
            return graphQLRequest(UPDATE_SCENE_MUTATION, { input: input });
        }).then(function (data) {
            var updated = data.sceneUpdate;
            if (!updated || String(updated.id) !== scene.id) {
                throw new Error("Stash did not confirm the updated scene. Run a new library check to verify its state.");
            }
            if (updated.title != null) { scene.title = String(updated.title).trim(); }
            else if (updates.title) { scene.title = updates.title; }
            if (updated.date != null) { scene.date = String(updated.date).trim(); }
            else if (updates.date) { scene.date = updates.date; }
            if (Array.isArray(updated.tags)) {
                scene.tags = updated.tags.map(function (tag) { return { id: String(tag.id), name: String(tag.name || "").trim() }; });
            }
            var undo = { id: scene.id, sceneLabel: scene.title || "Untitled scene", before: before, after: {} };
            Object.keys(updates).forEach(function (field) {
                undo.after[field] = field === "tag_ids" ? scene.tags.map(function (tag) { return String(tag.id); }) : scene[field];
            });
            undoStack.push(undo);
            if (undoStack.length > 20) { undoStack.shift(); }
            scene._doctorIssues = scene._doctorIssues.filter(function (issue) {
                return !(issue.label === "Missing title" && scene.title)
                    && !(issue.label === "Missing date" && scene.date)
                    && !(issue.label === "No tags" && scene.tags.length);
            });
            results.forEach(function (item) {
                item._doctorIssues = item._doctorIssues.filter(function (issue) { return issue.kind !== "review"; });
            });
            markRepeatedTitles(results);
            if (settings.render !== false) { render(); }
            return scene;
        });
    }

    function sameIds(left, right) {
        var a = (Array.isArray(left) ? left : []).map(String).sort();
        var b = (Array.isArray(right) ? right : []).map(String).sort();
        return a.length === b.length && a.every(function (id, index) { return id === b[index]; });
    }

    function undoLastFix() {
        if (undoingFix || scrapeBusy || !undoStack.length) { return; }
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
                if (field === "tag_ids") {
                    return !sameIds((Array.isArray(latest.tags) ? latest.tags : []).map(function (tag) { return tag.id; }), undo.after.tag_ids);
                }
                return String(latest[field] || "").trim() !== String(undo.after[field] || "").trim();
            });
            if (changedSinceFix) {
                throw new Error("This field changed after Library Doctor updated it. The change was not undone to avoid overwriting newer work.");
            }
            var input = { id: undo.id };
            Object.keys(undo.before).forEach(function (field) { input[field === "tag_ids" ? "tag_ids" : field] = undo.before[field]; });
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
                    if (field === "tag_ids") {
                        scene.tags = (Array.isArray(updated.tags) ? updated.tags : []).map(function (tag) { return { id: String(tag.id), name: String(tag.name || "").trim() }; });
                        scene._doctorIssues = scene._doctorIssues.filter(function (issue) { return issue.label !== "No tags"; });
                        if (!scene.tags.length) { addIssue(scene, "No tags", "metadata"); }
                        return;
                    }
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
            var fieldNames = Object.keys(undo.before).map(function (field) {
                return field === "title" ? "title" : (field === "date" ? "date" : "tags");
            });
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
        if (applyingFix || undoingFix || scrapeBusy || !pendingFixScene) { return; }
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
            var labels = Object.keys(state.updates).map(function (field) { return field === "title" ? "title" : (field === "date" ? "date" : "tags"); });
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
        updateEncodingControls();
    }

    function scan() {
        if (scanController || scrapeBusy) { return; }
        setWorkspace("health");
        scanController = new AbortController();
        var controller = scanController;
        var collected = [];
        var total = 0;
        var page = 1;
        completeScan = false;
        results = [];
        lastScanDate = null;
        scrapeEntries = [];
        scrapeAttempted = Object.create(null);
        scrapeStats = { total: 0, processed: 0, exact: 0, applied: 0, review: 0, noMatch: 0, errors: 0, tagsAdded: 0, tagsCreated: 0 };
        tagCatalog = null;
        tagCatalogPromise = null;
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
        updateEncodingControls();
        els.scrapeProgress.hidden = true;
        renderScrapeResults();
        updateScrapeControls();
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
        if (hasIssue(scene, "Missing title") || hasIssue(scene, "Missing date") || hasIssue(scene, "No tags")) {
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
        renderScrapeResults();
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
            duplicatesTabCount: byId("ld-tab-duplicates-count"), scrapeTabCount: byId("ld-tab-scrape-count"), metadataEmpty: byId("ld-metadata-empty"),
            encodingTabCount: byId("ld-tab-encoding-count"), encodingCount: byId("ld-encoding-count"), encodingSearch: byId("ld-encoding-search"), encodingResolution: byId("ld-encoding-resolution"), encodingFile: byId("ld-encoding-file"),
            encodingPreset: byId("ld-encoding-preset"), encodingContainer: byId("ld-encoding-container"), encodingCustom: byId("ld-encoding-custom"),
            encodingCodec: byId("ld-encoding-codec"), encodingCrf: byId("ld-encoding-crf"), encodingSpeed: byId("ld-encoding-speed"),
            encodingHeight: byId("ld-encoding-height"), encodingAudio: byId("ld-encoding-audio"), encodingReplace: byId("ld-encoding-replace"),
            encodingPreview: byId("ld-encoding-preview"), encodingRun: byId("ld-encoding-run"), encodingJob: byId("ld-encoding-job"),
            encodingJobTitle: byId("ld-encoding-job-title"), encodingJobStatus: byId("ld-encoding-job-status"), encodingJobDetail: byId("ld-encoding-job-detail"),
            encodingProgressTrack: byId("ld-encoding-progress-track"), encodingProgressBar: byId("ld-encoding-progress-bar"),
            encodingError: byId("ld-encoding-error"), encodingEmpty: byId("ld-encoding-empty"), encodingList: byId("ld-encoding-list"),
            metadataList: byId("ld-metadata-list"),
            scrapeSource: byId("ld-scrape-source"), scrapeSourceStatus: byId("ld-scrape-source-status"),
            scrapeRemaining: byId("ld-scrape-remaining"), scrapeRefresh: byId("ld-scrape-refresh"),
            scrapeCreateTags: byId("ld-scrape-create-tags"), scrapeRun: byId("ld-scrape-run"),
            scrapeProgress: byId("ld-scrape-progress"), scrapeProgressDetail: byId("ld-scrape-progress-detail"),
            scrapeProgressBar: byId("ld-scrape-progress-bar"), scrapeProgressTrack: byId("ld-scrape-progress-track"),
            scrapeCountApplied: byId("ld-scrape-count-applied"), scrapeCountTags: byId("ld-scrape-count-tags"),
            scrapeCountReview: byId("ld-scrape-count-review"), scrapeCountNoMatch: byId("ld-scrape-count-no-match"),
            scrapeCountErrors: byId("ld-scrape-count-errors"), scrapeEmpty: byId("ld-scrape-empty"),
            scrapeResults: byId("ld-scrape-results"), scrapeList: byId("ld-scrape-list"),
            status: byId("ld-status"), statusMessage: byId("ld-status-message"), undo: byId("ld-undo"),
            duplicateReview: byId("ld-duplicate-review"), duplicateCount: byId("ld-duplicate-count"),
            duplicateToggle: byId("ld-duplicate-toggle-reviewed"),
            duplicateEmpty: byId("ld-duplicate-empty"), duplicateGroups: byId("ld-duplicate-groups"),
            fixDialog: byId("ld-fix-dialog"), fixScene: byId("ld-fix-scene"),
            fixTitleField: byId("ld-fix-title-field"), fixTitleChoice: byId("ld-fix-title-choice"), fixTitle: byId("ld-fix-title"),
            fixTitleHint: byId("ld-fix-title-suggestion"),
            fixDateField: byId("ld-fix-date-field"), fixDateChoice: byId("ld-fix-date-choice"), fixDate: byId("ld-fix-date"),
            fixDateHint: byId("ld-fix-date-suggestion"),
            fixTagsField: byId("ld-fix-tags-field"), fixTagsChoice: byId("ld-fix-tags-choice"),
            fixTagPicker: byId("ld-fix-tag-picker"), fixTagSearch: byId("ld-fix-tag-search"),
            fixTagSelected: byId("ld-fix-tag-selected"), fixTagOptions: byId("ld-fix-tag-options"),
            fixTagStatus: byId("ld-fix-tag-status"), fixTagRefresh: byId("ld-fix-tag-refresh"),
            fixPreview: byId("ld-fix-preview"), fixValidation: byId("ld-fix-validation"), fixError: byId("ld-fix-error"),
            fixApply: byId("ld-fix-apply"), fixCancel: byId("ld-fix-cancel"), fixClose: byId("ld-fix-close")
        };
        setWorkspace(currentWorkspace);
        document.querySelectorAll(".ld-workspace-tab[data-workspace]").forEach(function (tab) {
            tab.addEventListener("click", function () {
                var workspace = tab.getAttribute("data-workspace");
                setWorkspace(workspace);
                if (workspace === "scrape") { loadScrapers(); }
                if (workspace === "encoding") {
                    encodingFilesForResults = null;
                    renderEncodingAuditor();
                }
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
        els.scrapeRefresh.addEventListener("click", function () { loadScrapers(true); });
        els.scrapeSource.addEventListener("change", updateScrapeControls);
        els.scrapeRun.addEventListener("click", scrapeMetadataGaps);
        els.encodingPreset.addEventListener("change", updateEncodingControls);
        els.encodingContainer.addEventListener("change", updateEncodingControls);
        [els.encodingCodec, els.encodingCrf, els.encodingSpeed, els.encodingHeight, els.encodingAudio].forEach(function (control) {
            control.addEventListener("change", updateEncodingControls);
            control.addEventListener("input", updateEncodingControls);
        });
        els.encodingFile.addEventListener("change", updateEncodingControls);
        els.encodingSearch.addEventListener("input", renderEncodingAuditor);
        els.encodingResolution.addEventListener("change", renderEncodingAuditor);
        els.encodingRun.addEventListener("click", startEncoding);
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
        els.fixTagsChoice.addEventListener("change", function () {
            els.fixTagSearch.disabled = !els.fixTagsChoice.checked;
            els.fixTagPicker.hidden = !els.fixTagsChoice.checked;
            if (els.fixTagsChoice.checked && tagCatalog) { renderFixTagPicker(); }
            updateFixPreview();
        });
        els.fixTagSearch.addEventListener("input", renderFixTagPicker);
        els.fixTagRefresh.addEventListener("click", function () {
            tagCatalog = null;
            tagCatalogPromise = null;
            loadFixTags();
        });
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

    applyHostTheme();
    bind();
}());
