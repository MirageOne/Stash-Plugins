(function () {
  "use strict";

  var PLUGIN_ID = "cinema-catalog";
  var STORAGE_KEY = "stash.cinema-catalog.accent.v1";
  var SERVER_SETTING_KEY = "stashCinemaCatalog";
  var ACCENTS = [
    { id: "blue", name: "Blue", color: "#479ef5" },
    { id: "teal", name: "Teal", color: "#00b7c3" },
    { id: "green", name: "Green", color: "#6bb700" },
    { id: "yellow", name: "Yellow", color: "#fce100" },
    { id: "orange", name: "Orange", color: "#f7630c" },
    { id: "red", name: "Red", color: "#d13438" },
    { id: "pink", name: "Pink", color: "#e3008c" },
    { id: "purple", name: "Purple", color: "#8764b8" }
  ];
  var accentChangedDuringBoot = false;

  function findAccent(value) {
    var i;
    for (i = 0; i < ACCENTS.length; i += 1) {
      if (ACCENTS[i].id === value) return ACCENTS[i];
    }
    return ACCENTS[0];
  }

  function readLocalAccent() {
    try {
      return findAccent(localStorage.getItem(STORAGE_KEY)).id;
    } catch (e) {
      return "blue";
    }
  }

  function applyAccent(value) {
    var accent = findAccent(value);
    var root = document.documentElement;
    if (!root) return accent.id;

    root.classList.add("stash-cinema-catalog");
    root.setAttribute("data-stash-cinema-accent", accent.id);
    if (document.body) document.body.classList.add("stash-cinema-catalog");
    return accent.id;
  }

  function storeLocalAccent(value) {
    var accent = findAccent(value).id;
    try {
      localStorage.setItem(STORAGE_KEY, accent);
    } catch (e) {
      // The accent still applies for this session if storage is unavailable.
    }
    applyAccent(accent);
    return accent;
  }

  function gqlRequest(query, variables, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/graphql", true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
      var result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch (e) {
        callback(e);
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || (result.errors && !result.data)) {
        callback(new Error("Stash settings request failed"));
        return;
      }
      callback(null, result);
    };
    xhr.onerror = function () {
      callback(new Error("Stash settings request failed"));
    };
    xhr.send(JSON.stringify({ query: query, variables: variables || {} }));
  }

  function saveServerAccent(value) {
    var accent = findAccent(value).id;
    gqlRequest(
      'mutation SaveCinemaCatalogAccent($value: Any) { configureUISetting(key: "' + SERVER_SETTING_KEY + '", value: $value) }',
      { value: { accent: accent } },
      function () {
        // Local storage remains the instant fallback if server sync is unavailable.
      }
    );
  }

  function chooseAccent(value) {
    accentChangedDuringBoot = true;
    var accent = storeLocalAccent(value);
    saveServerAccent(accent);
    return accent;
  }

  function loadServerAccent() {
    var localAtBoot = readLocalAccent();
    gqlRequest("query CinemaCatalogSettings { configuration { ui } }", null, function (err, result) {
      if (err) return;

      var ui = result && result.data && result.data.configuration && result.data.configuration.ui;
      if (typeof ui === "string") {
        try { ui = JSON.parse(ui); } catch (e) { ui = null; }
      }
      var setting = ui && ui[SERVER_SETTING_KEY];
      if (setting && setting.accent && !accentChangedDuringBoot) {
        storeLocalAccent(setting.accent);
      } else if (localAtBoot !== "blue" && !setting) {
        saveServerAccent(localAtBoot);
      }
    });
  }

  function createSettingsPanel(React) {
    return function CinemaCatalogSettingsPanel() {
      var state = React.useState(readLocalAccent());
      var selected = state[0];
      var setSelected = state[1];
      var savedState = React.useState(false);
      var saved = savedState[0];
      var setSaved = savedState[1];

      function select(accent) {
        var next = chooseAccent(accent);
        setSelected(next);
        setSaved(true);
        window.setTimeout(function () { setSaved(false); }, 1600);
      }

      var swatches = ACCENTS.map(function (accent) {
        var active = selected === accent.id;
        return React.createElement(
          "button",
          {
            key: accent.id,
            type: "button",
            className: "cinema-accent-option" + (active ? " is-active" : ""),
            "aria-pressed": active ? "true" : "false",
            "aria-label": accent.name + " accent",
            title: accent.name,
            onClick: function () { select(accent.id); }
          },
          React.createElement("span", {
            className: "cinema-accent-swatch",
            style: { backgroundColor: accent.color },
            "aria-hidden": "true"
          }),
          React.createElement("span", { className: "cinema-accent-name" }, accent.name),
          active ? React.createElement("span", { className: "cinema-accent-check", "aria-hidden": "true" }, "✓") : null
        );
      });

      return React.createElement(
        "section",
        { className: "plugin-settings cinema-catalog-settings" },
        React.createElement(
          "div",
          { className: "cinema-settings-heading" },
          React.createElement("h3", null, "Accent color"),
          React.createElement("p", null, "Choose a Fluent primary color for selected items, playback progress, and focus states.")
        ),
        React.createElement("div", { className: "cinema-accent-options", role: "group", "aria-label": "Accent color" }, swatches),
        React.createElement(
          "div",
          { className: "cinema-accent-preview" },
          React.createElement("span", { className: "cinema-accent-preview-selection" }, "Scenes"),
          React.createElement("span", { className: "cinema-accent-preview-track" }, React.createElement("span", null)),
          React.createElement("span", { className: "cinema-accent-status", role: "status" }, saved ? "Saved" : "Applies instantly")
        )
      );
    };
  }

  function registerSettingsPatch() {
    var api = window.PluginApi;
    if (!api || !api.patch || !api.React || !api.patch.instead) {
      window.setTimeout(registerSettingsPatch, 100);
      return;
    }
    if (window.__stashCinemaCatalogSettingsPatched) return;
    window.__stashCinemaCatalogSettingsPatched = true;

    var React = api.React;
    var SettingsPanel = createSettingsPanel(React);
    api.patch.instead("PluginSettings", function () {
      var args = Array.prototype.slice.call(arguments);
      var next = args.pop();
      var props = args[0];
      if (!props || props.pluginID !== PLUGIN_ID) {
        return next.apply(null, args);
      }
      return React.createElement(SettingsPanel);
    });
  }

  applyAccent(readLocalAccent());
  loadServerAccent();
  registerSettingsPatch();
}());
