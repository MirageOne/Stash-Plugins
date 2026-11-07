import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../stash_metadata_sync.js"), "utf8");

function loadPatch(fetchImpl = async () => { throw new Error("Unexpected network request"); }) {
  let afterPatch;
  const React = {
    Fragment: Symbol.for("react.fragment"),
    isValidElement: (value) => value?.validReactElement === true,
    createElement: (type, props, ...children) => ({
      validReactElement: true,
      type,
      props: { ...props, children },
    }),
    useState: (initial) => [initial, () => {}],
  };
  const sandbox = {
    fetch: fetchImpl,
    window: {
      PluginApi: {
        React,
        patch: { after: (_component, callback) => { afterPatch = callback; } },
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  return { afterPatch, React };
}

test("PerformerDetailsPanel patch uses render result after React legacy context", () => {
  const { afterPatch, React } = loadPatch();
  const rendered = React.createElement("div", null, "details");
  const legacyContext = {};

  const result = afterPatch({ performer: { id: "27" } }, legacyContext, rendered);

  assert.equal(result.type, React.Fragment);
  assert.equal(result.props.children[0], rendered);
  assert.notEqual(result.props.children[0], legacyContext);
  const actions = result.props.children[1];
  assert.equal(actions.props.className, "stash-metadata-sync-actions");
  assert.equal(actions.props.children.length, 2);
  assert.equal(actions.props.children[1].type.name, "ChoosePerformerImageButton");
  assert.equal(actions.props.children[1].props.performerId, "27");

  const chooser = actions.props.children[1].type({ performerId: "27" });
  const chooseButton = chooser.props.children[0];
  assert.equal(chooseButton.props.children[0], "Choose image");
  assert.equal(typeof chooseButton.props.onClick, "function");
});

test("PerformerDetailsPanel patch leaves invalid render results untouched", () => {
  const { afterPatch } = loadPatch();
  const invalidResult = {};

  assert.equal(afterPatch({ performer: { id: "27" } }, {}, invalidResult), invalidResult);
});

test("image chooser requests candidates through Stash plugin operations", async () => {
  let request;
  const { afterPatch, React } = loadPatch(async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ data: { runPluginOperation: { output: { candidates: [] } } } }),
    };
  });
  const rendered = React.createElement("div", null, "details");
  const result = afterPatch({ performer: { id: "27" } }, rendered);
  const chooser = result.props.children[1].props.children[1].type({ performerId: "27" });
  const chooseButton = chooser.props.children[0];

  await chooseButton.props.onClick();

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "/graphql");
  assert.match(body.query, /runPluginOperation/);
  assert.equal(body.variables.plugin_id, "stash-metadata-sync");
  assert.deepEqual(body.variables.args, { mode: "list_performer_image_candidates", performer_id: "27" });
});
