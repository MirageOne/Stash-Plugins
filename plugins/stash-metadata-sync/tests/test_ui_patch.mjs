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
  let hookIndex = 0;
  const hookState = [];
  const React = {
    Fragment: Symbol.for("react.fragment"),
    isValidElement: (value) => value?.validReactElement === true,
    createElement: (type, props, ...children) => ({
      validReactElement: true,
      type,
      props: { ...props, children },
    }),
    useState: (initial) => {
      const index = hookIndex++;
      if (index >= hookState.length) hookState[index] = initial;
      return [hookState[index], (value) => {
        hookState[index] = typeof value === "function" ? value(hookState[index]) : value;
      }];
    },
    beginRender: () => { hookIndex = 0; },
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
  return { afterPatch, React, render: (component, props) => { React.beginRender(); return component(props); } };
}

function allElements(root) {
  if (Array.isArray(root)) return root.flatMap(allElements);
  if (!root || typeof root !== "object" || !root.props) return [];
  return [root, ...allElements(root.props.children)];
}

function textContent(root) {
  if (Array.isArray(root)) return root.map(textContent).join("");
  if (typeof root === "string" || typeof root === "number") return String(root);
  return root?.props ? textContent(root.props.children) : "";
}

test("PerformerDetailsPanel patch uses render result after React legacy context", () => {
  const { afterPatch, React, render } = loadPatch();
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

  const chooser = render(actions.props.children[1].type, { performerId: "27" });
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
  const { afterPatch, React, render } = loadPatch(async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ data: { runPluginOperation: { output: { candidates: [] } } } }),
    };
  });
  const rendered = React.createElement("div", null, "details");
  const result = afterPatch({ performer: { id: "27" } }, rendered);
  const chooser = render(result.props.children[1].props.children[1].type, { performerId: "27" });
  const chooseButton = chooser.props.children[0];

  await chooseButton.props.onClick();

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "/graphql");
  assert.match(body.query, /runPluginOperation/);
  assert.equal(body.variables.plugin_id, "stash-metadata-sync");
  assert.deepEqual(body.variables.args, { mode: "list_performer_image_candidates", performer_id: "27" });
});

test("saved image view replaces the chooser and stale current-image preview", async () => {
  const candidate = {
    id: "best-image", url: "https://images.test/best.jpg", source_name: "StashDB",
    width: 800, height: 1280, megapixels: 1.02, is_best: true,
    meets_quality_minimum: true, better_than_current: true,
  };
  const { afterPatch, React, render } = loadPatch(async (_url, options) => {
    const args = JSON.parse(options.body).variables.args;
    const output = args.mode === "list_performer_image_candidates" ? {
      performer_name: "Aaliyah Love", current_image_present: true, current_image_url: "/performer/27",
      candidates: [candidate], source_errors: [],
    } : { width: 800, height: 1280, source_name: "StashDB" };
    return { ok: true, json: async () => ({ data: { runPluginOperation: { output } } }) };
  });
  const rendered = React.createElement("div", null, "details");
  const patched = afterPatch({ performer: { id: "27" } }, rendered);
  const chooserComponent = patched.props.children[1].props.children[1].type;
  let chooser = render(chooserComponent, { performerId: "27" });
  await chooser.props.children[0].props.onClick();

  chooser = render(chooserComponent, { performerId: "27" });
  const applyButton = allElements(chooser).find((element) =>
    element.type === "button" && textContent(element) === "Use selected image");
  assert.ok(applyButton);
  await applyButton.props.onClick();

  chooser = render(chooserComponent, { performerId: "27" });
  const elements = allElements(chooser);
  const savedView = elements.find((element) => element.props.className === "stash-metadata-image-saved");
  assert.ok(savedView);
  assert.ok(elements.some((element) => element.type === "h5" && textContent(element) === "Image saved"));
  const savedImage = elements.find((element) => element.type === "img" && element.props.src === candidate.url);
  assert.ok(savedImage);
  assert.equal(savedView.props.style.display, "flex");
  assert.equal(savedView.props.style.flexWrap, "wrap");
  assert.equal(savedImage.props.style.width, "112px");
  assert.equal(savedImage.props.style.height, "148px");
  assert.ok(!elements.some((element) => element.props.className === "stash-metadata-current-image"));
  assert.ok(!elements.some((element) => textContent(element).includes("Choose one of the configured StashBox images")));
  assert.ok(elements.some((element) => element.type === "button" && textContent(element) === "Done"));
});
