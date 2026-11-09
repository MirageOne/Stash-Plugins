"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

function scene(id, overrides) {
    return Object.assign({
        id: String(id),
        title: "Scene " + id,
        rating100: 70,
        play_count: 0,
        studio: { id: "studio-1", name: "Studio One" },
        performers: [{ id: "performer-1", name: "Performer One" }],
        tags: [{ id: "tag-1", name: "Drama" }],
        files: [{ duration: 2400, height: 1080 }]
    }, overrides || {});
}

test("normalizes invalid and older profile data to safe account defaults", function () {
    const profile = Core.normalizeProfile({ version: 99, settings: { mode: "unknown", minimumRating: 200, duration: "giant" }, affinities: { tags: { broken: { weight: 200 } } } });
    assert.equal(profile.version, 1);
    assert.equal(profile.settings.mode, "for-you");
    assert.equal(profile.settings.minimumRating, 100);
    assert.equal(profile.settings.duration, "any");
    assert.equal(profile.affinities.tags.broken.weight, 12);
});

test("preserves selected tag, performer, and studio identifiers", function () {
    const profile = Core.normalizeProfile({ settings: { tag: "Drama", tagId: 12, performerId: 34, studioId: "56" } });
    assert.equal(profile.settings.tagId, "12");
    assert.equal(profile.settings.performerId, "34");
    assert.equal(profile.settings.studioId, "56");
});

test("like and finished feedback raise scene and related entity scores", function () {
    const target = scene("liked");
    let profile = Core.defaultProfile();
    const coldScore = Core.scoreScene(target, profile, { mode: "for-you" }, 0);
    profile = Core.applyFeedback(profile, target, "like", Date.now());
    assert.ok(Core.scoreScene(target, profile, { mode: "for-you" }, 0) > coldScore);
    profile = Core.applyFeedback(profile, scene("completed", { tags: [{ id: "tag-1", name: "Drama" }] }), "finished", Date.now());
    assert.ok(profile.affinities.tags["tag-1"].weight > 0);
    assert.equal(profile.events.length, 2);
});

test("less-like-this feedback learns avoidance and remains bounded", function () {
    let profile = Core.defaultProfile();
    for (let index = 0; index < 20; index += 1) { profile = Core.applyFeedback(profile, scene("s" + index), "less", Date.now()); }
    assert.equal(profile.affinities.tags["tag-1"].weight, -12);
    assert.equal(Core.topAffinities(profile, 1)[0].weight, -12);
    assert.equal(profile.events.length, 20);
});

test("filters apply play history, rating, runtime, and relationship criteria", function () {
    const scenes = [
        scene("match"),
        scene("watched", { play_count: 2 }),
        scene("low", { rating100: 30 }),
        scene("long", { files: [{ duration: 5000, height: 720 }] }),
        scene("other", { tags: [{ id: "tag-2", name: "Comedy" }] })
    ];
    const profile = Core.defaultProfile();
    assert.deepEqual(Core.filterScenes(scenes, profile, { unplayedOnly: true, minimumRating: 60, duration: "medium", tag: "dram", performer: "performer one", studio: "studio one" }).map(function (item) { return item.id; }), ["match"]);
    assert.deepEqual(Core.filterScenes(scenes, profile, { unplayedOnly: false, duration: "long" }).map(function (item) { return item.id; }), ["long"]);
});

test("relationship menu filters match selected IDs rather than similarly named entities", function () {
    const exact = scene("exact", {
        tags: [{ id: "tag-2", name: "Drama" }],
        performers: [{ id: "performer-2", name: "Performer One" }],
        studio: { id: "studio-2", name: "Studio One" }
    });
    const similarlyNamed = scene("similar", {
        tags: [{ id: "tag-20", name: "Drama" }],
        performers: [{ id: "performer-20", name: "Performer One" }],
        studio: { id: "studio-20", name: "Studio One" }
    });
    const results = Core.filterScenes([exact, similarlyNamed], Core.defaultProfile(), {
        tag: "Drama", tagId: "tag-2",
        performer: "Performer One", performerId: "performer-2",
        studio: "Studio One", studioId: "studio-2"
    });
    assert.deepEqual(results.map(function (item) { return item.id; }), ["exact"]);
});

test("recent skips and completions leave the current discovery pool", function () {
    let profile = Core.defaultProfile();
    const skipped = scene("skip-me");
    const finished = scene("finished");
    profile = Core.applyFeedback(profile, skipped, "skip", Date.now());
    profile = Core.applyFeedback(profile, finished, "finished", Date.now());
    const results = Core.filterScenes([skipped, finished, scene("new")], profile, { unplayedOnly: false });
    assert.deepEqual(results.map(function (item) { return item.id; }), ["new"]);
});

test("reset clears learning while preserving queue settings", function () {
    let profile = Core.applyFeedback(Core.defaultProfile(), scene("liked"), "like", Date.now());
    profile.settings.mode = "random";
    profile.settings.tag = "Drama";
    const reset = Core.resetLearning(profile);
    assert.equal(reset.settings.mode, "random");
    assert.equal(reset.settings.tag, "Drama");
    assert.equal(reset.events.length, 0);
    assert.deepEqual(reset.affinities, { tags: {}, performers: {}, studios: {} });
});

test("only the latest 100 learning events are retained", function () {
    let profile = Core.defaultProfile();
    for (let index = 0; index < 110; index += 1) { profile = Core.applyFeedback(profile, scene("s" + index), "skip", Date.now()); }
    assert.equal(profile.events.length, 100);
});
