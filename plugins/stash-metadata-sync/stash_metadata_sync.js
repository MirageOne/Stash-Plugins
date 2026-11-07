(() => {
  const pluginId = "stash-metadata-sync";
  const api = window.PluginApi;
  if (!api?.React || !api?.patch?.after) {
    console.error("[Stash Metadata Sync] Stash 0.32 PluginApi is unavailable.");
    return;
  }

  const React = api.React;

  function SyncPerformerButton({ performerId }) {
    const [state, setState] = React.useState("idle");
    const [jobId, setJobId] = React.useState(null);
    const resetTimer = React.useRef(null);

    React.useEffect(() => () => window.clearTimeout(resetTimer.current), []);

    React.useEffect(() => {
      if (!jobId) return undefined;
      let cancelled = false;
      let attempts = 0;
      let pollTimer = null;

      async function checkJob() {
        attempts += 1;
        try {
          const response = await fetch("/graphql", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              query: `query StashMetadataSyncJob($input: FindJobInput!) {
                findJob(input: $input) { status error }
              }`,
              variables: { input: { id: String(jobId) } },
            }),
          });
          const payload = await response.json();
          if (!response.ok || payload.errors?.length) throw new Error("Job status could not be read");
          const job = payload.data?.findJob;
          if (cancelled || !job) return;
          if (job.status === "RUNNING" || job.status === "STOPPING") {
            setState("running");
          } else if (job.status === "FINISHED") {
            setState("completed");
            setJobId(null);
            resetTimer.current = window.setTimeout(() => setState("idle"), 4000);
          } else if (job.status === "FAILED" || job.status === "CANCELLED") {
            setState("failed");
            setJobId(null);
            resetTimer.current = window.setTimeout(() => setState("idle"), 5000);
          } else if (attempts < 120) {
            pollTimer = window.setTimeout(checkJob, 1200);
          } else {
            setState("idle");
            setJobId(null);
          }
        } catch (error) {
          console.error("[Stash Metadata Sync] Could not read task status", error);
          if (!cancelled && attempts < 5) pollTimer = window.setTimeout(checkJob, 1500);
          else if (!cancelled) {
            setState("idle");
            setJobId(null);
          }
        }
      }

      checkJob();
      return () => {
        cancelled = true;
        window.clearTimeout(pollTimer);
      };
    }, [jobId]);

    async function sync() {
      if (state === "queued" || state === "running") return;
      window.clearTimeout(resetTimer.current);
      setState("queued");
      try {
        const response = await fetch("/graphql", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            query: `mutation QueuePerformerSyncTask($plugin_id: ID!, $args_map: Map) {
              runPluginTask(plugin_id: $plugin_id, description: "Sync performer metadata", args_map: $args_map)
            }`,
            variables: {
              plugin_id: pluginId,
              args_map: { mode: "update_single_performer", performer_id: String(performerId) },
            },
          }),
        });
        const payload = await response.json();
        if (!response.ok || payload.errors?.length) {
          throw new Error(payload.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`);
        }
        const newJobId = payload.data?.runPluginTask;
        if (!newJobId) throw new Error("Stash did not return a task ID");
        setJobId(newJobId);
        setState("queued");
      } catch (error) {
        console.error("[Stash Metadata Sync] Could not queue performer task", error);
        setState("failed");
        window.setTimeout(() => setState("idle"), 5000);
      }
    }

    const label = state === "queued" ? "Sync queued" : state === "running" ? "Syncing…" :
      state === "completed" ? "Sync complete" : state === "failed" ? "Sync failed" : "Sync metadata";
    return React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary",
        onClick: sync,
        disabled: state === "queued" || state === "running",
        title: "Update this performer from configured StashBox sources",
      },
      label,
    );
  }

  async function runImageOperation(args) {
    const response = await fetch("/graphql", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `mutation StashMetadataSyncImageOperation($plugin_id: ID!, $args: Map) {
          runPluginOperation(plugin_id: $plugin_id, args: $args)
        }`,
        variables: { plugin_id: pluginId, args },
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.errors?.length) {
      throw new Error(payload.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`);
    }
    let result = payload.data?.runPluginOperation;
    if (result && typeof result === "object" && Object.hasOwn(result, "result")) result = result.result;
    if (typeof result === "string") {
      try { result = JSON.parse(result); } catch (_error) { /* Keep non-JSON operation results unchanged. */ }
    }
    if (result?.error) throw new Error(result.error);
    return result?.output ?? result;
  }

  function ChoosePerformerImageButton({ performerId }) {
    const [open, setOpen] = React.useState(false);
    const [phase, setPhase] = React.useState("idle");
    const [data, setData] = React.useState(null);
    const [selected, setSelected] = React.useState(null);
    const [message, setMessage] = React.useState("");

    async function showPicker() {
      setOpen(true);
      setPhase("loading");
      setMessage("");
      setData(null);
      setSelected(null);
      try {
        const result = await runImageOperation({
          mode: "list_performer_image_candidates",
          performer_id: String(performerId),
        });
        if (!result || !Array.isArray(result.candidates)) throw new Error("Image candidates could not be read");
        setData(result);
        setSelected(result.candidates[0]?.id || null);
        setPhase("ready");
      } catch (error) {
        console.error("[Stash Metadata Sync] Could not load performer image candidates", error);
        setMessage(error.message || "Could not load image candidates.");
        setPhase("failed");
      }
    }

    async function applySelection() {
      if (!selected || phase === "applying") return;
      setPhase("applying");
      setMessage("");
      try {
        const result = await runImageOperation({
          mode: "apply_performer_image_candidate",
          performer_id: String(performerId),
          candidate_id: selected,
        });
        setMessage(`Saved ${result.width}×${result.height} image from ${result.source_name}.`);
        setPhase("saved");
      } catch (error) {
        console.error("[Stash Metadata Sync] Could not apply performer image", error);
        setMessage(error.message || "The selected image could not be applied.");
        setPhase("ready");
      }
    }

    const candidates = data?.candidates || [];
    const selectedCandidate = candidates.find((candidate) => candidate.id === selected);
    const cards = candidates.map((candidate) => {
      const disabled = phase === "applying" || phase === "saved";
      const badges = [];
      if (candidate.is_best) badges.push("Best available");
      if (candidate.better_than_current === false) badges.push("Smaller than current");
      if (!candidate.meets_quality_minimum) badges.push("Below automatic minimum");
      return React.createElement(
        "button",
        {
          key: candidate.id,
          type: "button",
          className: `btn btn-secondary stash-metadata-image-choice${selected === candidate.id ? " active" : ""}`,
          onClick: () => setSelected(candidate.id),
          disabled,
          "aria-pressed": selected === candidate.id,
          style: {
            display: "block", width: "100%", height: "100%", textAlign: "left",
            opacity: candidate.meets_quality_minimum ? 1 : 0.55,
            border: selected === candidate.id ? "2px solid var(--bs-primary)" : undefined,
          },
        },
        React.createElement("img", {
          src: candidate.url,
          alt: `${candidate.source_name} performer image, ${candidate.width} by ${candidate.height}`,
          loading: "lazy",
          style: { display: "block", width: "100%", height: "220px", objectFit: "contain", marginBottom: "0.75rem" },
        }),
        React.createElement("strong", { style: { display: "block" } }, candidate.source_name),
        React.createElement("span", { style: { display: "block" } }, `${candidate.width}×${candidate.height} · ${candidate.megapixels} MP`),
        badges.length ? React.createElement("small", { style: { display: "block", marginTop: "0.35rem" } }, badges.join(" · ")) : null,
      );
    });

    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", {
        type: "button",
        className: "btn btn-secondary",
        onClick: showPicker,
        title: "Preview configured StashBox performer images and choose which image to use",
      }, "Choose image"),
      open ? React.createElement(
        "div",
        {
          className: "modal show d-block stash-metadata-image-picker",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Choose performer image",
          style: { position: "fixed", inset: 0, zIndex: 2000, overflowY: "auto", background: "rgba(0,0,0,.65)" },
        },
        React.createElement(
          "div",
          { className: "modal-dialog modal-xl modal-dialog-scrollable", role: "document",
            style: { width: "calc(100% - 1rem)", maxWidth: "1100px", margin: "1rem auto" } },
          React.createElement(
            "div",
            { className: "modal-content", style: { maxHeight: "calc(100vh - 2rem)" } },
            React.createElement(
              "div",
              { className: "modal-header" },
              React.createElement("h5", { className: "modal-title" },
                phase === "saved" ? "Image saved" : `Choose image for ${data?.performer_name || "performer"}`),
              React.createElement("button", {
                type: "button", className: "btn btn-secondary", onClick: () => setOpen(false),
                "aria-label": "Close image picker",
              }, "Close"),
            ),
            React.createElement(
              "div",
              { className: "modal-body", style: { overflowY: "auto" } },
              phase === "saved" ? React.createElement(
                "div",
                { className: "stash-metadata-image-saved", style: {
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem",
                    maxWidth: "560px", margin: "0 auto", textAlign: "center",
                  } },
                selectedCandidate ? React.createElement("img", {
                  src: selectedCandidate.url,
                  alt: `Saved performer image from ${selectedCandidate.source_name}`,
                  onError: (event) => { event.currentTarget.style.display = "none"; },
                  style: {
                    display: "block", width: "100%", maxWidth: "360px", height: "min(42vh, 380px)",
                    objectFit: "contain", borderRadius: "0.5rem",
                  },
                }) : null,
                React.createElement("div", { className: "alert alert-success", role: "status",
                  style: { width: "100%", margin: 0 } }, message),
                React.createElement("p", { style: { margin: 0 } }, "Reload this page to see the updated performer image."),
              ) : React.createElement(
                React.Fragment,
                null,
                data?.source_errors?.length ? React.createElement(
                  "div", { className: "alert alert-warning", role: "status" },
                  `Some image sources could not be checked: ${data.source_errors.join("; ")}`,
                ) : null,
                data?.current_image_present ? React.createElement(
                  "div",
                  { className: "stash-metadata-current-image", style: {
                      display: "flex", alignItems: "center", gap: "1rem", padding: "0.75rem",
                      marginBottom: "1rem", border: "1px solid var(--bs-border-color, #666)", borderRadius: "0.5rem",
                    } },
                  React.createElement("img", {
                    src: data.current_image_url,
                    alt: `Current image for ${data.performer_name || "performer"}`,
                    onError: (event) => { event.currentTarget.style.display = "none"; },
                    style: { width: "96px", height: "96px", objectFit: "contain", flex: "0 0 auto" },
                  }),
                  React.createElement("div", null,
                    React.createElement("strong", { style: { display: "block" } }, "Current image"),
                    React.createElement("span", null, data.current_image
                      ? `${data.current_image.width}×${data.current_image.height}`
                      : "Resolution could not be measured"),
                  ),
                ) : React.createElement("div", { className: "alert alert-secondary" }, "This performer has no current image."),
                React.createElement("p", { style: { marginBottom: "0.75rem" } },
                  "Choose one of the configured StashBox images below. The largest option is selected by default."),
                selectedCandidate?.better_than_current === false ? React.createElement(
                  "div", { className: "alert alert-warning", role: "status" },
                  "The selected image has fewer pixels than the current image. Choosing it will reduce the saved resolution.",
                ) : null,
                selectedCandidate && !selectedCandidate.meets_quality_minimum ? React.createElement(
                  "div", { className: "alert alert-warning", role: "status" },
                  "This image is below the automatic sync minimum. You can still choose it here manually.",
                ) : null,
                phase === "loading" ? React.createElement("p", null, "Loading images from configured StashBoxes…") : null,
                phase === "failed" || (phase === "ready" && message)
                  ? React.createElement("div", { className: "alert alert-danger", role: "alert" }, message) : null,
                phase === "ready" && !candidates.length
                  ? React.createElement("div", { className: "alert alert-secondary" }, "No images with known dimensions were found in the configured StashBoxes.")
                  : null,
                phase === "ready" && candidates.length
                  ? React.createElement("div", { className: "stash-metadata-image-grid", style: {
                      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))",
                      gap: "0.75rem",
                    } }, ...cards)
                  : null,
              ),
            ),
            React.createElement(
              "div",
              { className: "modal-footer" },
              phase === "saved" ? React.createElement("button", {
                type: "button", className: "btn btn-primary", onClick: () => setOpen(false),
              }, "Done") : React.createElement("button", {
                type: "button", className: "btn btn-primary", onClick: applySelection,
                disabled: !selected || phase !== "ready",
              }, phase === "applying" ? "Saving…" : "Use selected image"),
            ),
          ),
        ),
      ) : null,
    );
  }

  // Stash 0.32 may pass legacy context as a second render argument. The
  // rendered component is always the final argument supplied to `after`.
  api.patch.after("PerformerDetailsPanel", (...args) => {
    const props = args[0];
    const rendered = args[args.length - 1];
    const performerId = props?.performer?.id;
    if (!performerId || !React.isValidElement(rendered)) return rendered;
    return React.createElement(
      React.Fragment,
      null,
      rendered,
      React.createElement(
        "div",
        { className: "stash-metadata-sync-actions", style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" } },
        React.createElement(SyncPerformerButton, { performerId }),
        React.createElement(ChoosePerformerImageButton, { performerId }),
      ),
    );
  });
})();
