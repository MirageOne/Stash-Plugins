"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

test("all supported entity types expose a StashBox scraper and update mapping", () => {
    for (const type of ["performer", "scene", "studio", "tag"]) {
        const definition = core.getEntity(type);
        assert.ok(definition, type);
        assert.ok(definition.scrape);
        assert.ok(definition.update);
        assert.ok(definition.fields.length > 0);
    }
    assert.equal(core.getEntity("group"), null);
});

test("performer scraper values convert to Stash input field names and types", () => {
    const input = core.buildUpdate("performer", "17", {
        name: "Updated Name",
        height_cm: "172 cm",
        alias_list: "One, Two; Three",
        penis_length: "7.5",
        gender: "non-binary",
        circumcised: "uncut",
        weight: "59 kg"
    });
    assert.deepEqual(input, {
        id: "17", name: "Updated Name", height_cm: 172,
        alias_list: ["One", "Two", "Three"], penis_length: 7.5,
        gender: "NON_BINARY", circumcised: "UNCUT", weight: 59
    });
});

test("unsafe or unsupported numeric and enum values are omitted", () => {
    assert.equal(core.normalizeRemote("performer", ["height", "Height", "height_cm"], "5'8\""), null);
    assert.equal(core.normalizeRemote("performer", ["penis_length", "Penis length"], "about 8 inches"), null);
    assert.equal(core.normalizeRemote("performer", ["gender", "Gender"], "unknown custom value"), null);
    assert.deepEqual(core.buildUpdate("performer", 8, { height_cm: "not numeric", gender: "other" }), { id: "8" });
});

test("StashBox values only update explicitly supplied fields", () => {
    const input = core.buildUpdate("scene", 21, { title: "A new title", date: "2026-06-01" });
    assert.deepEqual(input, { id: "21", title: "A new title", date: "2026-06-01" });
    assert.equal(Object.hasOwn(input, "details"), false);
    assert.equal(Object.hasOwn(input, "studio_id"), false);
});

test("tag and studio alias strings map to Stash alias arrays", () => {
    assert.deepEqual(core.buildUpdate("tag", 3, { aliases: "Alias A, Alias B" }), { id: "3", aliases: ["Alias A", "Alias B"] });
    assert.deepEqual(core.buildUpdate("studio", 4, { aliases: "Studio One; Studio Two" }), { id: "4", aliases: ["Studio One", "Studio Two"] });
});

test("list comparison ignores case and order in alias and URL arrays", () => {
    assert.equal(core.canonical(["a", "B"]), core.canonical(["b", "A"]));
    assert.notEqual(core.canonical("Local value"), core.canonical("Remote value"));
});

test("Stash Tagger pHash distance uses the same Hamming threshold", () => {
    assert.equal(core.hammingDistance("0000", "0001"), 1);
    const local = { files: [{ duration: 240, fingerprints: [{ type: "phash", value: "0000" }, { type: "oshash", value: "abcd" }] }] };
    const remote = { fingerprints: [
        { algorithm: "PHASH", hash: "0001", duration: 240, submissions: 1 },
        { algorithm: "OSHASH", hash: "abcd", duration: 240, submissions: 4 },
        { algorithm: "PHASH", hash: "ffff", duration: 244, submissions: 1 }
    ] };
    const score = core.analyzeSceneMatch(local, remote);
    assert.equal(score.phashMatches, 1);
    assert.equal(score.bestPhashDistance, 1);
    assert.equal(score.oshashMatches, 1);
    assert.equal(score.oshashSubmissions, 4);
    assert.equal(score.durationMatches, 3);
});

test("scene candidates follow Stash 0.32 Tagger pHash and duration ordering", () => {
    const local = { files: [{ duration: 300, fingerprints: [{ type: "phash", value: "0000" }] }] };
    const onePerfectPhash = { title: "one perfect pHash", fingerprints: [{ algorithm: "PHASH", hash: "0000", duration: 305 }] };
    const moreButLowerRatio = { title: "more pHashes, lower ratio", fingerprints: [
        { algorithm: "PHASH", hash: "0000", duration: 305 },
        { algorithm: "PHASH", hash: "0000", duration: 310 },
        { algorithm: "PHASH", hash: "ffff", duration: 315 }
    ] };
    assert.ok(core.compareSceneCandidates(local, onePerfectPhash, moreButLowerRatio) < 0);

    const phashWinner = { title: "pHash", fingerprints: [{ algorithm: "PHASH", hash: "0000", duration: 305 }] };
    const durationWinner = { title: "duration", fingerprints: [{ algorithm: "PHASH", hash: "ffff", duration: 300 }] };
    assert.ok(core.compareSceneCandidates(local, phashWinner, durationWinner) < 0);
    const closer = { title: "closer", fingerprints: [{ algorithm: "OSHASH", hash: "x", duration: 301 }] };
    const farther = { title: "farther", fingerprints: [{ algorithm: "OSHASH", hash: "x", duration: 304 }] };
    assert.ok(core.compareSceneCandidates(local, closer, farther) < 0);
    assert.ok(core.compareSceneCandidates(local, { fingerprints: [] }, closer) > 0);
});

test("StashID conflict comparison ignores timestamps and normalizes endpoint slashes", () => {
    assert.equal(
        core.canonicalStashIDs([{ endpoint: "https://stashdb.org/", stash_id: "ABC", updated_at: "2026-01-01" }]),
        core.canonicalStashIDs([{ endpoint: "https://stashdb.org", stash_id: "abc", updated_at: "2026-02-01" }])
    );
    assert.notEqual(core.canonicalStashIDs([{ endpoint: "https://stashdb.org", stash_id: "abc" }]), core.canonicalStashIDs([]));
});

test("source-specific StashIDs are merged by endpoint without replacing other sources", () => {
    const existing = [
        { endpoint: "https://stashdb.org/", stash_id: "old-stashdb", updated_at: "2026-01-01" },
        { endpoint: "https://theporndb.net/graphql", stash_id: "keep-tpdb", updated_at: "2026-01-02" }
    ];
    const result = core.mergeSourceStashIDs(existing, [
        { endpoint: "https://stashdb.org", stash_id: "new-stashdb" },
        { endpoint: "https://example.org/graphql", stash_id: "example-id" }
    ], "2026-11-08T15:00:00.000Z");
    assert.deepEqual(result, [
        { endpoint: "https://theporndb.net/graphql", stash_id: "keep-tpdb", updated_at: "2026-01-02" },
        { endpoint: "https://stashdb.org", stash_id: "new-stashdb", updated_at: "2026-11-08T15:00:00.000Z" },
        { endpoint: "https://example.org/graphql", stash_id: "example-id", updated_at: "2026-11-08T15:00:00.000Z" }
    ]);
});

test("scene queue filters can combine unorganized, missing metadata, and recent dates", () => {
    const now = new Date("2026-11-08T12:00:00.000Z");
    assert.deepEqual(core.buildSceneFilters({ unorganized: true, missing: "tags", days: 7 }, now), {
        organized: false,
        is_missing: "tags",
        created_at: { value: "2026-11-01T12:00:00.000Z", modifier: "GREATER_THAN" }
    });
    assert.deepEqual(core.buildSceneFilters({ unorganized: false, missing: "all", days: 0 }, now), {});
    assert.deepEqual(core.buildSceneFilters({ missing: "phash" }, now), { is_missing: "phash" });
});
