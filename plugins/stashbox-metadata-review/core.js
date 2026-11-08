(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.StashBoxReviewCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    var ENTITY = {
        performer: {
            label: "Performer", plural: "performers", localFind: "findPerformers", list: "performers", one: "findPerformer",
            fields: [
                ["name", "Name"], ["disambiguation", "Disambiguation"], ["gender", "Gender"], ["urls", "URLs"],
                ["birthdate", "Birth date"], ["ethnicity", "Ethnicity"], ["country", "Country"], ["eye_color", "Eye color"],
                ["height", "Height", "height_cm"], ["measurements", "Measurements"], ["fake_tits", "Breast type"],
                ["penis_length", "Penis length"], ["circumcised", "Circumcision"], ["career_start", "Career start"],
                ["career_end", "Career end"], ["tattoos", "Tattoos"], ["piercings", "Piercings"],
                ["aliases", "Aliases", "alias_list"], ["details", "Details"], ["death_date", "Death date"],
                ["hair_color", "Hair color"], ["weight", "Weight"]
            ],
            search: "id name disambiguation gender urls birthdate ethnicity country eye_color height_cm measurements fake_tits penis_length circumcised career_start career_end tattoos piercings alias_list details death_date hair_color weight",
            scrape: "scrapeSinglePerformer", scrapeInput: "ScrapeSinglePerformerInput", scrapeResult: "ScrapedPerformer",
            update: "performerUpdate", updateInput: "PerformerUpdateInput", nameField: "name"
        },
        scene: {
            label: "Scene", plural: "scenes", localFind: "findScenes", list: "scenes", one: "findScene",
            fields: [["title", "Title"], ["code", "Code"], ["details", "Details"], ["director", "Director"], ["urls", "URLs"], ["date", "Date"], ["production_date", "Production date"]],
            search: "id title code details director urls date production_date",
            scrape: "scrapeSingleScene", scrapeInput: "ScrapeSingleSceneInput", scrapeResult: "ScrapedScene",
            update: "sceneUpdate", updateInput: "SceneUpdateInput", nameField: "title"
        },
        studio: {
            label: "Studio", plural: "studios", localFind: "findStudios", list: "studios", one: "findStudio",
            fields: [["name", "Name"], ["urls", "URLs"], ["aliases", "Aliases"], ["details", "Details"]],
            search: "id name urls aliases details",
            scrape: "scrapeSingleStudio", scrapeInput: "ScrapeSingleStudioInput", scrapeResult: "ScrapedStudio",
            update: "studioUpdate", updateInput: "StudioUpdateInput", nameField: "name"
        },
        tag: {
            label: "Tag", plural: "tags", localFind: "findTags", list: "tags", one: "findTag",
            fields: [["name", "Name"], ["description", "Description"], ["alias_list", "Aliases", "aliases"]],
            search: "id name description aliases",
            scrape: "scrapeSingleTag", scrapeInput: "ScrapeSingleTagInput", scrapeResult: "ScrapedTag",
            update: "tagUpdate", updateInput: "TagUpdateInput", nameField: "name"
        }
    };

    var GENDERS = ["MALE", "FEMALE", "TRANSGENDER_MALE", "TRANSGENDER_FEMALE", "INTERSEX", "NON_BINARY"];
    var CIRCUMCISED = ["CUT", "UNCUT"];

    function getEntity(type) { return ENTITY[type] || null; }
    function fieldKey(field) { return field[2] || field[0]; }

    function text(value) {
        if (value === undefined || value === null) return null;
        var result = String(value).trim();
        return result ? result : null;
    }

    function aliases(value) {
        if (Array.isArray(value)) return value.map(text).filter(Boolean);
        var result = text(value);
        if (!result) return null;
        return result.split(/[,;\n]/).map(function (part) { return part.trim(); }).filter(Boolean);
    }

    function integer(value) {
        if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
        var normalized = String(value == null ? "" : value).trim();
        if (!/^-?\d+(?:\s*(?:cm|kg))?$/i.test(normalized)) return null;
        var match = normalized.match(/-?\d+/);
        return match ? Number(match[0]) : null;
    }

    function enumValue(value, allowed) {
        var normalized = text(value);
        if (!normalized) return null;
        normalized = normalized.toUpperCase().replace(/[\s-]+/g, "_");
        if (normalized === "NONBINARY") normalized = "NON_BINARY";
        return allowed.indexOf(normalized) >= 0 ? normalized : null;
    }

    function normalizeRemote(type, field, value) {
        if (value === undefined || value === null) return null;
        var key = field[0];
        if (type === "performer" && key === "aliases") return aliases(value);
        if (type === "studio" && key === "aliases") return aliases(value);
        if (type === "tag" && key === "alias_list") return aliases(value);
        if (type === "performer" && (key === "height" || key === "weight")) return integer(value);
        if (type === "performer" && key === "penis_length") {
            var normalizedNumber = String(value).trim();
            if (!/^-?\d+(?:\.\d+)?$/.test(normalizedNumber)) return null;
            var number = Number(normalizedNumber);
            return Number.isFinite(number) ? number : null;
        }
        if (type === "performer" && key === "gender") return enumValue(value, GENDERS);
        if (type === "performer" && key === "circumcised") return enumValue(value, CIRCUMCISED);
        if (key === "urls") return Array.isArray(value) ? value.map(text).filter(Boolean) : (text(value) ? [text(value)] : null);
        if (Array.isArray(value)) return value.map(text).filter(Boolean);
        return text(value);
    }

    function normalizeLocal(type, field, value) {
        if (value === undefined || value === null) return null;
        if ((type === "performer" && field[0] === "aliases") || (type === "studio" && field[0] === "aliases") || (type === "tag" && field[0] === "alias_list")) return aliases(value);
        if (type === "performer" && field[0] === "height") return integer(value);
        if (type === "performer" && field[0] === "weight") return integer(value);
        if (type === "performer" && field[0] === "penis_length") {
            var number = Number(value);
            return Number.isFinite(number) ? number : null;
        }
        if (type === "performer" && field[0] === "gender") return enumValue(value, GENDERS);
        if (type === "performer" && field[0] === "circumcised") return enumValue(value, CIRCUMCISED);
        if (field[0] === "urls") return Array.isArray(value) ? value.map(text).filter(Boolean) : (text(value) ? [text(value)] : null);
        if (Array.isArray(value)) return value.map(text).filter(Boolean);
        return text(value);
    }

    function updateValue(type, field, remoteValue) {
        return normalizeRemote(type, field, remoteValue);
    }

    function canonical(value) {
        if (Array.isArray(value)) return JSON.stringify(value.map(function (item) { return String(item).trim().toLocaleLowerCase(); }).sort());
        if (typeof value === "string") return value.trim().toLocaleLowerCase();
        return JSON.stringify(value);
    }

    function hasValue(value) {
        return value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
    }

    function buildUpdate(type, id, remoteValues) {
        var config = getEntity(type);
        if (!config) throw new Error("Unsupported record type: " + type);
        var input = { id: String(id) };
        Object.keys(remoteValues || {}).forEach(function (key) {
            var field = config.fields.filter(function (entry) { return fieldKey(entry) === key; })[0];
            if (!field) return;
            var value = updateValue(type, field, remoteValues[key]);
            if (hasValue(value)) input[fieldKey(field)] = value;
        });
        return input;
    }

    function hammingDistance(left, right) {
        var a = String(left || "").toLowerCase();
        var b = String(right || "").toLowerCase();
        if (a.length !== b.length || !/^[a-f0-9]+$/.test(a) || !/^[a-f0-9]+$/.test(b)) return 32;
        var distance = 0;
        for (var i = 0; i < a.length; i += 1) {
            var bits = parseInt(a[i], 16) ^ parseInt(b[i], 16);
            while (bits) { distance += bits & 1; bits >>= 1; }
        }
        return distance;
    }

    function analyzeSceneMatch(localScene, remoteScene) {
        var localFingerprints = [];
        (localScene && localScene.files || []).forEach(function (file) {
            (file.fingerprints || []).forEach(function (fingerprint) {
                localFingerprints.push({ type: String(fingerprint.type || "").toUpperCase(), value: fingerprint.value });
            });
        });
        var fingerprints = remoteScene && remoteScene.fingerprints || [];
        var remotePhashes = fingerprints.filter(function (fingerprint) { return String(fingerprint.algorithm || "").toUpperCase() === "PHASH"; });
        var remoteOshashes = fingerprints.filter(function (fingerprint) { return String(fingerprint.algorithm || "").toUpperCase() === "OSHASH"; });
        var localPhashes = localFingerprints.filter(function (fingerprint) { return fingerprint.type === "PHASH"; });
        var localOshashes = localFingerprints.filter(function (fingerprint) { return fingerprint.type === "OSHASH"; });
        var phashDistances = remotePhashes.map(function (remote) {
            return localPhashes.reduce(function (min, local) { return Math.min(min, hammingDistance(remote.hash, local.value)); }, 9999);
        });
        var phashMatches = phashDistances.filter(function (distance) { return distance <= 8; });
        var oshashMatches = remoteOshashes.filter(function (remote) {
            return localOshashes.some(function (local) { return String(local.value).toLowerCase() === String(remote.hash).toLowerCase(); });
        });
        var localDurations = (localScene && localScene.files || []).map(function (file) { return Number(file.duration); }).filter(function (duration) { return Number.isFinite(duration) && duration > 0; });
        var durationDiffs = fingerprints.map(function (fingerprint) {
            var duration = Number(fingerprint.duration);
            if (!Number.isFinite(duration) || !localDurations.length) return 9999;
            return localDurations.reduce(function (min, local) { return Math.min(min, Math.abs(duration - local)); }, 9999);
        });
        var durationMatches = durationDiffs.filter(function (diff) { return diff <= 5; });
        return {
            fingerprintCount: fingerprints.length,
            phashCount: remotePhashes.length,
            phashMatches: phashMatches.length,
            phashRatio: remotePhashes.length ? phashMatches.length / remotePhashes.length : 0,
            bestPhashDistance: phashDistances.length ? Math.min.apply(Math, phashDistances) : null,
            oshashMatches: oshashMatches.length,
            oshashSubmissions: oshashMatches.reduce(function (sum, fingerprint) { return sum + (Number(fingerprint.submissions) || 0); }, 0),
            durationMatches: durationMatches.length,
            durationRatio: durationDiffs.length ? durationMatches.length / durationDiffs.length : 0,
            bestDurationDifference: durationDiffs.length ? Math.min.apply(Math, durationDiffs) : 9999
        };
    }

    function compareSceneCandidates(localScene, left, right) {
        var leftHasFingerprints = !!(left && left.fingerprints && left.fingerprints.length);
        var rightHasFingerprints = !!(right && right.fingerprints && right.fingerprints.length);
        if (leftHasFingerprints !== rightHasFingerprints) return rightHasFingerprints ? 1 : -1;
        var a = analyzeSceneMatch(localScene, left);
        var b = analyzeSceneMatch(localScene, right);
        // Follow Stash 0.32 Tagger's ranking. If neither result has a pHash
        // match, continue to duration scoring instead of treating them as tied.
        if (!!a.phashMatches !== !!b.phashMatches) return b.phashMatches - a.phashMatches;
        if (a.phashMatches && b.phashMatches && a.phashRatio !== b.phashRatio) return b.phashRatio - a.phashRatio;
        if (a.durationMatches !== b.durationMatches) return b.durationMatches - a.durationMatches;
        if (a.durationRatio !== b.durationRatio) return b.durationRatio - a.durationRatio;
        return a.bestDurationDifference - b.bestDurationDifference;
    }

    function canonicalStashIDs(value) {
        return JSON.stringify((Array.isArray(value) ? value : []).map(function (item) {
            var endpoint = String(item && item.endpoint || "").trim().replace(/\/+$/, "").toLocaleLowerCase();
            var stashID = String(item && item.stash_id || "").trim().toLocaleLowerCase();
            return endpoint + "|" + stashID;
        }).sort());
    }

    function buildSceneFilters(options, now) {
        var opts = options || {};
        var sceneFilter = {};
        if (opts.unorganized) sceneFilter.organized = false;
        if (opts.missing && opts.missing !== "all") sceneFilter.is_missing = opts.missing;
        var days = Number(opts.days) || 0;
        if (days > 0) {
            var reference = now instanceof Date ? now.getTime() : (Number(now) || Date.now());
            sceneFilter.created_at = {
                value: new Date(reference - days * 86400000).toISOString(),
                modifier: "GREATER_THAN"
            };
        }
        return sceneFilter;
    }

    return {
        entities: ENTITY,
        getEntity: getEntity,
        fieldKey: fieldKey,
        normalizeRemote: normalizeRemote,
        normalizeLocal: normalizeLocal,
        updateValue: updateValue,
        buildUpdate: buildUpdate,
        hammingDistance: hammingDistance,
        analyzeSceneMatch: analyzeSceneMatch,
        compareSceneCandidates: compareSceneCandidates,
        buildSceneFilters: buildSceneFilters,
        canonicalStashIDs: canonicalStashIDs,
        canonical: canonical,
        hasValue: hasValue
    };
}));
