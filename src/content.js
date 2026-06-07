(() => {
  const STATE = {
    idle: {
      label: "Ready to sync",
      title: "Ready to sync"
    },
    syncing: {
      label: "Syncing…",
      title: "Syncing submission…"
    },
    synced: {
      label: "Saved ✓",
      title: "Saved ✓"
    },
    error: {
      label: "Couldn't save",
      title: "Couldn't save — click for details"
    }
  };

  const STAGE_LABEL = {
    "submit-seen": "Submitting…",
    "submission-id-seen": "Checking results…",
    "result-polling": "Checking results…",
    "result-poll-error": "Checking results…",
    "check-complete": "Reading verdict…",
    "pushing": "Saving to GitHub…"
  };

  let stageLabel = null;

  let currentState = "idle";
  let panelOpen = false;
  let stateTimer = null;
  let root = null;
  let button = null;
  let panel = null;
  let lastError = "";
  let lastDiagnostic = "";
  let recentSyncs = [];
  let lastFailure = null;
  let pendingSubmission = null;
  let settings = null;
  let repo = null;
  let isConnected = null;
  let isPaused = false;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "LEETGIT_PAGE_DIAGNOSTIC") {
      if (isPaused) return;
      lastDiagnostic = formatDiagnostic(event.data.stage, event.data.detail);
      stageLabel = STAGE_LABEL[event.data.stage] || stageLabel;
      if (event.data.stage === "submit-seen" || event.data.stage === "submission-id-seen") {
        setState("syncing", lastDiagnostic);
      }
      renderPanel();
      return;
    }
    if (event.data?.type !== "LEETGIT_PAGE_SUBMISSION_CAPTURED") return;

    const payload = event.data.payload;
    handleCapturedSubmission(payload);
  });

  async function handleCapturedSubmission(payload) {
    if (isPaused) return;
    const cfg = await chrome.runtime.sendMessage({ type: "LEETGIT_GET_CONFIG" }).then((response) => response.config).catch(() => null);
    settings = cfg?.settings || settings;
    repo = cfg?.repo || repo;
    if (isPaused) return;
    if (settings?.commitMessageMode === "prompt") {
      const [codeHash, notesHash] = await Promise.all([sha256(payload.code), sha256(payload.notes || "")]);
      const { isDuplicate } = await chrome.runtime.sendMessage({
        type: "LEETGIT_QUICK_DUPLICATE_CHECK",
        titleSlug: payload.titleSlug,
        status: payload.status,
        codeHash,
        notesHash
      }).catch(() => ({ isDuplicate: false }));
      if (isDuplicate) {
        submitCapturedSubmission(payload);
        return;
      }
      pendingSubmission = payload;
      stageLabel = "Waiting for your message";
      setState("syncing", `Commit message needed for ${payload.titleSlug}`);
      panelOpen = true;
      panel.hidden = false;
      renderPanel();
      return;
    }
    submitCapturedSubmission(payload);
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function submitCapturedSubmission(payload) {
    pendingSubmission = null;
    stageLabel = STAGE_LABEL["submit-seen"];
    setState("syncing", `Submitting ${payload.titleSlug}…`);
    chrome.runtime.sendMessage({
      type: "LEETGIT_SUBMISSION_CAPTURED",
      payload
    }).then((response) => {
      if (!response?.ok) {
        lastError = response?.error || "Couldn't save.";
        stageLabel = null;
        setState("error", "Couldn't save — click for details");
        renderPanel();
        return;
      }
      if (response.result?.skipped) {
        stageLabel = null;
        const skipTitle = response.result.reason === "duplicate"
          ? "Ready to sync — commit skipped (same code & notes)"
          : `Ready to sync — skipped (${response.result.reason})`;
        setState("idle", skipTitle);
        hydrateState();
        return;
      }
      stageLabel = null;
      setState("synced", "Saved ✓");
      scheduleIdle();
      hydrateState();
    }).catch((error) => {
      lastError = error.message || "Couldn't save.";
      stageLabel = null;
      setState("error", "Couldn't save — click for details");
      renderPanel();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "LEETGIT_SYNC_STARTED") {
      stageLabel = STAGE_LABEL["pushing"];
      setState("syncing", `Saving ${message.title || "submission"} to GitHub…`);
      renderPanel();
      return;
    }
    if (message?.type === "LEETGIT_SYNC_COMPLETE") {
      recentSyncs = message.recentSyncs || recentSyncs;
      lastFailure = null;
      lastDiagnostic = "";
      stageLabel = null;
      setState("synced", `Saved ✓ ${message.title} (${message.language}, ${message.status})`);
      scheduleIdle();
      renderPanel();
      return;
    }
    if (message?.type === "LEETGIT_SYNC_SKIPPED") {
      recentSyncs = message.recentSyncs || recentSyncs;
      lastDiagnostic = "";
      stageLabel = null;
      const skipTitle = message.reason === "duplicate"
        ? "Ready to sync — commit skipped (same code & notes)"
        : message.reason === "paused"
          ? "Paused — submission not synced"
          : `Ready to sync — skipped (${message.reason})`;
      setState("idle", skipTitle);
      renderPanel();
      return;
    }
    if (message?.type === "LEETGIT_SYNC_ERROR") {
      lastError = message.error || "Unknown error";
      lastFailure = message.failure || null;
      lastDiagnostic = "";
      stageLabel = null;
      setState("error", "Couldn't save — click for details");
      renderPanel();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      const newSettings = changes.settings.newValue;
      if (newSettings) {
        settings = newSettings;
        const wasPaused = isPaused;
        isPaused = Boolean(newSettings.paused);
        if (isPaused && !wasPaused && pendingSubmission) {
          pendingSubmission = null;
        }
        if (root) root.dataset.paused = isPaused ? "true" : "false";
      }
    }
    if (changes.repo) {
      const newRepo = changes.repo.newValue;
      if (newRepo) repo = newRepo;
    }
    if (changes.settings || changes.repo) renderPanel();
  });

  init();

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      mount();
    }
  }

  function mount() {
    injectStyles();
    root = document.createElement("div");
    root.id = "leetgit-root";

    button = document.createElement("button");
    button.id = "leetgit-button";
    button.type = "button";
    button.setAttribute("aria-label", "Open LeetGit panel");
    button.innerHTML = iconSvg();
    button.addEventListener("click", togglePanel);

    panel = document.createElement("div");
    panel.id = "leetgit-panel";
    panel.hidden = true;

    root.append(button, panel);
    document.documentElement.appendChild(root);
    root.classList.add("leetgit-fixed");
    setState("idle");
    hydrateState();
    document.addEventListener("click", (event) => {
      if (panelOpen && root && !root.contains(event.target)) {
        panelOpen = false;
        panel.hidden = true;
        lastDiagnostic = "";
      }
    });
  }

  async function hydrateState() {
    const [stateResponse, configResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: "LEETGIT_GET_STATE" }).catch(() => null),
      chrome.runtime.sendMessage({ type: "LEETGIT_GET_CONFIG" }).catch(() => null)
    ]);
    if (stateResponse?.ok) {
      recentSyncs = stateResponse.recentSyncs || [];
      lastFailure = stateResponse.lastFailure || null;
      lastError = lastFailure?.error || "";
      if (lastFailure) { stageLabel = null; setState("error", "Couldn't save — click for details"); }
    }
    if (configResponse?.ok) {
      const cfg = configResponse.config;
      settings = cfg?.settings || null;
      repo = cfg?.repo || null;
      isConnected = Boolean(cfg?.token && cfg?.repo?.owner && cfg?.repo?.name);
      isPaused = Boolean(settings?.paused);
      if (root) {
        root.dataset.connected = isConnected ? "true" : "false";
        root.dataset.paused = isPaused ? "true" : "false";
      }
    }
    renderPanel();
  }

  function setState(nextState, title = STATE[nextState]?.title) {
    currentState = nextState;
    if (!button || !root) return;
    root.dataset.state = nextState;
    button.title = title || STATE[nextState].title;
    button.setAttribute("aria-label", title || STATE[nextState].title);
  }

  function scheduleIdle() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => setState("idle", buildIdleTitle()), 3200);
  }

  function buildIdleTitle() {
    if (!recentSyncs.length) return "Ready to sync";
    return `Ready to sync — last saved ${relativeTime(recentSyncs[0].submittedAt)}`;
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.hidden = !panelOpen;
    if (panelOpen) {
      renderPanel();
    } else {
      lastDiagnostic = "";
    }
  }

  function renderPanel() {
    if (!panel) return;
    const retryDisabled = currentState === "syncing" || isPaused;

    // Build folder picker options
    const currentFolder = repo?.subfolder || "";
    const recentFolders = repo?.recentFolders || [];
    const folderOptions = [
      `<option value="">${escapeHtml("(repository root)")}</option>`,
      ...recentFolders
        .filter((f) => f !== "")
        .map((f) => `<option value="${escapeAttribute(f)}" ${f === currentFolder ? "selected" : ""}>${escapeHtml(f)}</option>`),
      ...(currentFolder && !recentFolders.includes(currentFolder)
        ? [`<option value="${escapeAttribute(currentFolder)}" selected>${escapeHtml(currentFolder)}</option>`]
        : []),
      `<option value="__new__">+ New folder…</option>`
    ].join("");
    const folderPicker = `
      <div class="leetgit-folder-row">
        <label class="leetgit-folder-label" for="leetgit-folder-select">Commit folder</label>
        <select class="leetgit-folder-select" id="leetgit-folder-select">${folderOptions}</select>
        <input class="leetgit-folder-input" type="text" placeholder="folder name" style="display:none">
      </div>
    `;

    const showCommitForm = settings?.commitMessageMode === "prompt" && pendingSubmission && !isPaused;
    const commitMessageForm = showCommitForm ? `
      <form class="leetgit-commit-message">
        <textarea class="leetgit-commit-input" rows="3" placeholder="Commit message for this submission"></textarea>
        <div class="leetgit-actions">
          <button class="leetgit-action" data-action="sync-custom-message" type="submit">Commit</button>
          <button class="leetgit-action leetgit-action-skip" data-action="skip-commit" type="button">Skip</button>
          <button class="leetgit-action" data-action="sync-template-message" type="button">Use template</button>
        </div>
      </form>
    ` : "";
    const rows = recentSyncs.slice(0, 5).map((sync) => {
      const titleText = escapeHtml(`${sync.problemNumber}. ${sync.title}`);
      const titleHtml = sync.problemUrl
        ? `<a class="leetgit-problem-link" href="${escapeAttribute(sync.problemUrl)}" target="_blank" rel="noreferrer">${titleText}</a>`
        : titleText;
      return `
        <div class="leetgit-row">
          <div>
            <div class="leetgit-title">${titleHtml}</div>
            <div class="leetgit-meta">${escapeHtml(sync.language)} · ${sync.status === "Accepted" ? "✅" : "❌"} ${escapeHtml(sync.status)} · ${relativeTime(sync.submittedAt)}${sync.duplicate ? ` · <span class="leetgit-badge" title="Same code and notes as last commit">Commit skipped</span>` : ""}</div>
          </div>
          ${sync.githubUrl ? `<a class="leetgit-link" href="${escapeAttribute(sync.githubUrl)}" target="_blank" rel="noreferrer">↗</a>` : ""}
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="leetgit-panel-head">
        <span class="leetgit-brand"><span class="leetgit-brand-leet">Leet</span><span class="leetgit-brand-git">Git</span></span>
        <div class="leetgit-head-right">
          <button class="leetgit-sync-toggle${isPaused ? " leetgit-sync-toggle-off" : ""}" data-action="toggle-pause" type="button" aria-pressed="${!isPaused}" title="${isPaused ? "Resume syncing" : "Pause syncing"}">
            <span class="leetgit-sync-toggle-thumb"></span>
          </button>
          <span class="leetgit-sync-toggle-label${isPaused ? " leetgit-sync-toggle-label-off" : ""}">${isPaused ? "OFF" : "ON"}</span>
          <span class="leetgit-pill">${escapeHtml(stageLabel || STATE[currentState].label)}</span>
        </div>
      </div>
      ${isPaused ? `<div class="leetgit-paused-notice">Syncing is paused. New submissions will not be committed.</div>` : ""}
      ${lastDiagnostic && !isPaused ? `<div class="leetgit-diagnostic">${escapeHtml(lastDiagnostic)}</div>` : ""}
      ${lastError ? `<div class="leetgit-error">${escapeHtml(lastError)}</div>` : ""}
      ${folderPicker}
      <div class="leetgit-section-title" ${showCommitForm ? "hidden" : ""}>Recent syncs</div>
      <div class="leetgit-list" ${showCommitForm ? "hidden" : ""}>${rows || `<div class="leetgit-empty">No synced submissions yet.</div>`}</div>
      <div class="leetgit-actions" ${showCommitForm ? "hidden" : ""}>
        ${lastFailure ? `<button class="leetgit-action" data-action="retry" type="button" ${retryDisabled ? "disabled" : ""}>Retry last failed sync</button>` : ""}
      </div>
      ${commitMessageForm}
      <button class="leetgit-options" data-action="settings" type="button">Settings</button>
    `;

    panel.querySelector('[data-action="toggle-pause"]')?.addEventListener("click", async () => {
      const newPaused = !isPaused;
      await chrome.runtime.sendMessage({ type: "LEETGIT_SET_PAUSED", paused: newPaused }).catch(() => {});
    });

    const folderSelect = panel.querySelector(".leetgit-folder-select");
    const folderInput = panel.querySelector(".leetgit-folder-input");
    folderSelect?.addEventListener("change", () => {
      if (folderSelect.value === "__new__") {
        folderInput.style.display = "";
        folderInput.focus();
      } else {
        folderInput.style.display = "none";
        persistFolder(folderSelect.value);
      }
    });
    folderInput?.addEventListener("blur", () => {
      const value = folderInput.value.trim();
      if (value) persistFolder(value);
    });
    folderInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        folderInput.blur();
      }
    });

    panel.querySelector('[data-action="retry"]')?.addEventListener("click", async () => {
      stageLabel = STAGE_LABEL["pushing"];
      setState("syncing", "Retrying last failed sync…");
      const response = await chrome.runtime.sendMessage({ type: "LEETGIT_RETRY_LAST_FAILED" }).catch((error) => ({ ok: false, error: error.message }));
      if (!response?.ok) {
        lastError = response?.error || "Retry failed";
        stageLabel = null;
        setState("error", "Couldn't save — retry failed");
        renderPanel();
      } else {
        lastError = "";
        lastFailure = null;
        renderPanel();
      }
    });

    panel.querySelector('[data-action="settings"]')?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "LEETGIT_OPEN_SETTINGS" }).catch((error) => {
        lastError = error.message || "Could not open settings.";
        renderPanel();
      });
    });

    panel.querySelector(".leetgit-commit-message")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = panel.querySelector(".leetgit-commit-input");
      const commitMessage = input.value.trim();
      if (!pendingSubmission || !commitMessage) return;
      await persistFolder(resolveSelectedFolder());
      submitCapturedSubmission({ ...pendingSubmission, commitMessage });
    });

    panel.querySelector('[data-action="sync-template-message"]')?.addEventListener("click", async () => {
      if (!pendingSubmission) return;
      await persistFolder(resolveSelectedFolder());
      submitCapturedSubmission(pendingSubmission);
    });

    panel.querySelector('[data-action="skip-commit"]')?.addEventListener("click", () => {
      pendingSubmission = null;
      lastDiagnostic = "";
      setState("idle", "Submission skipped — not committed");
      renderPanel();
    });
  }


  function injectStyles() {
    if (document.getElementById("leetgit-styles")) return;
    const style = document.createElement("style");
    style.id = "leetgit-styles";
    style.textContent = `
      /* ── Root & floating button ─────────────────────────── */
      #leetgit-root {
        display: inline-flex;
        align-items: center;
        position: relative;
        z-index: 2147483647;
        margin-left: 10px;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        color: #1f2328;
      }
      #leetgit-root.leetgit-fixed {
        position: fixed;
        right: 18px;
        bottom: 18px;
        margin-left: 0;
      }
      #leetgit-button {
        position: relative;
        width: 36px;
        height: 36px;
        border: 1px solid #d0d7de;
        border-radius: 999px;
        background: #ffffff;
        color: #656d76;
        display: inline-grid;
        place-items: center;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(31,35,40,0.06), 0 8px 24px rgba(31,35,40,0.1);
        transition: border-color 160ms, color 160ms, box-shadow 160ms, transform 160ms;
      }
      #leetgit-button:hover { transform: translateY(-1px); }

      /* Connection dot */
      #leetgit-root[data-connected] #leetgit-button::before {
        content: "";
        position: absolute;
        width: 9px; height: 9px;
        right: 0; top: 0;
        border-radius: 999px;
        background: #cf222e;
        border: 2px solid #fff;
      }
      #leetgit-root[data-connected="true"] #leetgit-button::before { background: #2db55d; }

      /* Syncing */
      #leetgit-root[data-state="syncing"] #leetgit-button {
        color: #0969da;
        border-color: #79b8ff;
        animation: leetgit-pulse 1.1s ease-in-out infinite;
      }
      /* Synced */
      #leetgit-root[data-state="synced"] #leetgit-button {
        color: #1f883d;
        border-color: #2db55d;
        box-shadow: 0 0 0 4px rgba(45,181,93,0.18), 0 8px 24px rgba(31,35,40,0.1);
      }
      /* Error */
      #leetgit-root[data-state="error"] #leetgit-button {
        color: #cf222e;
        border-color: #f87171;
      }
      #leetgit-root[data-state="error"] #leetgit-button::after {
        content: "";
        position: absolute;
        width: 9px; height: 9px;
        right: 0; top: 0;
        border-radius: 999px;
        background: #cf222e;
        border: 2px solid #fff;
      }
      /* Paused */
      #leetgit-root[data-paused="true"] #leetgit-button {
        color: #92400e;
        border-color: #fbbf24;
      }
      #leetgit-root[data-paused="true"] #leetgit-button::before { background: #f59e0b !important; }
      #leetgit-root[data-paused="true"] #leetgit-button::after {
        content: "⏸";
        position: absolute; inset: 0;
        display: grid; place-items: center;
        background: rgba(254,243,199,0.9);
        border-radius: 999px;
        font-size: 11px; color: #92400e;
        font-family: system-ui, sans-serif;
      }

      /* ── Panel ──────────────────────────────────────────── */
      #leetgit-panel {
        position: absolute;
        right: 0; top: 44px;
        width: min(348px, calc(100vw - 28px));
        background: #ffffff;
        border: 1px solid #d0d7de;
        border-radius: 10px;
        box-shadow: 0 1px 3px rgba(31,35,40,0.06), 0 16px 48px rgba(31,35,40,0.18);
        padding: 14px;
        color: #1f2328;
      }
      .leetgit-fixed #leetgit-panel { top: auto; bottom: 44px; }

      /* ── Panel header ───────────────────────────────────── */
      .leetgit-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 12px;
        border-bottom: 1px solid #eaecef;
        margin-bottom: 12px;
      }
      .leetgit-brand {
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -0.3px;
        line-height: 1;
        user-select: none;
      }
      .leetgit-brand-leet { color: #ffa116; }
      .leetgit-brand-git  { color: #24292f; }

      .leetgit-head-right {
        display: flex; align-items: center; gap: 6px;
      }
      .leetgit-pill {
        border-radius: 999px;
        background: #f6f8fa;
        border: 1px solid #d0d7de;
        color: #656d76;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        white-space: nowrap;
        transition: background 200ms, color 200ms, border-color 200ms;
      }
      #leetgit-root[data-state="syncing"] .leetgit-pill {
        background: #ddf4ff; border-color: #79b8ff; color: #0550ae;
      }
      #leetgit-root[data-state="synced"] .leetgit-pill {
        background: #dafbe1; border-color: #4ac26b; color: #1a7f37;
      }
      #leetgit-root[data-state="error"] .leetgit-pill {
        background: #fff5f5; border-color: #fca5a5; color: #cf222e;
      }

      /* ── Sync toggle ────────────────────────────────────── */
      .leetgit-sync-toggle {
        position: relative; width: 30px; height: 17px;
        border-radius: 999px; border: none;
        background: #2db55d; cursor: pointer; padding: 0;
        flex-shrink: 0; transition: background 160ms;
      }
      .leetgit-sync-toggle.leetgit-sync-toggle-off { background: #cbd5e1; }
      .leetgit-sync-toggle-thumb {
        position: absolute; top: 2.5px; left: 2.5px;
        width: 12px; height: 12px; border-radius: 999px;
        background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        transition: transform 160ms;
      }
      .leetgit-sync-toggle:not(.leetgit-sync-toggle-off) .leetgit-sync-toggle-thumb {
        transform: translateX(13px);
      }
      .leetgit-sync-toggle-label {
        font-size: 11px; font-weight: 700; color: #1f883d; min-width: 18px;
      }
      .leetgit-sync-toggle-label-off { color: #94a3b8; }

      /* ── Status messages ────────────────────────────────── */
      .leetgit-paused-notice {
        margin-bottom: 10px; padding: 8px 10px; border-radius: 6px;
        background: #fff7ed; color: #92400e;
        font-size: 12px; line-height: 1.4;
        border: 1px solid #fed7aa;
      }
      .leetgit-error {
        margin-bottom: 10px; padding: 8px 10px; border-radius: 6px;
        background: #fff5f5; color: #cf222e;
        font-size: 12px; line-height: 1.4; overflow-wrap: anywhere;
        border: 1px solid #fca5a5;
      }
      .leetgit-diagnostic {
        margin-bottom: 10px; padding: 8px 10px; border-radius: 6px;
        background: #f6f8fa; color: #656d76;
        font-size: 12px; line-height: 1.4; overflow-wrap: anywhere;
        border: 1px solid #d0d7de;
      }

      /* ── Recent syncs ───────────────────────────────────── */
      .leetgit-section-title {
        font-size: 11px; font-weight: 700;
        color: #656d76; letter-spacing: 0.04em; text-transform: uppercase;
        margin-bottom: 8px;
      }
      .leetgit-list {
        display: grid; gap: 6px;
        max-height: 220px; overflow-y: auto;
      }
      .leetgit-row {
        display: flex; align-items: center;
        justify-content: space-between; gap: 8px;
        padding: 9px 10px;
        border: 1px solid #d0d7de;
        border-radius: 6px;
        background: #ffffff;
      }
      .leetgit-title {
        font-size: 12.5px; font-weight: 700; color: #1f2328;
      }
      .leetgit-problem-link {
        color: inherit; text-decoration: none;
        transition: color 120ms;
      }
      .leetgit-problem-link:hover { color: #0969da; text-decoration: underline; }
      .leetgit-meta, .leetgit-empty {
        margin-top: 2px; font-size: 11.5px; color: #656d76;
      }
      .leetgit-link {
        color: #0969da; text-decoration: none;
        font-size: 12px; font-weight: 700; flex-shrink: 0;
        transition: opacity 120ms;
      }
      .leetgit-link:hover { opacity: 0.7; }
      .leetgit-badge {
        display: inline-block; border-radius: 999px;
        background: #fff7ed; color: #92400e; border: 1px solid #fed7aa;
        font-size: 10px; font-weight: 700;
        padding: 1px 6px; vertical-align: middle;
      }

      /* ── Action buttons ─────────────────────────────────── */
      .leetgit-actions {
        display: flex; align-items: stretch;
        justify-content: space-between; gap: 8px;
        margin-top: 12px;
      }
      .leetgit-action {
        flex: 1;
        border: 1px solid #d0d7de;
        border-radius: 6px;
        background: #f6f8fa;
        color: #1f2328;
        padding: 7px 8px;
        font-size: 12px; font-weight: 600;
        cursor: pointer; font: inherit; font-size: 12px;
        transition: background 120ms, border-color 120ms;
      }
      .leetgit-action:hover { background: #eaecef; border-color: #adb5bf; }
      .leetgit-action:disabled { cursor: not-allowed; opacity: 0.5; }
      .leetgit-action-skip { color: #656d76; flex: 0 0 auto; }

      .leetgit-options {
        display: inline-block;
        margin-top: 10px;
        border: none; background: transparent;
        color: #656d76; cursor: pointer;
        font: inherit; font-size: 12px; padding: 0;
        text-decoration: none; transition: color 120ms;
      }
      .leetgit-options:hover { color: #1f2328; }

      /* ── Folder picker ──────────────────────────────────── */
      .leetgit-folder-row {
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 10px;
      }
      .leetgit-folder-label {
        font-size: 11px; font-weight: 700; color: #656d76;
        white-space: nowrap; flex-shrink: 0;
      }
      .leetgit-folder-select {
        flex: 1; min-width: 0;
        border: 1px solid #d0d7de; border-radius: 6px;
        background: #f6f8fa; color: #1f2328;
        padding: 5px 8px; font: inherit; font-size: 12px;
        cursor: pointer; transition: border-color 150ms;
      }
      .leetgit-folder-select:focus {
        outline: none; border-color: #0969da;
        box-shadow: 0 0 0 3px rgba(9,105,218,0.18);
      }
      .leetgit-folder-input {
        flex: 1; min-width: 0;
        border: 1px solid #0969da; border-radius: 6px;
        background: #ffffff; color: #1f2328;
        padding: 5px 8px; font: inherit; font-size: 12px;
        box-shadow: 0 0 0 3px rgba(9,105,218,0.18);
      }
      .leetgit-folder-input:focus { outline: none; }

      /* ── Commit message form ────────────────────────────── */
      .leetgit-commit-message { margin-top: 12px; }
      .leetgit-commit-input {
        width: 100%; box-sizing: border-box;
        resize: vertical;
        border: 1px solid #d0d7de; border-radius: 6px;
        padding: 8px 10px;
        color: #1f2328; background: #ffffff;
        font: inherit; font-size: 12.5px; line-height: 1.4;
        transition: border-color 150ms, box-shadow 150ms;
      }
      .leetgit-commit-input:focus {
        outline: none; border-color: #0969da;
        box-shadow: 0 0 0 3px rgba(9,105,218,0.18);
      }

      /* ── Animation ──────────────────────────────────────── */
      @keyframes leetgit-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(9,105,218,0.22), 0 8px 24px rgba(31,35,40,0.1); }
        50%       { box-shadow: 0 0 0 6px rgba(9,105,218,0), 0 8px 24px rgba(31,35,40,0.1); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function iconSvg() {
    // Exact replica of icons/icon.svg scaled to fit the circular button.
    // Includes the white rounded-square background so it matches the toolbar icon.
    return `
      <svg width="24" height="24" viewBox="0 0 128 128"
           xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="128" height="128" rx="22" fill="#ffffff"/>
        <rect width="128" height="128" rx="22" fill="none" stroke="#e2e8f0" stroke-width="2"/>
        <rect x="12" y="32" width="14" height="64" rx="3" fill="#ffa116"/>
        <rect x="12" y="82" width="44" height="14" rx="3" fill="#ffa116"/>
        <path d="M 111 45 A 25 25 0 1 0 120 64 L 95 64"
              fill="none" stroke="#24292f" stroke-width="14"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  function relativeTime(value) {
    if (!value) return "just now";
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function resolveSelectedFolder() {
    const select = panel?.querySelector(".leetgit-folder-select");
    if (!select) return repo?.subfolder || "";
    if (select.value === "__new__") {
      return (panel.querySelector(".leetgit-folder-input")?.value || "").trim();
    }
    return select.value;
  }

  function persistFolder(subfolder) {
    if (repo) repo = { ...repo, subfolder };
    return chrome.runtime.sendMessage({ type: "LEETGIT_SET_FOLDER", subfolder }).catch(() => {});
  }

  function formatDiagnostic(stage, detail = {}) {
    if (stage === "submit-seen") return `Detected submission for ${detail.titleSlug || "current problem"} (${detail.language || "language unknown"}).`;
    if (stage === "submission-id-seen") return `LeetCode submission id ${detail.submissionId} detected. Waiting for result...`;
    if (stage === "result-polling") return `Checking LeetCode result for submission ${detail.submissionId}...`;
    if (stage === "result-poll-error") return `Could not read result yet for ${detail.submissionId} (HTTP ${detail.status}). Retrying...`;
    if (stage === "check-complete") return `LeetCode result received: ${detail.status || "unknown status"}.`;
    return `Capture event: ${stage}`;
  }
})();
