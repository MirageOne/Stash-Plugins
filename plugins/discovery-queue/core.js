(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) { module.exports = api; }
    if (root) { root.StashDiscoveryQueueCore = api; }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    var MAX_EVENTS = 100;
    var MAX_SCENE_FEEDBACK = 300;
    var MAX_WEIGHT = 12;
    var DEFAULT_SETTINGS = {
        mode: "for-you",
        unplayedOnly: true,
        minimumRating: 0,
        duration: "any",
        title: "",
        tag: "",
        performer: "",
        studio: ""
    };
    var ACTION_DELTAS = {
        like: { tags: 2.5, performers: 1.25, studios: 1.5 },
        finished: { tags: 2, performers: 1, studios: 1 },
        skip: { tags: -1.4, performers: -0.6, studios: -0.8 },
        less: { tags: -2.5, performers: -1.4, studios: -1.5 }
    };

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, Number(value) || 0));
    }

    function emptyProfile() {
        return {
            version: 1,
            settings: Object.assign({}, DEFAULT_SETTINGS),
            affinities: { tags: {}, performers: {}, studios: {} },
            sceneFeedback: {},
            events: []
        };
    }

    function normalizeAffinityMap(input) {
        var result = {};
        if (!input || typeof input !== "object" || Array.isArray(input)) { return result; }
        Object.keys(input).slice(-1000).forEach(function (key) {
            var item = input[key];
            if (!item || typeof item !== "object") { return; }
            var weight = clamp(item.weight, -MAX_WEIGHT, MAX_WEIGHT);
            if (!weight) { return; }
            result[String(key)] = {
                name: String(item.name || key).slice(0, 160),
                weight: weight,
                updatedAt: String(item.updatedAt || "")
            };
        });
        return result;
    }

    function normalizeProfile(input) {
        var defaults = emptyProfile();
        if (!input || typeof input !== "object" || Array.isArray(input)) { return defaults; }
        var sourceSettings = input.settings && typeof input.settings === "object" ? input.settings : {};
        var settings = Object.assign({}, DEFAULT_SETTINGS);
        if (["for-you", "random", "rating", "recent"].indexOf(sourceSettings.mode) !== -1) { settings.mode = sourceSettings.mode; }
        settings.unplayedOnly = sourceSettings.unplayedOnly !== false;
        settings.minimumRating = clamp(sourceSettings.minimumRating, 0, 100);
        if (["any", "short", "medium", "long"].indexOf(sourceSettings.duration) !== -1) { settings.duration = sourceSettings.duration; }
        ["title", "tag", "performer", "studio"].forEach(function (key) { settings[key] = String(sourceSettings[key] || "").slice(0, 120); });

        var affinities = input.affinities && typeof input.affinities === "object" ? input.affinities : {};
        var sceneFeedback = {};
        if (input.sceneFeedback && typeof input.sceneFeedback === "object" && !Array.isArray(input.sceneFeedback)) {
            Object.keys(input.sceneFeedback).slice(-MAX_SCENE_FEEDBACK).forEach(function (sceneID) {
                var item = input.sceneFeedback[sceneID];
                if (!item || typeof item !== "object" || !["like", "finished", "skip", "less"].includes(item.action)) { return; }
                sceneFeedback[String(sceneID)] = {
                    action: item.action,
                    title: String(item.title || "").slice(0, 240),
                    at: String(item.at || "")
                };
            });
        }
        var events = Array.isArray(input.events) ? input.events.slice(-MAX_EVENTS).map(function (event) {
            return {
                sceneID: String(event && event.sceneID || ""),
                title: String(event && event.title || "").slice(0, 240),
                action: String(event && event.action || ""),
                at: String(event && event.at || "")
            };
        }) : [];
        return {
            version: 1,
            settings: settings,
            affinities: {
                tags: normalizeAffinityMap(affinities.tags),
                performers: normalizeAffinityMap(affinities.performers),
                studios: normalizeAffinityMap(affinities.studios)
            },
            sceneFeedback: sceneFeedback,
            events: events
        };
    }

    function featureEntries(items) {
        var seen = Object.create(null);
        return (Array.isArray(items) ? items : []).map(function (item) {
            if (!item) { return null; }
            var name = String(item.name || "").trim();
            var id = item.id === undefined || item.id === null ? "" : String(item.id);
            var key = id || (name ? "name:" + name.toLocaleLowerCase() : "");
            if (!key || seen[key]) { return null; }
            seen[key] = true;
            return { key: key, name: name || id };
        }).filter(Boolean);
    }

    function updateAffinity(map, feature, delta, timestamp) {
        var previous = map[feature.key];
        var weight = clamp((previous ? previous.weight * 0.92 : 0) + delta, -MAX_WEIGHT, MAX_WEIGHT);
        if (Math.abs(weight) < 0.15) { delete map[feature.key]; return; }
        map[feature.key] = { name: feature.name, weight: weight, updatedAt: timestamp };
    }

    function applyFeedback(input, scene, action, now) {
        if (!scene || !scene.id || !ACTION_DELTAS[action]) { throw new Error("A scene and a supported feedback action are required."); }
        var profile = normalizeProfile(input);
        var deltas = ACTION_DELTAS[action];
        var timestamp = new Date(now || Date.now()).toISOString();
        var features = {
            tags: featureEntries(scene.tags),
            performers: featureEntries(scene.performers),
            studios: scene.studio ? featureEntries([scene.studio]) : []
        };
        Object.keys(features).forEach(function (type) {
            features[type].forEach(function (feature) { updateAffinity(profile.affinities[type], feature, deltas[type], timestamp); });
        });
        var sceneID = String(scene.id);
        profile.sceneFeedback[sceneID] = { action: action, title: String(scene.title || "").slice(0, 240), at: timestamp };
        profile.events.push({ sceneID: sceneID, title: String(scene.title || "").slice(0, 240), action: action, at: timestamp });
        return normalizeProfile(profile);
    }

    function affinityScore(entries, map, weight) {
        if (!entries.length) { return 0; }
        var scores = entries.map(function (entry) { return map[entry.key] ? map[entry.key].weight : 0; });
        var total = scores.reduce(function (sum, value) { return sum + value; }, 0);
        return total / Math.sqrt(entries.length) * weight;
    }

    function scoreScene(scene, input, options, randomValue) {
        var profile = normalizeProfile(input);
        var settings = Object.assign({}, profile.settings, options || {});
        var random = typeof randomValue === "number" ? randomValue : Math.random();
        if (settings.mode === "random") { return random; }
        var rating = clamp(scene && scene.rating100, 0, 100);
        if (settings.mode === "rating") { return rating + random * 0.001; }
        if (settings.mode === "recent") {
            var date = Date.parse(scene && (scene.created_at || scene.date) || "") || 0;
            return date + random;
        }
        var affinities = profile.affinities;
        var score = rating * 0.035;
        score += affinityScore(featureEntries(scene && scene.tags), affinities.tags, 1.5);
        score += affinityScore(featureEntries(scene && scene.performers), affinities.performers, 0.8);
        score += affinityScore(scene && scene.studio ? featureEntries([scene.studio]) : [], affinities.studios, 1.25);
        var feedback = profile.sceneFeedback[String(scene && scene.id || "")];
        if (feedback) {
            if (feedback.action === "like") { score += 3; }
            else if (feedback.action === "finished") { score -= 8; }
            else if (feedback.action === "skip") { score -= 15; }
            else if (feedback.action === "less") { score -= 20; }
        }
        return score + random * 0.35;
    }

    function normalizedText(value) {
        return String(value || "").normalize ? String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim() : String(value || "").toLocaleLowerCase().trim();
    }

    function matchesText(items, query) {
        var needle = normalizedText(query);
        if (!needle) { return true; }
        return (Array.isArray(items) ? items : []).some(function (item) { return normalizedText(item && item.name).indexOf(needle) !== -1; });
    }

    function sceneDuration(scene) {
        return (Array.isArray(scene && scene.files) ? scene.files : []).reduce(function (maximum, file) {
            return Math.max(maximum, Number(file && file.duration) || 0);
        }, 0);
    }

    function filterScenes(scenes, input, options) {
        var profile = normalizeProfile(input);
        var filters = Object.assign({}, profile.settings, options || {});
        var query = normalizedText(filters.title);
        var tagQuery = normalizedText(filters.tag);
        var performerQuery = normalizedText(filters.performer);
        var studioQuery = normalizedText(filters.studio);
        var minimumRating = clamp(filters.minimumRating, 0, 100);
        return (Array.isArray(scenes) ? scenes : []).filter(function (scene) {
            if (!scene || !scene.id) { return false; }
            if (filters.unplayedOnly && Number(scene.play_count || 0) > 0) { return false; }
            if (Number(scene.rating100 || 0) < minimumRating) { return false; }
            if (query && normalizedText(scene.title).indexOf(query) === -1) { return false; }
            if (tagQuery && !matchesText(scene.tags, tagQuery)) { return false; }
            if (performerQuery && !matchesText(scene.performers, performerQuery)) { return false; }
            if (studioQuery && normalizedText(scene.studio && scene.studio.name).indexOf(studioQuery) === -1) { return false; }
            var duration = sceneDuration(scene);
            if (filters.duration === "short" && !(duration > 0 && duration < 1800)) { return false; }
            if (filters.duration === "medium" && !(duration >= 1800 && duration <= 3600)) { return false; }
            if (filters.duration === "long" && !(duration > 3600)) { return false; }
            var prior = profile.sceneFeedback[String(scene.id)];
            if (prior && prior.at && Date.now() - Date.parse(prior.at) < 30 * 86400000 && ["finished", "skip", "less"].indexOf(prior.action) !== -1) { return false; }
            return true;
        });
    }

    function rankScenes(scenes, input, options, randomFn) {
        var profile = normalizeProfile(input);
        var settings = Object.assign({}, profile.settings, options || {});
        var random = typeof randomFn === "function" ? randomFn : Math.random;
        return (Array.isArray(scenes) ? scenes : []).map(function (scene) {
            return { scene: scene, score: scoreScene(scene, profile, settings, random()) };
        }).sort(function (a, b) {
            if (settings.mode === "random") { return b.score - a.score; }
            return b.score - a.score || String(a.scene.title || "").localeCompare(String(b.scene.title || ""));
        }).map(function (entry) { return entry.scene; });
    }

    function topAffinities(profile, limit) {
        var data = normalizeProfile(profile).affinities;
        var result = [];
        Object.keys(data).forEach(function (type) {
            Object.keys(data[type]).forEach(function (key) {
                result.push({ type: type, id: key, name: data[type][key].name, weight: data[type][key].weight });
            });
        });
        return result.sort(function (a, b) { return Math.abs(b.weight) - Math.abs(a.weight); }).slice(0, Number(limit) || 8);
    }

    function resetLearning(input) {
        var profile = normalizeProfile(input);
        profile.affinities = { tags: {}, performers: {}, studios: {} };
        profile.sceneFeedback = {};
        profile.events = [];
        return profile;
    }

    return {
        defaultProfile: emptyProfile,
        normalizeProfile: normalizeProfile,
        applyFeedback: applyFeedback,
        scoreScene: scoreScene,
        filterScenes: filterScenes,
        rankScenes: rankScenes,
        sceneDuration: sceneDuration,
        topAffinities: topAffinities,
        resetLearning: resetLearning
    };
}));
