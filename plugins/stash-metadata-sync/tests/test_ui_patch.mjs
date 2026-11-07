import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../stash_metadata_sync.js"), "utf8");

function loadPatch() {
  let afterPatch;
  const React = {
    Fragment: Symbol.for("react.fragment"),
    isValidElement: (value) => value?.validReactElement === true,
    createElement: (type, props, ...children) => ({
      validReactElement: true,
      type,
      props: { ...props, children },
    }),
  };
  const sandbox = {
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
});

test("PerformerDetailsPanel patch leaves invalid render results untouched", () => {
  const { afterPatch } = loadPatch();
  const invalidResult = {};

  assert.equal(afterPatch({ performer: { id: "27" } }, {}, invalidResult), invalidResult);
});
