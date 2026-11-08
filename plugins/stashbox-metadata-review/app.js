(function () {
    "use strict";

    var Core = window.StashBoxReviewCore;
    var THEME_KEY = "stashbox-metadata-review.host-theme.v1";
    var HISTORY_KEY = "stashbox-metadata-review.history.v1";
    var BATCH_SIZE = 25;
    var BATCH_SCENE_FIELDS = "id title code details director date production_date urls created_at updated_at organized stash_ids { endpoint stash_id updated_at } studio { id name } groups { group { id name } scene_index } performers { id name } tags { id name } files { id duration fingerprints { type value } }";
    var BATCH_SCENES_QUERY = "query StashBoxReviewSceneQueue($filter: FindFilterType!, $sceneFilter: SceneFilterType!) { findScenes(filter: $filter, scene_filter: $sceneFilter) { count scenes { " + BATCH_SCENE_FIELDS + " } } }";
    var BATCH_FRESH_SCENE_QUERY = "query StashBoxReviewFreshBatchScene($id: ID!) { findScene(id: $id) { " + BATCH_SCENE_FIELDS + " } }";
    var BATCH_SCRAPE_QUERY = "query StashBoxReviewScrapeBatch($source: ScraperSourceInput!, $input: ScrapeMultiScenesInput!) { scrapeMultiScenes(source: $source, input: $input) { title code details director urls date production_date remote_site_id duration fingerprints { algorithm hash duration submissions } studio { stored_id name } groups { stored_id name } tags { stored_id name } performers { stored_id name } } }";
    var THEME_PROPERTIES = [
        "--ld-bg", "--ld-surface", "--ld-surface-strong", "--ld-border", "--ld-border-strong",
        "--ld-text", "--ld-muted", "--ld-subtle", "--ld-accent", "--ld-accent-contrast",
        "--ld-primary-bg", "--ld-primary-border", "--ld-primary-text", "--ld-accent-bright",
        "--ld-accent-light", "--ld-accent-rgb", "--ld-accent-soft", "--ld-green", "--ld-orange", "--ld-red",
        "--ld-radius", "--ld-radius-sm", "--ld-font", "--ld-button-font", "--ld-button-size",
        "--ld-button-weight", "--ld-button-line-height", "--ld-button-radius"
    ];
    var ACCENTS = { orange: "#d83b01", blue: "#0078d4", pink: "#e3008c", red: "#d13438", yellow: "#f2c811", purple: "#8764b8", green: "#107c10", teal: "#038387" };
    var CONFIG_QUERY = "query StashBoxReviewSources { configuration { general { stashBoxes { name endpoint } } } }";
    var state = {
        type: "performer", sources: [], selectedSources: Object.create(null), local: null, matches: [],
        sourceResults: [], candidateIndex: Object.create(null), choices: Object.create(null), busy: false, history: loadHistory(),
        workspace: "record", batchScenes: [], batchMatches: Object.create(null), batchSelected: Object.create(null),
        batchLoading: false, batchStop: false, batchCanStop: false, batchApplied: Object.create(null)
    };
    var els = {};

    function byId(id) { return document.getElementById(id); }
    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
        });
    }
    function getDefinition() { return Core.getEntity(state.type); }
    function displayName(item, type) {
        var config = Core.getEntity(type);
        if (!item || !config) return "";
        return String(item[config.nameField] || "Untitled " + config.label.toLowerCase());
    }
    function stashEndpointKey(endpoint) { return String(endpoint || "").trim().replace(/\/+$/, "").toLocaleLowerCase(); }
    function formatted(value) {
        if (!Core.hasValue(value)) return "Not set";
        if (Array.isArray(value)) return value.length ? value.join(", ") : "Not set";
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }

    function setError(message) {
        els.error.textContent = message || "";
        els.error.hidden = !message;
    }
    function setStatus(message) {
        els.statusMessage.textContent = message || "";
        els.status.hidden = !message;
    }
    function setBusy(busy, label) {
        state.busy = busy;
        [els.find, els.compare, els.apply, els.refresh].forEach(function (button) { button.disabled = busy; });
        if (busy && label) setStatus(label);
        else if (!busy && label !== false) setStatus("");
        updateButtons();
    }
    function updateButtons() {
        els.find.disabled = state.busy;
        els.refresh.disabled = state.busy;
        els.compare.disabled = state.busy || !state.local || !state.sources.some(function (source) { return state.selectedSources[source.endpoint]; });
        var selectedCount = Object.keys(state.choices).length;
        els.apply.disabled = state.busy || !state.local || selectedCount === 0;
        els.selectionNote.textContent = selectedCount ? selectedCount + " field" + (selectedCount === 1 ? "" : "s") + " selected. The rest of the local record will stay unchanged." : "No fields selected.";
        updateBatchButtons();
    }

    function graphQLRequest(query, variables) {
        return fetch("/graphql", {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query, variables: variables || {} })
        }).then(function (response) {
            return response.text().then(function (text) {
                var payload;
                try { payload = JSON.parse(text); }
                catch (error) { throw new Error("Stash returned an unreadable response. Confirm you are signed in and reload the page."); }
                if (!response.ok) throw new Error((payload.errors && payload.errors[0] && payload.errors[0].message) || ("Stash returned HTTP " + response.status + "."));
                if (payload.errors && payload.errors.length) throw new Error(payload.errors.map(function (entry) { return entry.message; }).join(" "));
                if (!payload.data) throw new Error("Stash returned no GraphQL data.");
                return payload.data;
            });
        });
    }

    function applyHostTheme() {
        try {
            var snapshot = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
            var root = document.documentElement;
            if (snapshot && snapshot.version === 1 && snapshot.tokens) {
                THEME_PROPERTIES.forEach(function (key) {
                    if (typeof snapshot.tokens[key] === "string" && snapshot.tokens[key]) root.style.setProperty(key, snapshot.tokens[key]);
                });
                if (snapshot.colorScheme === "light" || snapshot.colorScheme === "dark") root.style.colorScheme = snapshot.colorScheme;
                return;
            }
            var older = JSON.parse(localStorage.getItem("stash.theme.tokens.v1") || "null");
            var mapping = { "--ld-bg": "--bg-0", "--ld-surface": "--glass-bg", "--ld-surface-strong": "--glass-bg-strong", "--ld-border": "--glass-border", "--ld-border-strong": "--glass-border-bright", "--ld-text": "--text", "--ld-muted": "--text-muted", "--ld-subtle": "--text-muted", "--ld-accent": "--accent", "--ld-accent-contrast": "--accent-contrast", "--ld-primary-bg": "--accent", "--ld-primary-border": "--accent", "--ld-primary-text": "--accent-contrast", "--ld-accent-bright": "--accent-bright", "--ld-accent-light": "--accent-light", "--ld-accent-rgb": "--accent-rgb", "--ld-accent-soft": "--accent-tint", "--ld-font": "--theme-font-stack", "--ld-radius": "--radius", "--ld-radius-sm": "--radius-sm" };
            var tokens = older && older.version === 1 && older.tokens ? older.tokens : null;
            if (tokens) {
                Object.keys(mapping).forEach(function (key) { if (tokens[mapping[key]]) root.style.setProperty(key, tokens[mapping[key]]); });
                root.style.colorScheme = older.colorScheme || "dark";
            }
            var accent = localStorage.getItem("mv.theme.accent");
            if (accent) root.style.setProperty("--ld-accent", accent);
            var tint = localStorage.getItem("mv.theme.accentTint");
            if (tint) root.style.setProperty("--ld-accent-soft", tint);
            var rgb = localStorage.getItem("mv.theme.accentRgb");
            if (rgb) root.style.setProperty("--ld-accent-rgb", rgb);
            var legacy = localStorage.getItem("fluent-mica.accent");
            if (!accent && legacy && ACCENTS[legacy]) root.style.setProperty("--ld-accent", ACCENTS[legacy]);
        } catch (error) { /* The default Library Doctor palette remains available. */ }
    }

    function queryForSearch(type) {
        var config = Core.getEntity(type);
        return "query StashBoxReviewFind($filter: FindFilterType!) { " + config.localFind + "(filter: $filter) { " + config.list + " { " + config.search + " } } }";
    }
    function queryForOne(type) {
        var config = Core.getEntity(type);
        return "query StashBoxReviewFresh($id: ID!) { " + config.one + "(id: $id) { " + config.search + " } }";
    }
    function queryForScrape(type) {
        var config = Core.getEntity(type);
        var fields = config.fields.map(function (field) { return field[0]; }).filter(function (key, index, all) { return all.indexOf(key) === index; });
        return "query StashBoxReviewScrape($source: ScraperSourceInput!, $input: " + config.scrapeInput + "!) { " + config.scrape + "(source: $source, input: $input) { " + fields.join(" ") + " } }";
    }
    function queryForUpdate(type) {
        var config = Core.getEntity(type);
        return "mutation StashBoxReviewUpdate($input: " + config.updateInput + "!) { " + config.update + "(input: $input) { id } }";
    }
    function scrapeInput(type, local, byName) {
        if (type === "scene" && !byName) return { scene_id: String(local.id) };
        var config = Core.getEntity(type);
        return { query: String(local[config.nameField] || "") };
    }

    function loadSources() {
        return graphQLRequest(CONFIG_QUERY).then(function (data) {
            var general = data.configuration && data.configuration.general;
            state.sources = general && Array.isArray(general.stashBoxes) ? general.stashBoxes.filter(function (source) { return source && source.endpoint; }) : [];
            state.selectedSources = Object.create(null);
            state.sources.forEach(function (source) { state.selectedSources[source.endpoint] = true; });
            renderSources();
            setError("");
            if (!state.sources.length) setStatus("No StashBoxes are configured. Add one under Settings → Metadata Providers, then refresh this page.");
            else setStatus("Loaded " + state.sources.length + " configured StashBox" + (state.sources.length === 1 ? "" : "es") + ".");
        });
    }

    function renderSources() {
        if (!state.sources.length) {
            els.sources.innerHTML = '<p class="sbmr-muted">No configured StashBoxes were found.</p>';
            els.sourceCount.textContent = "";
            renderBatchSources();
            updateButtons();
            return;
        }
        els.sources.innerHTML = state.sources.map(function (source, index) {
            return '<label class="sbmr-source-option"><input type="checkbox" data-source-index="' + index + '" ' + (state.selectedSources[source.endpoint] ? "checked" : "") + '><span class="sbmr-source-copy"><strong>' + escapeHtml(source.name || "StashBox " + (index + 1)) + '</strong><small>' + escapeHtml(source.endpoint) + '</small></span></label>';
        }).join("");
        var count = state.sources.filter(function (source) { return state.selectedSources[source.endpoint]; }).length;
        els.sourceCount.textContent = count + " of " + state.sources.length + " selected";
        renderBatchSources();
        updateButtons();
    }

    function renderBatchSources() {
        if (!els.batchSource) return;
        if (!state.sources.length) {
            els.batchSource.innerHTML = '<option value="">No StashBox sources</option>';
            return;
        }
        var selectedOption = els.batchSource.selectedOptions && els.batchSource.selectedOptions[0];
        var previousEndpoint = selectedOption && selectedOption.dataset.endpoint;
        els.batchSource.innerHTML = state.sources.map(function (source, index) {
            return '<option value="' + index + '" data-endpoint="' + escapeHtml(source.endpoint) + '">' + escapeHtml(source.name || "StashBox " + (index + 1)) + '</option>';
        }).join("");
        var selectedIndex = state.sources.findIndex(function (source) { return source.endpoint === previousEndpoint; });
        els.batchSource.value = String(selectedIndex >= 0 ? selectedIndex : 0);
    }

    function updateBatchButtons() {
        if (!els.batchLoad) return;
        var selected = state.batchScenes.filter(function (scene) { return state.batchSelected[String(scene.id)]; });
        var comparable = selected.filter(function (scene) { return state.batchMatches[String(scene.id)] && state.batchMatches[String(scene.id)].results && state.batchMatches[String(scene.id)].results.length; });
        els.batchLoad.disabled = state.busy || state.batchLoading;
        els.batchSource.disabled = state.batchLoading;
        [els.batchMissing, els.batchDays, els.batchLimit, els.batchUnorganized, els.batchQuery,
            els.batchEmptyOnly, els.batchOrganize, els.batchTagMode].forEach(function (control) { control.disabled = state.batchLoading; });
        els.batchSelectAll.disabled = state.batchLoading || !state.batchScenes.length;
        els.batchSelectNone.disabled = state.batchLoading || !state.batchScenes.length;
        els.batchCompare.disabled = state.busy || state.batchLoading || !selected.length || !state.sources.length;
        els.batchStop.hidden = !state.batchLoading || !state.batchCanStop;
        els.batchStop.disabled = state.batchStop;
        if (els.batchResults) els.batchResults.querySelectorAll("input, select").forEach(function (control) { control.disabled = state.batchLoading; });
        els.batchApply.disabled = state.busy || state.batchLoading || !comparable.some(function (scene) {
            var match = state.batchMatches[String(scene.id)];
            return match && !state.batchApplied[String(scene.id)] && Object.keys(match.selectedFields || {}).some(function (field) { return match.selectedFields[field]; });
        });
    }

    function runSearch() {
        var query = els.search.value.trim();
        if (query.length < 2) { setError("Enter at least two characters to search your local library."); return; }
        setError("");
        setBusy(true, "Searching your local " + getDefinition().label.toLowerCase() + " records…");
        graphQLRequest(queryForSearch(state.type), { filter: { q: query, page: 1, per_page: 30, sort: getDefinition().nameField, direction: "ASC" } })
            .then(function (data) {
                state.matches = data[getDefinition().localFind] ? data[getDefinition().localFind][getDefinition().list] || [] : [];
                renderMatches();
                setStatus(state.matches.length ? "Found " + state.matches.length + " local record" + (state.matches.length === 1 ? "" : "s") + ". Select one to continue." : "No local records matched that search.");
            })
            .catch(function (error) { setError(error.message); })
            .finally(function () { setBusy(false, false); });
    }

    function renderMatches() {
        if (!state.matches.length) { els.results.innerHTML = ""; els.results.hidden = true; return; }
        els.results.innerHTML = state.matches.map(function (item, index) {
            var secondary = item.disambiguation || item.code || item.date || item.details || "";
            return '<button class="sbmr-local-result" type="button" data-local-index="' + index + '"><span><strong>' + escapeHtml(displayName(item, state.type)) + '</strong><small>' + escapeHtml(secondary) + '</small></span><span class="sbmr-result-arrow" aria-hidden="true">›</span></button>';
        }).join("");
        els.results.hidden = false;
    }

    function chooseLocal(index) {
        state.local = state.matches[index] || null;
        state.sourceResults = [];
        state.candidateIndex = Object.create(null);
        state.choices = Object.create(null);
        els.review.hidden = true;
        if (!state.local) { els.selected.hidden = true; updateButtons(); return; }
        var definition = getDefinition();
        var secondary = state.local.disambiguation || state.local.code || state.local.date || "";
        els.selected.innerHTML = '<div class="sbmr-selected-mark" aria-hidden="true">✓</div><div><p class="sbmr-selected-label">Selected local ' + escapeHtml(definition.label.toLowerCase()) + '</p><h3>' + escapeHtml(displayName(state.local, state.type)) + '</h3>' + (secondary ? '<p>' + escapeHtml(secondary) + '</p>' : '') + '</div><button id="sbmr-clear-local" class="ld-button ld-button-quiet" type="button">Change</button>';
        els.selected.hidden = false;
        setStatus("Ready to compare " + displayName(state.local, state.type) + ".");
        updateButtons();
    }

    function compare() {
        if (!state.local) return;
        var selected = state.sources.filter(function (source) { return state.selectedSources[source.endpoint]; });
        if (!selected.length) { setError("Select at least one StashBox source."); return; }
        setError("");
        els.review.hidden = false;
        els.sourceResults.innerHTML = "";
        els.fieldList.innerHTML = '<p class="sbmr-empty">Comparing the selected record with ' + selected.length + ' source' + (selected.length === 1 ? "" : "s") + '…</p>';
        state.sourceResults = [];
        state.candidateIndex = Object.create(null);
        state.choices = Object.create(null);
        setBusy(true, "Comparing metadata with configured StashBoxes…");
        var request = queryForScrape(state.type);
        Promise.all(selected.map(function (source) {
            var variables = { source: { stash_box_endpoint: source.endpoint }, input: scrapeInput(state.type, state.local, false) };
            return graphQLRequest(request, variables).then(function (data) {
                var results = data[getDefinition().scrape] || [];
                if (state.type === "scene" && !results.length && state.local.title) {
                    return graphQLRequest(request, { source: variables.source, input: scrapeInput("scene", state.local, true) }).then(function (nameData) {
                        return { source: source, results: nameData[getDefinition().scrape] || [], searchedByName: true };
                    });
                }
                return { source: source, results: results, searchedByName: false };
            }).catch(function (error) { return { source: source, results: [], error: error.message }; });
        })).then(function (results) {
            state.sourceResults = results;
            results.forEach(function (result) { state.candidateIndex[result.source.endpoint] = 0; });
            renderComparison();
            var hits = results.filter(function (result) { return result.results.length; }).length;
            setStatus("Compared " + results.length + " source" + (results.length === 1 ? "" : "s") + "; " + hits + " returned a match.");
        }).catch(function (error) { setError(error.message); })
            .finally(function () { setBusy(false, false); });
    }

    function candidateFor(result) {
        var index = state.candidateIndex[result.source.endpoint] || 0;
        return result.results[index] || null;
    }
    function candidateName(candidate) {
        if (!candidate) return "No result";
        var keys = ["name", "title"];
        for (var i = 0; i < keys.length; i += 1) if (candidate[keys[i]]) return candidate[keys[i]];
        return "Result " + ((state.candidateIndex["_"] || 0) + 1);
    }
    function renderSourceResults() {
        els.sourceResults.innerHTML = state.sourceResults.map(function (result, sourceIndex) {
            var source = result.source;
            var candidate = candidateFor(result);
            var label = source.name || "StashBox " + (sourceIndex + 1);
            var title = candidate ? candidateName(candidate) : (result.error ? "Source error" : "No match");
            var resultPicker = result.results.length > 1 ? '<label class="sbmr-candidate-picker"><span>Match (' + result.results.length + ')</span><select data-candidate-endpoint="' + escapeHtml(source.endpoint) + '">' + result.results.map(function (entry, index) {
                return '<option value="' + index + '" ' + ((state.candidateIndex[source.endpoint] || 0) === index ? "selected" : "") + '>' + escapeHtml(candidateName(entry)) + (entry.stored_id ? " · matched" : "") + '</option>';
            }).join("") + '</select></label>' : "";
            var stateText = result.error ? result.error : (candidate ? (result.searchedByName ? "Matched using the scene title" : "Metadata returned") : "No match found for this record");
            return '<article class="sbmr-source-card ' + (result.error ? "is-error" : "") + '"><div class="sbmr-source-card-heading"><span class="sbmr-source-icon" aria-hidden="true">' + (candidate ? "✓" : "·") + '</span><div><h3>' + escapeHtml(label) + '</h3><p>' + escapeHtml(title) + '</p></div><span class="sbmr-source-state">' + (candidate ? "Match" : (result.error ? "Error" : "No match")) + '</span></div><p class="sbmr-source-note">' + escapeHtml(stateText) + '</p>' + resultPicker + '</article>';
        }).join("");
    }

    function visibleFields() {
        var definition = getDefinition();
        return definition.fields.map(function (field) {
            var choices = [];
            state.sourceResults.forEach(function (result) {
                var candidate = candidateFor(result);
                if (!candidate) return;
                var normalized = Core.normalizeRemote(state.type, field, candidate[field[0]]);
                if (Core.hasValue(normalized)) choices.push({ source: result.source, candidateIndex: state.candidateIndex[result.source.endpoint] || 0, value: normalized, raw: candidate[field[0]] });
            });
            return { field: field, choices: choices, localValue: Core.normalizeLocal(state.type, field, state.local ? state.local[Core.fieldKey(field)] : null) };
        }).filter(function (row) { return row.choices.length > 0; });
    }

    function renderFieldList() {
        if (!state.local || !state.sourceResults.length) {
            els.fieldList.innerHTML = '<p class="sbmr-empty">No source results to compare.</p>';
            updateButtons();
            return;
        }
        var rows = visibleFields();
        if (!rows.length) {
            els.fieldList.innerHTML = '<div class="sbmr-empty">No fields were returned by the selected sources.</div>';
            updateButtons();
            return;
        }
        els.fieldList.innerHTML = rows.map(function (row) {
            var key = Core.fieldKey(row.field);
            var hasDifferent = row.choices.some(function (choice) { return Core.canonical(choice.value) !== Core.canonical(row.localValue); });
            var buttons = row.choices.map(function (choice) {
                var source = choice.source;
                var active = state.choices[key] && state.choices[key].endpoint === source.endpoint;
                var difference = Core.canonical(choice.value) === Core.canonical(row.localValue);
                return '<button type="button" class="sbmr-value-choice ' + (active ? "is-selected" : "") + '" data-field-key="' + escapeHtml(key) + '" data-endpoint="' + escapeHtml(source.endpoint) + '" aria-pressed="' + Boolean(active) + '"><span class="sbmr-choice-source">' + escapeHtml(source.name || source.endpoint) + '<small>' + (difference ? "Matches local" : "Different") + '</small></span><span class="sbmr-choice-value">' + escapeHtml(formatted(choice.value)) + '</span></button>';
            }).join("");
            return '<article class="sbmr-field-card"><div class="sbmr-field-heading"><h3>' + escapeHtml(row.field[1]) + '</h3><span class="sbmr-diff-badge ' + (hasDifferent ? "is-different" : "") + '">' + (hasDifferent ? "Difference" : "Matches") + '</span></div><div class="sbmr-field-values"><div class="sbmr-local-value"><span class="sbmr-value-label">Current value</span><strong>' + escapeHtml(formatted(row.localValue)) + '</strong></div>' + buttons + '</div></article>';
        }).join("");
        updateButtons();
    }

    function renderComparison() {
        renderSourceResults();
        renderFieldList();
    }

    function freshLocal(type, id) {
        return graphQLRequest(queryForOne(type), { id: String(id) }).then(function (data) { return data[Core.getEntity(type).one]; });
    }

    function applyChoices() {
        var selectedKeys = Object.keys(state.choices);
        if (!selectedKeys.length || !state.local) return;
        var type = state.type;
        var definition = getDefinition();
        setError("");
        setBusy(true, "Checking the local record before applying changes…");
        freshLocal(type, state.local.id).then(function (fresh) {
            if (!fresh) throw new Error("The local record could not be found. Search for it again before applying changes.");
            var remoteValues = {};
            var before = {};
            var sourceNames = [];
            selectedKeys.forEach(function (key) {
                var field = definition.fields.filter(function (entry) { return Core.fieldKey(entry) === key; })[0];
                var choice = state.choices[key];
                var result = state.sourceResults.filter(function (entry) { return entry.source.endpoint === choice.endpoint; })[0];
                var candidate = result && result.results[choice.candidateIndex];
                if (!field || !candidate) throw new Error("A selected source result is no longer available. Run the comparison again.");
                var localKey = Core.fieldKey(field);
                var original = Core.normalizeLocal(type, field, state.local[localKey]);
                var current = Core.normalizeLocal(type, field, fresh[localKey]);
                if (Core.canonical(original) !== Core.canonical(current)) throw new Error("The local " + field[1].toLowerCase() + " changed after comparison. Compare again to review the latest value safely.");
                var nextValue = Core.updateValue(type, field, candidate[field[0]]);
                if (!Core.hasValue(nextValue)) throw new Error("The selected source returned no usable value for " + field[1] + ".");
                remoteValues[localKey] = candidate[field[0]];
                before[localKey] = current;
                if (sourceNames.indexOf(result.source.name || result.source.endpoint) < 0) sourceNames.push(result.source.name || result.source.endpoint);
            });
            var update = Core.buildUpdate(type, fresh.id, remoteValues);
            if (Object.keys(update).length !== selectedKeys.length + 1) throw new Error("One or more selected values could not be safely converted for Stash. Review the fields and compare again.");
            return graphQLRequest(queryForUpdate(type), { input: update }).then(function () {
                return freshLocal(type, state.local.id).catch(function () { return null; }).then(function (saved) {
                    saved = Object.assign({}, state.local, update, saved || {});
                    var after = {};
                    selectedKeys.forEach(function (key) {
                        var field = definition.fields.filter(function (entry) { return Core.fieldKey(entry) === key; })[0];
                        after[key] = Core.normalizeLocal(type, field, saved[key]);
                    });
                    var record = {
                        at: new Date().toISOString(), type: type, label: definition.label,
                        entity: displayName(state.local, type), entityId: String(state.local.id),
                        sources: sourceNames, fields: selectedKeys.slice(), before: before, after: after
                    };
                    state.history.unshift(record);
                    state.history = state.history.slice(0, 30);
                    saveHistory();
                    renderHistory();
                    state.local = saved;
                    state.choices = Object.create(null);
                    state.sourceResults = [];
                    els.review.hidden = true;
                    chooseLocalFromFresh(saved);
                    setStatus("Updated " + selectedKeys.length + " field" + (selectedKeys.length === 1 ? "" : "s") + " on " + record.entity + ".");
                });
            });
        }).catch(function (error) { setError(error.message); })
            .finally(function () { setBusy(false, false); });
    }

    function chooseLocalFromFresh(item) {
        var definition = getDefinition();
        var secondary = item.disambiguation || item.code || item.date || "";
        els.selected.innerHTML = '<div class="sbmr-selected-mark" aria-hidden="true">✓</div><div><p class="sbmr-selected-label">Selected local ' + escapeHtml(definition.label.toLowerCase()) + '</p><h3>' + escapeHtml(displayName(item, state.type)) + '</h3>' + (secondary ? '<p>' + escapeHtml(secondary) + '</p>' : '') + '</div><button id="sbmr-clear-local" class="ld-button ld-button-quiet" type="button">Change</button>';
        els.selected.hidden = false;
    }

    function loadHistory() {
        try {
            var records = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
            return Array.isArray(records) ? records.slice(0, 30) : [];
        } catch (error) { return []; }
    }
    function saveHistory() {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); }
        catch (error) { setStatus("The changes were applied, but browser storage could not save the local history."); }
    }
    function renderHistory() {
        if (!state.history.length) {
            els.history.innerHTML = '<p class="sbmr-muted">No changes yet.</p>';
            els.clearHistory.disabled = true;
            return;
        }
        els.clearHistory.disabled = false;
        els.history.innerHTML = state.history.map(function (record) {
            var date = new Date(record.at);
            var dateText = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
            var fieldNames = record.fields.map(function (key) {
                var value = record.after[key];
                return '<li><strong>' + escapeHtml(key.replace(/_/g, " ")) + '</strong><span>' + escapeHtml(formatted(value)) + '</span></li>';
            }).join("");
            return '<details class="sbmr-history-entry"><summary><span><strong>' + escapeHtml(record.entity) + '</strong><small>' + escapeHtml(record.label) + ' · ' + record.fields.length + ' field' + (record.fields.length === 1 ? "" : "s") + '</small></span><time>' + escapeHtml(dateText) + '</time></summary><div class="sbmr-history-body"><p>Source: ' + escapeHtml((record.sources || []).join(", ")) + '</p><ul>' + fieldNames + '</ul></div></details>';
        }).join("");
    }

    function setWorkspace(workspace) {
        state.workspace = workspace;
        document.querySelectorAll("[data-sbmr-workspace]").forEach(function (button) {
            var active = button.dataset.sbmrWorkspace === workspace;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        document.querySelectorAll("[data-sbmr-panel]").forEach(function (panel) {
            var panelWorkspace = panel.dataset.sbmrPanel;
            panel.classList.toggle("sbmr-workspace-inactive", panelWorkspace !== "shared" && panelWorkspace !== workspace);
        });
    }

    function batchSelectedScenes() {
        return state.batchScenes.filter(function (scene) { return state.batchSelected[String(scene.id)]; });
    }

    function updateBatchProgress(title, detail, percentage) {
        els.batchProgress.hidden = false;
        els.batchProgressTitle.textContent = title;
        els.batchProgressDetail.textContent = detail || "";
        els.batchProgressBar.style.width = Math.max(0, Math.min(100, percentage || 0)) + "%";
    }

    function loadBatchScenes() {
        if (state.batchLoading) return;
        var limit = Number(els.batchLimit.value) || 100;
        var perPage = Math.min(limit, 100);
        var search = els.batchQuery.value.trim();
        var filterOptions = {
            unorganized: els.batchUnorganized.checked,
            missing: els.batchMissing.value,
            days: Number(els.batchDays.value) || 0
        };
        var sceneFilter = Core.buildSceneFilters(filterOptions);
        var scenes = [];
        var total = null;
        var page = 1;
        state.batchLoading = true;
        state.batchStop = false;
        state.batchCanStop = false;
        state.batchScenes = [];
        state.batchMatches = Object.create(null);
        state.batchSelected = Object.create(null);
        state.batchApplied = Object.create(null);
        els.batchResults.innerHTML = "";
        els.batchProgress.hidden = false;
        setError("");
        updateBatchButtons();
        updateBatchProgress("Loading scene queue…", "Querying Stash with the selected eligibility filters.", 0);

        function loadPage() {
            var findFilter = { page: page, per_page: perPage, sort: "created_at", direction: "DESC" };
            if (search) findFilter.q = search;
            return graphQLRequest(BATCH_SCENES_QUERY, { filter: findFilter, sceneFilter: sceneFilter }).then(function (data) {
                var result = data.findScenes;
                if (!result) throw new Error("Stash did not return scene queue results.");
                total = Number(result.count) || 0;
                var pageScenes = result.scenes || [];
                if (!pageScenes.length) return;
                scenes = scenes.concat(pageScenes);
                updateBatchProgress("Loading scene queue…", scenes.length + " of " + Math.min(total, limit) + " scenes", Math.min(98, (scenes.length / Math.max(1, Math.min(total, limit))) * 100));
                page += 1;
                if (scenes.length < Math.min(total, limit) && scenes.length < limit) return loadPage();
            });
        }

        loadPage().then(function () {
            state.batchScenes = scenes.slice(0, limit);
            state.batchScenes.forEach(function (scene) { state.batchSelected[String(scene.id)] = true; });
            renderBatchScenes();
            els.batchProgress.hidden = true;
            els.batchCount.textContent = "Loaded " + state.batchScenes.length + " of " + total + " matching scenes" + (state.batchScenes.length >= limit && total > limit ? " (limit reached)" : "") + ".";
            setStatus(state.batchScenes.length ? "Scene queue loaded. Review the selected records, then find StashBox matches." : "No scenes matched these filters.");
        }).catch(function (error) {
            setError(error.message);
            els.batchResults.innerHTML = '<div class="sbmr-empty">Scene queue could not be loaded.</div>';
            els.batchProgress.hidden = true;
        }).finally(function () {
            state.batchLoading = false;
            updateBatchButtons();
        });
    }

    function selectedBatchCandidate(scene) {
        var match = state.batchMatches[String(scene.id)];
        if (!match || !match.results || !match.results.length) return null;
        return match.results[match.candidateIndex || 0] || null;
    }

    function batchCandidateLabel(scene, candidate, index) {
        var score = Core.analyzeSceneMatch(scene, candidate);
        var name = candidate.title || candidate.code || "Result " + (index + 1);
        var parts = [];
        if (score.phashMatches) parts.push(score.phashMatches + " pHash");
        if (score.oshashMatches) parts.push(score.oshashMatches + " OSHash");
        if (score.durationMatches) parts.push(score.durationMatches + " duration");
        return name + (parts.length ? " · " + parts.join(" / ") : " · fingerprints not close");
    }

    var BATCH_SCALAR_FIELDS = [
        ["title", "Title"], ["code", "Code"], ["details", "Details"], ["director", "Director"],
        ["date", "Date"], ["production_date", "Production date"], ["urls", "URLs"]
    ];

    function initializeBatchChoices(scene, match, candidate) {
        if (match.selectedFields) return;
        match.selectedFields = Object.create(null);
        var onlyEmpty = els.batchEmptyOnly.checked;
        BATCH_SCALAR_FIELDS.forEach(function (field) {
            var value = candidate[field[0]];
            if (!Core.hasValue(value)) return;
            if (field[0] === "urls" && !Array.isArray(value)) value = [value];
            var localValue = scene[field[0]];
            if (field[0] === "urls") localValue = scene.urls;
            if (!onlyEmpty || !Core.hasValue(localValue)) match.selectedFields[field[0]] = true;
        });
        if (candidate.studio && candidate.studio.stored_id && (!onlyEmpty || !scene.studio)) match.selectedFields.studio_id = true;
        if ((candidate.performers || []).some(function (performer) { return performer.stored_id; }) && (!onlyEmpty || !(scene.performers || []).length)) match.selectedFields.performer_ids = true;
        if ((candidate.tags || []).some(function (tag) { return tag.stored_id; }) && (!onlyEmpty || !(scene.tags || []).length)) match.selectedFields.tag_ids = true;
        if ((candidate.groups || []).some(function (group) { return group.stored_id; }) && (!onlyEmpty || !(scene.groups || []).length)) match.selectedFields.groups = true;
        if (candidate.remote_site_id && (!onlyEmpty || !(scene.stash_ids || []).some(function (stashID) { return stashEndpointKey(stashID.endpoint) === stashEndpointKey(match.source.endpoint); }))) match.selectedFields.stash_ids = true;
    }

    function renderBatchScene(scene) {
        var id = String(scene.id);
        var match = state.batchMatches[id];
        var candidate = selectedBatchCandidate(scene);
        if (candidate && match) initializeBatchChoices(scene, match, candidate);
        var score = candidate ? Core.analyzeSceneMatch(scene, candidate) : null;
        var fileDurations = (scene.files || []).map(function (file) { return Number(file.duration); }).filter(function (duration) { return duration > 0; });
        var createdDate = scene.created_at ? new Date(scene.created_at).toLocaleDateString() : "";
        var sceneDetails = [scene.code, scene.date, fileDurations.length ? fileDurations.map(function (duration) { return Math.round(duration) + "s"; }).join(" / ") : "No file duration", createdDate ? "Added " + createdDate : ""].filter(Boolean).join(" · ");
        var status = state.batchApplied[id] ? (state.batchApplied[id].error ? "Needs review" : "Completed") : (match ? (match.error ? "Error" : (candidate ? "Match found" : "No match")) : "Not compared");
        var candidatePicker = match && match.results && match.results.length > 1 ? '<label class="sbmr-candidate-picker"><span>Candidate (' + match.results.length + ')</span><select data-batch-candidate="' + escapeHtml(id) + '">' + match.results.map(function (entry, index) {
            return '<option value="' + index + '" ' + ((match.candidateIndex || 0) === index ? "selected" : "") + '>' + escapeHtml(batchCandidateLabel(scene, entry, index)) + '</option>';
        }).join("") + '</select></label>' : "";
        var closestDuration = score && score.bestDurationDifference < 9999 ? ' · closest ' + score.bestDurationDifference.toFixed(1) + 's' : "";
        var scoreBadges = score ? '<div class="sbmr-batch-scores">' +
            '<span class="' + (score.phashMatches ? "is-match" : "") + '">pHash ' + score.phashMatches + '/' + score.phashCount + ' ≤8</span>' +
            '<span class="' + (score.oshashMatches ? "is-match" : "") + '">OSHash exact ' + score.oshashMatches + '</span>' +
            '<span class="' + (score.durationMatches ? "is-match" : "") + '">Duration ±5s ' + score.durationMatches + '/' + score.fingerprintCount + closestDuration + '</span></div>' : "";
        var fieldRows = "";
        if (candidate && match) {
            fieldRows = BATCH_SCALAR_FIELDS.map(function (field) {
                var raw = candidate[field[0]];
                if (!Core.hasValue(raw)) return "";
                var current = field[0] === "urls" ? scene.urls : scene[field[0]];
                var checked = !!match.selectedFields[field[0]];
                return '<label class="sbmr-batch-field"><input type="checkbox" data-batch-field="' + field[0] + '" data-scene-id="' + escapeHtml(id) + '" ' + (checked ? "checked" : "") + '><span><strong>' + escapeHtml(field[1]) + '</strong><small><b>Stash:</b> ' + escapeHtml(formatted(current)) + '</small><small><b>Source:</b> ' + escapeHtml(formatted(raw)) + '</small></span></label>';
            }).join("");
            var matchedStudio = candidate.studio && candidate.studio.stored_id ? candidate.studio.name : "";
            var remotePerformers = candidate.performers || [];
            var matchedPerformers = remotePerformers.filter(function (performer) { return performer.stored_id; });
            var unmatchedPerformers = remotePerformers.length - matchedPerformers.length;
            var remoteTags = candidate.tags || [];
            var matchedTags = remoteTags.filter(function (tag) { return tag.stored_id; });
            var unmatchedTags = remoteTags.length - matchedTags.length;
            var localPerformerNames = (scene.performers || []).map(function (performer) { return performer.name; });
            var localTagNames = (scene.tags || []).map(function (tag) { return tag.name; });
            var relationshipRows = [];
            if (matchedStudio) relationshipRows.push(['studio_id', 'Studio', (scene.studio && scene.studio.name) || "Not set", matchedStudio]);
            var remoteGroups = candidate.groups || [];
            var matchedGroups = remoteGroups.filter(function (group) { return group.stored_id; });
            var unmatchedGroups = remoteGroups.length - matchedGroups.length;
            if (matchedGroups.length) relationshipRows.push(['groups', 'Matched groups', (scene.groups || []).map(function (entry) { return entry.group && entry.group.name; }).filter(Boolean).join(", ") || "Not set", matchedGroups.map(function (group) { return group.name; }).join(", ")]);
            if (matchedPerformers.length) relationshipRows.push(['performer_ids', 'Matched performers', localPerformerNames.join(", ") || "Not set", matchedPerformers.map(function (performer) { return performer.name; }).join(", ")]);
            if (matchedTags.length) relationshipRows.push(['tag_ids', 'Matched tags', localTagNames.join(", ") || "Not set", matchedTags.map(function (tag) { return tag.name; }).join(", ")]);
            if (candidate.remote_site_id) relationshipRows.push(['stash_ids', 'StashBox ID', "Linked IDs: " + (scene.stash_ids || []).length, candidate.remote_site_id]);
            fieldRows += relationshipRows.map(function (field) {
                return '<label class="sbmr-batch-field sbmr-batch-relationship"><input type="checkbox" data-batch-field="' + field[0] + '" data-scene-id="' + escapeHtml(id) + '" ' + (match.selectedFields[field[0]] ? "checked" : "") + '><span><strong>' + escapeHtml(field[1]) + '</strong><small><b>Stash:</b> ' + escapeHtml(field[2]) + '</small><small><b>Source:</b> ' + escapeHtml(field[3]) + '</small></span></label>';
            }).join("");
            if (unmatchedPerformers || unmatchedTags || unmatchedGroups) fieldRows += '<p class="sbmr-batch-unmatched">' + (unmatchedPerformers ? unmatchedPerformers + ' performer' + (unmatchedPerformers === 1 ? "" : "s") + ' ' : "") + (unmatchedTags ? unmatchedTags + ' tag' + (unmatchedTags === 1 ? "" : "s") + ' ' : "") + (unmatchedGroups ? unmatchedGroups + ' group' + (unmatchedGroups === 1 ? "" : "s") + ' ' : "") + 'did not match existing Stash records and will remain unlinked.</p>';
        }
        var message = state.batchApplied[id] && state.batchApplied[id].error ? '<p class="sbmr-batch-row-error">' + escapeHtml(state.batchApplied[id].error) + '</p>' : "";
        if (match && match.error) message = '<p class="sbmr-batch-row-error">' + escapeHtml(match.error) + '</p>';
        var content = match && match.error ? "" : (candidate ? scoreBadges + candidatePicker + '<div class="sbmr-batch-fields">' + fieldRows + '</div>' : (match ? '<p class="sbmr-muted">No StashBox result matched this scene.</p>' : '<p class="sbmr-muted">Select scenes, then find StashBox matches.</p>'));
        return '<article class="sbmr-batch-card ' + (state.batchApplied[id] && !state.batchApplied[id].error ? "is-completed" : "") + '"><div class="sbmr-batch-card-heading"><label class="sbmr-batch-scene-select"><input type="checkbox" data-batch-scene="' + escapeHtml(id) + '" ' + (state.batchSelected[id] ? "checked" : "") + '><span><strong>' + escapeHtml(scene.title || "Untitled scene") + '</strong><small>' + escapeHtml(sceneDetails || "No additional scene details") + '</small></span></label><span class="sbmr-batch-state">' + escapeHtml(status) + '</span></div>' + message + content + '</article>';
    }

    function renderBatchScenes() {
        if (!state.batchScenes.length) {
            els.batchResults.innerHTML = '<div class="sbmr-empty">No scenes are loaded.</div>';
            updateBatchButtons();
            return;
        }
        els.batchResults.innerHTML = state.batchScenes.map(renderBatchScene).join("");
        updateBatchButtons();
    }

    function compareBatchScenes() {
        if (state.batchLoading) return;
        var scenes = batchSelectedScenes();
        if (!scenes.length) { setError("Select at least one scene to process."); return; }
        var source = state.sources[Number(els.batchSource.value)];
        if (!source) { setError("Select a configured StashBox source."); return; }
        setError("");
        state.batchLoading = true;
        state.batchStop = false;
        state.batchCanStop = true;
        state.batchApplied = Object.create(null);
        scenes.forEach(function (scene) { delete state.batchMatches[String(scene.id)]; });
        els.batchStop.hidden = false;
        updateBatchButtons();
        updateBatchProgress("Finding StashBox matches…", "0 of " + scenes.length + " scenes", 0);
        renderBatchScenes();
        var offset = 0;

        function nextBatch() {
            if (state.batchStop || offset >= scenes.length) return Promise.resolve();
            var currentBatch = scenes.slice(offset, offset + BATCH_SIZE);
            var variables = { source: { stash_box_endpoint: source.endpoint }, input: { scene_ids: currentBatch.map(function (scene) { return String(scene.id); }) } };
            return graphQLRequest(BATCH_SCRAPE_QUERY, variables).then(function (data) {
                var grouped = data.scrapeMultiScenes || [];
                currentBatch.forEach(function (scene, index) {
                    var results = grouped[index] || [];
                    results = results.slice().sort(function (a, b) { return Core.compareSceneCandidates(scene, a, b); });
                    state.batchMatches[String(scene.id)] = { results: results, candidateIndex: 0, source: source };
                    if (results[0]) initializeBatchChoices(scene, state.batchMatches[String(scene.id)], results[0]);
                });
            }).catch(function (error) {
                currentBatch.forEach(function (scene) { state.batchMatches[String(scene.id)] = { results: [], error: error.message, source: source }; });
            }).then(function () {
                offset += currentBatch.length;
                updateBatchProgress("Finding StashBox matches…", offset + " of " + scenes.length + " scenes" + (state.batchStop ? " · stopping after this batch" : ""), offset / scenes.length * 100);
                renderBatchScenes();
                return nextBatch();
            });
        }

        nextBatch().then(function () {
            var matched = scenes.filter(function (scene) { return state.batchMatches[String(scene.id)] && state.batchMatches[String(scene.id)].results && state.batchMatches[String(scene.id)].results.length; }).length;
            setStatus("Checked " + offset + " scenes; " + matched + " returned StashBox matches." + (state.batchStop ? " Stopped after the current batch." : ""));
            els.batchProgress.hidden = true;
        }).catch(function (error) { setError(error.message); }).finally(function () {
            state.batchLoading = false;
            state.batchStop = false;
            state.batchCanStop = false;
            updateBatchButtons();
            renderBatchScenes();
        });
    }

    function applyBatchScenes() {
        if (state.batchLoading) return;
        var scenes = batchSelectedScenes().filter(function (scene) {
            var match = state.batchMatches[String(scene.id)];
            return match && match.results && match.results.length && !state.batchApplied[String(scene.id)] && Object.keys(match.selectedFields || {}).some(function (key) { return match.selectedFields[key]; });
        });
        if (!scenes.length) return;
        var tagMode = els.batchTagMode.value;
        var markOrganized = els.batchOrganize.checked;
        var updated = 0;
        var skipped = 0;
        state.batchLoading = true;
        state.batchCanStop = false;
        updateBatchButtons();
        updateBatchProgress("Applying reviewed scene updates…", "0 of " + scenes.length + " scenes", 0);
        var index = 0;

        function applyNext() {
            if (index >= scenes.length) return Promise.resolve();
            var scene = scenes[index];
            var id = String(scene.id);
            var match = state.batchMatches[id];
            var candidate = selectedBatchCandidate(scene);
            index += 1;
            var selected = Object.keys(match.selectedFields || {}).filter(function (key) { return match.selectedFields[key]; });
            return graphQLRequest(BATCH_FRESH_SCENE_QUERY, { id: id }).then(function (data) {
                var fresh = data.findScene;
                if (!fresh) throw new Error("Scene no longer exists in Stash.");
                var before = {};
                var input = { id: id };
                var fieldMap = { title: "title", code: "code", details: "details", director: "director", date: "date", production_date: "production_date" };
                selected.forEach(function (key) {
                    if (fieldMap[key]) {
                        if (Core.canonical(scene[key]) !== Core.canonical(fresh[key])) throw new Error("The local " + key.replace(/_/g, " ") + " changed after comparison. Reload the queue and compare again.");
                        if (!Core.hasValue(candidate[key])) return;
                        input[key] = candidate[key];
                        before[key] = scene[key];
                    } else if (key === "urls") {
                        if (Core.canonical(scene.urls) !== Core.canonical(fresh.urls)) throw new Error("The local URLs changed after comparison. Reload the queue and compare again.");
                        var remoteUrls = Array.isArray(candidate.urls) ? candidate.urls : [];
                        var mergedUrls = (fresh.urls || []).concat(remoteUrls).filter(Boolean).filter(function (url, urlIndex, all) { return all.indexOf(url) === urlIndex; });
                        if (mergedUrls.length) { input.urls = mergedUrls; before.urls = fresh.urls || []; }
                    } else if (key === "studio_id") {
                        if (String((scene.studio && scene.studio.id) || "") !== String((fresh.studio && fresh.studio.id) || "")) throw new Error("The local studio changed after comparison. Reload the queue and compare again.");
                        if (candidate.studio && candidate.studio.stored_id) { input.studio_id = String(candidate.studio.stored_id); before.studio_id = (fresh.studio && fresh.studio.id) || null; }
                    } else if (key === "performer_ids") {
                        if (Core.canonical((scene.performers || []).map(function (item) { return item.id; })) !== Core.canonical((fresh.performers || []).map(function (item) { return item.id; }))) throw new Error("The local performers changed after comparison. Reload the queue and compare again.");
                        var remotePerformerIds = (candidate.performers || []).map(function (performer) { return performer.stored_id && String(performer.stored_id); }).filter(Boolean);
                        if (remotePerformerIds.length) { input.performer_ids = (fresh.performers || []).map(function (item) { return String(item.id); }).concat(remotePerformerIds).filter(function (item, i, all) { return all.indexOf(item) === i; }); before.performer_ids = (fresh.performers || []).map(function (item) { return item.id; }); }
                    } else if (key === "groups") {
                        var groupKey = function (entry) {
                            var sceneIndex = entry && entry.scene_index;
                            return String(entry && entry.group && entry.group.id || "") + ":" + (sceneIndex == null ? "" : String(sceneIndex));
                        };
                        if (Core.canonical((scene.groups || []).map(groupKey)) !== Core.canonical((fresh.groups || []).map(groupKey))) throw new Error("The local groups changed after comparison. Reload the queue and compare again.");
                        var currentGroupIDs = (fresh.groups || []).map(function (entry) { return entry.group && String(entry.group.id); }).filter(Boolean);
                        var remoteGroupIDs = (candidate.groups || []).map(function (group) { return group.stored_id && String(group.stored_id); }).filter(Boolean);
                        if (remoteGroupIDs.length) {
                            input.groups = (fresh.groups || []).filter(function (entry) { return entry.group && entry.group.id; }).map(function (entry) {
                                var groupInput = { group_id: String(entry.group.id) };
                                if (entry.scene_index !== null && entry.scene_index !== undefined) groupInput.scene_index = entry.scene_index;
                                return groupInput;
                            }).concat(remoteGroupIDs.filter(function (groupID, i, all) { return currentGroupIDs.indexOf(groupID) < 0 && all.indexOf(groupID) === i; }).map(function (groupID) { return { group_id: groupID }; }));
                            before.groups = fresh.groups || [];
                        }
                    } else if (key === "tag_ids") {
                        if (Core.canonical((scene.tags || []).map(function (item) { return item.id; })) !== Core.canonical((fresh.tags || []).map(function (item) { return item.id; }))) throw new Error("The local tags changed after comparison. Reload the queue and compare again.");
                        var remoteTagIds = (candidate.tags || []).map(function (tag) { return tag.stored_id && String(tag.stored_id); }).filter(Boolean);
                        if (remoteTagIds.length) {
                            var existingTagIds = tagMode === "merge" ? (fresh.tags || []).map(function (item) { return String(item.id); }) : [];
                            input.tag_ids = existingTagIds.concat(remoteTagIds).filter(function (item, i, all) { return all.indexOf(item) === i; });
                            before.tag_ids = (fresh.tags || []).map(function (item) { return item.id; });
                        }
                    } else if (key === "stash_ids") {
                        if (Core.canonicalStashIDs(scene.stash_ids) !== Core.canonicalStashIDs(fresh.stash_ids)) throw new Error("The local StashBox IDs changed after comparison. Reload the queue and compare again.");
                        if (candidate.remote_site_id && match.source && match.source.endpoint) {
                            input.stash_ids = (fresh.stash_ids || []).filter(function (stashID) { return stashEndpointKey(stashID.endpoint) !== stashEndpointKey(match.source.endpoint); }).map(function (stashID) { return { endpoint: stashID.endpoint, stash_id: stashID.stash_id, updated_at: stashID.updated_at }; }).concat([{ endpoint: match.source.endpoint, stash_id: candidate.remote_site_id, updated_at: new Date().toISOString() }]);
                            before.stash_ids = fresh.stash_ids || [];
                        }
                    }
                });
                if (markOrganized) {
                    input.organized = true;
                    before.organized = fresh.organized;
                }
                if (Object.keys(input).length <= 1) throw new Error("No selected fields contained a value that can be applied.");
                return graphQLRequest(queryForUpdate("scene"), { input: input }).then(function () {
                    updated += 1;
                    state.batchApplied[id] = { done: true };
                    var historyFields = Object.keys(input).filter(function (key) { return key !== "id"; });
                    var after = {};
                    historyFields.forEach(function (key) { after[key] = input[key]; });
                    state.history.unshift({ at: new Date().toISOString(), type: "scene", label: "Scene", entity: scene.title || "Untitled scene", entityId: id, sources: [match.source && match.source.name || "StashBox"], fields: historyFields, before: before, after: after });
                    state.history = state.history.slice(0, 30);
                    saveHistory();
                });
            }).catch(function (error) {
                skipped += 1;
                state.batchApplied[id] = { error: error.message };
            }).then(function () {
                updateBatchProgress("Applying reviewed scene updates…", index + " of " + scenes.length + " scenes", index / scenes.length * 100);
                renderBatchScenes();
                return applyNext();
            });
        }

        applyNext().then(function () {
            renderHistory();
            els.batchProgress.hidden = true;
            setStatus("Updated " + updated + " scene" + (updated === 1 ? "" : "s") + (skipped ? "; " + skipped + " skipped for review." : "."));
        }).catch(function (error) { setError(error.message); }).finally(function () {
            state.batchLoading = false;
            state.batchCanStop = false;
            updateBatchButtons();
            renderBatchScenes();
        });
    }

    function bindEvents() {
        byId("sbmr-workspaces").addEventListener("click", function (event) {
            var button = event.target.closest("[data-sbmr-workspace]");
            if (button) setWorkspace(button.dataset.sbmrWorkspace);
        });
        els.type.addEventListener("change", function () {
            state.type = els.type.value;
            state.local = null;
            state.matches = [];
            state.sourceResults = [];
            state.choices = Object.create(null);
            els.results.innerHTML = "";
            els.results.hidden = true;
            els.selected.hidden = true;
            els.review.hidden = true;
            setError("");
            setStatus("");
            updateButtons();
        });
        els.find.addEventListener("click", runSearch);
        els.search.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); runSearch(); } });
        els.results.addEventListener("click", function (event) {
            var button = event.target.closest("[data-local-index]");
            if (button) chooseLocal(Number(button.dataset.localIndex));
        });
        els.selected.addEventListener("click", function (event) {
            if (event.target.closest("#sbmr-clear-local")) {
                state.local = null;
                els.selected.hidden = true;
                els.search.focus();
                updateButtons();
            }
        });
        els.sources.addEventListener("change", function (event) {
            var input = event.target.closest("[data-source-index]");
            if (!input) return;
            var source = state.sources[Number(input.dataset.sourceIndex)];
            if (source) state.selectedSources[source.endpoint] = input.checked;
            var count = state.sources.filter(function (entry) { return state.selectedSources[entry.endpoint]; }).length;
            els.sourceCount.textContent = count + " of " + state.sources.length + " selected";
            updateButtons();
        });
        els.compare.addEventListener("click", compare);
        els.sourceResults.addEventListener("change", function (event) {
            var select = event.target.closest("[data-candidate-endpoint]");
            if (!select) return;
            var endpoint = select.dataset.candidateEndpoint;
            var index = Number(select.value);
            state.candidateIndex[endpoint] = index;
            Object.keys(state.choices).forEach(function (key) {
                if (state.choices[key].endpoint === endpoint) state.choices[key].candidateIndex = index;
            });
            renderComparison();
        });
        els.fieldList.addEventListener("click", function (event) {
            var button = event.target.closest("[data-field-key]");
            if (!button) return;
            var key = button.dataset.fieldKey;
            if (state.choices[key] && state.choices[key].endpoint === button.dataset.endpoint) delete state.choices[key];
            else {
                var result = state.sourceResults.filter(function (entry) { return entry.source.endpoint === button.dataset.endpoint; })[0];
                state.choices[key] = { endpoint: button.dataset.endpoint, candidateIndex: state.candidateIndex[button.dataset.endpoint] || 0 };
            }
            renderFieldList();
        });
        els.apply.addEventListener("click", applyChoices);
        els.batchLoad.addEventListener("click", loadBatchScenes);
        els.batchQuery.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); loadBatchScenes(); } });
        els.batchSelectAll.addEventListener("click", function () {
            state.batchScenes.forEach(function (scene) { state.batchSelected[String(scene.id)] = true; });
            renderBatchScenes();
        });
        els.batchSelectNone.addEventListener("click", function () {
            state.batchScenes.forEach(function (scene) { state.batchSelected[String(scene.id)] = false; });
            renderBatchScenes();
        });
        els.batchCompare.addEventListener("click", compareBatchScenes);
        els.batchStop.addEventListener("click", function () { if (state.batchCanStop) { state.batchStop = true; els.batchStop.disabled = true; } });
        els.batchApply.addEventListener("click", applyBatchScenes);
        els.batchResults.addEventListener("change", function (event) {
            var candidateSelect = event.target.closest("[data-batch-candidate]");
            if (candidateSelect) {
                var id = candidateSelect.dataset.batchCandidate;
                var match = state.batchMatches[id];
                if (!match) return;
                match.candidateIndex = Number(candidateSelect.value);
                match.selectedFields = null;
                var scene = state.batchScenes.filter(function (item) { return String(item.id) === id; })[0];
                if (scene && selectedBatchCandidate(scene)) initializeBatchChoices(scene, match, selectedBatchCandidate(scene));
                renderBatchScenes();
                return;
            }
            var sceneBox = event.target.closest("[data-batch-scene]");
            if (sceneBox) {
                state.batchSelected[sceneBox.dataset.batchScene] = sceneBox.checked;
                updateBatchButtons();
                return;
            }
            var fieldBox = event.target.closest("[data-batch-field]");
            if (fieldBox) {
                var fieldMatch = state.batchMatches[fieldBox.dataset.sceneId];
                if (fieldMatch) fieldMatch.selectedFields[fieldBox.dataset.batchField] = fieldBox.checked;
                updateBatchButtons();
            }
        });
        els.batchEmptyOnly.addEventListener("change", function () {
            Object.keys(state.batchMatches).forEach(function (id) {
                var match = state.batchMatches[id];
                if (match && match.results && match.results.length) {
                    match.selectedFields = null;
                    var scene = state.batchScenes.filter(function (item) { return String(item.id) === id; })[0];
                    if (scene) initializeBatchChoices(scene, match, selectedBatchCandidate(scene));
                }
            });
            renderBatchScenes();
        });
        els.batchSource.addEventListener("change", function () {
            state.batchMatches = Object.create(null);
            state.batchApplied = Object.create(null);
            renderBatchScenes();
            setStatus("Source changed. Find matches again to use the selected StashBox.");
        });
        els.refresh.addEventListener("click", function () {
            setError("");
            setBusy(true, "Refreshing configured StashBoxes…");
            loadSources().catch(function (error) { setError(error.message); }).finally(function () { setBusy(false, false); });
        });
        els.clearHistory.addEventListener("click", function () {
            state.history = [];
            saveHistory();
            renderHistory();
            setStatus("Local browser history cleared.");
        });
        window.addEventListener("storage", function (event) {
            if ([THEME_KEY, "stash.theme.tokens.v1", "mv.theme.accent", "mv.theme.accentTint", "mv.theme.accentRgb"].indexOf(event.key) >= 0) applyHostTheme();
        });
    }

    function cacheElements() {
        els.type = byId("sbmr-type"); els.search = byId("sbmr-search"); els.find = byId("sbmr-find");
        els.results = byId("sbmr-results"); els.selected = byId("sbmr-selected"); els.sources = byId("sbmr-sources");
        els.sourceCount = byId("sbmr-source-count"); els.compare = byId("sbmr-compare"); els.review = byId("sbmr-review");
        els.sourceResults = byId("sbmr-source-results"); els.fieldList = byId("sbmr-field-list");
        els.selectionNote = byId("sbmr-selection-note"); els.apply = byId("sbmr-apply"); els.error = byId("sbmr-error");
        els.status = byId("sbmr-status"); els.statusMessage = byId("sbmr-status-message"); els.refresh = byId("sbmr-refresh");
        els.history = byId("sbmr-history"); els.clearHistory = byId("sbmr-clear-history");
        els.batchSource = byId("sbmr-batch-source"); els.batchLoad = byId("sbmr-batch-load");
        els.batchMissing = byId("sbmr-batch-missing"); els.batchDays = byId("sbmr-batch-days");
        els.batchLimit = byId("sbmr-batch-limit"); els.batchUnorganized = byId("sbmr-batch-unorganized");
        els.batchQuery = byId("sbmr-batch-query"); els.batchEmptyOnly = byId("sbmr-batch-empty-only");
        els.batchOrganize = byId("sbmr-batch-organize"); els.batchTagMode = byId("sbmr-batch-tag-mode");
        els.batchCount = byId("sbmr-batch-count"); els.batchSelectAll = byId("sbmr-batch-select-all");
        els.batchSelectNone = byId("sbmr-batch-select-none"); els.batchCompare = byId("sbmr-batch-compare");
        els.batchStop = byId("sbmr-batch-stop"); els.batchApply = byId("sbmr-batch-apply");
        els.batchProgress = byId("sbmr-batch-progress"); els.batchProgressTitle = byId("sbmr-batch-progress-title");
        els.batchProgressDetail = byId("sbmr-batch-progress-detail"); els.batchProgressBar = byId("sbmr-batch-progress-bar");
        els.batchResults = byId("sbmr-batch-results");
    }

    function init() {
        cacheElements();
        applyHostTheme();
        bindEvents();
        setWorkspace("record");
        renderHistory();
        loadSources().catch(function (error) { setError(error.message); els.sources.innerHTML = '<p class="sbmr-muted">Could not load StashBox sources. Refresh to try again.</p>'; })
            .finally(function () { updateButtons(); });
    }

    init();
}());
