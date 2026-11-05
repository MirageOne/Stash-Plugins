(() => {
  const pluginId = "performer-site-sync";
  const api = window.PluginApi;
  if (!api?.React || !api?.patch?.after) {
    console.error("[Performer Site Sync] Stash 0.32 PluginApi is unavailable.");
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
              query: `query PerformerSiteSyncJob($input: FindJobInput!) {
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
          console.error("[Performer Site Sync] Could not read task status", error);
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
            query: `mutation SyncPerformerSite($plugin_id: ID!, $args_map: Map) {
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
        console.error("[Performer Site Sync] Could not queue performer sync", error);
        setState("failed");
        window.setTimeout(() => setState("idle"), 5000);
      }
    }

    const label = state === "queued" ? "Sync queued" : state === "running" ? "Syncing…" :
      state === "completed" ? "Sync complete" : state === "failed" ? "Sync failed" : "Sync metadata";
    return React.createElement(
      "div",
      { className: "performer-site-sync-action", style: { marginTop: "0.5rem" } },
      React.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-secondary",
          onClick: sync,
          disabled: state === "queued" || state === "running",
          title: "Update this performer from configured StashBox sources",
        },
        label,
      ),
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
      React.createElement(SyncPerformerButton, { performerId }),
    );
  });
})();
