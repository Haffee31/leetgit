(() => {
  const STATE = {
    idle: {
      label: "LeetGit ready",
      title: "LeetGit ready"
    },
    syncing: {
      label: "Syncing...",
      title: "Syncing submission..."
    },
    synced: {
      label: "Synced",
      title: "Synced"
    },
    error: {
      label: "Sync failed",
      title: "Sync failed - click for details"
    }
  };

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
  let isConnected = null;
  let isPaused = false;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "LEETGIT_PAGE_DIAGNOSTIC") {
      if (isPaused) return;
      lastDiagnostic = formatDiagnostic(event.data.stage, event.data.detail);
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
    settings = await chrome.runtime.sendMessage({ type: "LEETGIT_GET_CONFIG" }).then((response) => response.config?.settings).catch(() => null);
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
    setState("syncing", `Syncing ${payload.titleSlug}...`);
    chrome.runtime.sendMessage({
      type: "LEETGIT_SUBMISSION_CAPTURED",
      payload
    }).then((response) => {
      if (!response?.ok) {
        lastError = response?.error || "Sync failed.";
        setState("error", "Sync failed - click for details");
        renderPanel();
        return;
      }
      if (response.result?.skipped) {
        const skipTitle = response.result.reason === "duplicate"
          ? "LeetGit ready — commit skipped (same code & notes)"
          : `LeetGit ready — skipped (${response.result.reason})`;
        setState("idle", skipTitle);
        hydrateState();
        return;
      }
      setState("synced", "Synced ✓");
      scheduleIdle();
      hydrateState();
    }).catch((error) => {
      lastError = error.message || "Sync failed.";
      setState("error", "Sync failed - click for details");
      renderPanel();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "LEETGIT_SYNC_STARTED") {
      setState("syncing", `Syncing ${message.title || "submission"}...`);
      return;
    }
    if (message?.type === "LEETGIT_SYNC_COMPLETE") {
      recentSyncs = message.recentSyncs || recentSyncs;
      lastFailure = null;
      setState("synced", `Synced ✓ ${message.title} (${message.language}, ${message.status})`);
      scheduleIdle();
      renderPanel();
      return;
    }
    if (message?.type === "LEETGIT_SYNC_SKIPPED") {
      recentSyncs = message.recentSyncs || recentSyncs;
      const skipTitle = message.reason === "duplicate"
        ? "LeetGit ready — commit skipped (same code & notes)"
        : message.reason === "paused"
          ? "LeetGit paused — submission not synced"
          : `LeetGit ready — skipped (${message.reason})`;
      setState("idle", skipTitle);
      renderPanel();
      return;
    }
    if (message?.type === "LEETGIT_SYNC_ERROR") {
      lastError = message.error || "Unknown error";
      lastFailure = message.failure || null;
      setState("error", "Sync failed - click for details");
      renderPanel();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.settings) return;
    const newSettings = changes.settings.newValue;
    if (!newSettings) return;
    settings = newSettings;
    const wasPaused = isPaused;
    isPaused = Boolean(newSettings.paused);
    if (isPaused && !wasPaused && pendingSubmission) {
      pendingSubmission = null;
    }
    if (root) root.dataset.paused = isPaused ? "true" : "false";
    renderPanel();
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
      if (lastFailure) setState("error", "Sync failed - click for details");
    }
    if (configResponse?.ok) {
      const cfg = configResponse.config;
      settings = cfg?.settings || null;
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
    if (!recentSyncs.length) return "LeetGit ready";
    return `LeetGit ready - Last sync: ${relativeTime(recentSyncs[0].submittedAt)}`;
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.hidden = !panelOpen;
    if (panelOpen) {
      renderPanel();
    }
  }

  function renderPanel() {
    if (!panel) return;
    const retryDisabled = currentState === "syncing" || isPaused;
    const commitMessageForm = settings?.commitMessageMode === "prompt" ? `
      <form class="leetgit-commit-message" ${pendingSubmission && !isPaused ? "" : "hidden"}>
        <textarea class="leetgit-commit-input" rows="3" placeholder="Commit message for this submission"></textarea>
        <div class="leetgit-actions">
          <button class="leetgit-action" data-action="sync-custom-message" type="submit">Sync with message</button>
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
        <strong>LeetGit</strong>
        <div class="leetgit-head-right">
          <button class="leetgit-sync-toggle${isPaused ? " leetgit-sync-toggle-off" : ""}" data-action="toggle-pause" type="button" aria-pressed="${!isPaused}" title="${isPaused ? "Resume syncing" : "Pause syncing"}">
            <span class="leetgit-sync-toggle-thumb"></span>
          </button>
          <span class="leetgit-sync-toggle-label${isPaused ? " leetgit-sync-toggle-label-off" : ""}">${isPaused ? "OFF" : "ON"}</span>
          <span class="leetgit-pill">${escapeHtml(STATE[currentState].label)}</span>
        </div>
      </div>
      ${isPaused ? `<div class="leetgit-paused-notice">Syncing is paused. New submissions will not be committed.</div>` : ""}
      ${lastDiagnostic && !isPaused ? `<div class="leetgit-diagnostic">${escapeHtml(lastDiagnostic)}</div>` : ""}
      ${lastError ? `<div class="leetgit-error">${escapeHtml(lastError)}</div>` : ""}
      <div class="leetgit-section-title">Recent syncs</div>
      <div class="leetgit-list">${rows || `<div class="leetgit-empty">No synced submissions yet.</div>`}</div>
      <div class="leetgit-actions">
        ${settings?.commitMessageMode === "prompt" && pendingSubmission && !isPaused ? `<button class="leetgit-action" data-action="custom-message" type="button">Custom commit message</button>` : ""}
        ${lastFailure ? `<button class="leetgit-action" data-action="retry" type="button" ${retryDisabled ? "disabled" : ""}>Retry last failed sync</button>` : ""}
      </div>
      ${commitMessageForm}
      <button class="leetgit-options" data-action="settings" type="button">Settings</button>
    `;

    panel.querySelector('[data-action="toggle-pause"]')?.addEventListener("click", async () => {
      const newPaused = !isPaused;
      await chrome.runtime.sendMessage({ type: "LEETGIT_SET_PAUSED", paused: newPaused }).catch(() => {});
    });

    panel.querySelector('[data-action="retry"]')?.addEventListener("click", async () => {
      setState("syncing", "Retrying last failed sync...");
      const response = await chrome.runtime.sendMessage({ type: "LEETGIT_RETRY_LAST_FAILED" }).catch((error) => ({ ok: false, error: error.message }));
      if (!response?.ok) {
        lastError = response?.error || "Retry failed";
        setState("error", "Retry failed - click for details");
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

    panel.querySelector('[data-action="custom-message"]')?.addEventListener("click", () => {
      const form = panel.querySelector(".leetgit-commit-message");
      form.hidden = false;
      form.querySelector("textarea").focus();
    });

    panel.querySelector(".leetgit-commit-message")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = panel.querySelector(".leetgit-commit-input");
      const commitMessage = input.value.trim();
      if (!pendingSubmission || !commitMessage) return;
      submitCapturedSubmission({ ...pendingSubmission, commitMessage });
    });

    panel.querySelector('[data-action="sync-template-message"]')?.addEventListener("click", () => {
      if (!pendingSubmission) return;
      submitCapturedSubmission(pendingSubmission);
    });
  }


  function injectStyles() {
    if (document.getElementById("leetgit-styles")) return;
    const style = document.createElement("style");
    style.id = "leetgit-styles";
    style.textContent = `
      #leetgit-root {
        display: inline-flex;
        align-items: center;
        position: relative;
        z-index: 2147483647;
        margin-left: 10px;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #leetgit-root.leetgit-fixed {
        position: fixed;
        right: 18px;
        bottom: 18px;
        margin-left: 0;
      }
      #leetgit-button {
        position: relative;
        width: 34px;
        height: 34px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 999px;
        background: #ffffff;
        color: #64748b;
        display: inline-grid;
        place-items: center;
        cursor: pointer;
        box-shadow: 0 10px 25px rgba(15, 23, 42, 0.12);
        transition: border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      #leetgit-root[data-connected] #leetgit-button::before {
        content: "";
        position: absolute;
        width: 9px;
        height: 9px;
        right: 1px;
        bottom: 1px;
        border-radius: 999px;
        background: #ef4444;
        border: 2px solid #fff;
      }
      #leetgit-root[data-connected="true"] #leetgit-button::before {
        background: #22c55e;
      }
      #leetgit-button:hover {
        transform: translateY(-1px);
      }
      #leetgit-root[data-state="syncing"] #leetgit-button {
        color: #2563eb;
        border-color: #60a5fa;
        animation: leetgit-pulse 1.1s ease-in-out infinite;
      }
      #leetgit-root[data-state="synced"] #leetgit-button {
        color: #059669;
        border-color: #34d399;
        box-shadow: 0 0 0 5px rgba(52, 211, 153, 0.18), 0 10px 25px rgba(15, 23, 42, 0.12);
      }
      #leetgit-root[data-state="error"] #leetgit-button {
        color: #dc2626;
        border-color: #f87171;
      }
      #leetgit-root[data-state="error"] #leetgit-button::after {
        content: "";
        position: absolute;
        width: 9px;
        height: 9px;
        right: 1px;
        top: 1px;
        border-radius: 999px;
        background: #dc2626;
        border: 2px solid #fff;
      }
      #leetgit-panel {
        position: absolute;
        right: 0;
        top: 42px;
        width: min(340px, calc(100vw - 28px));
        color: #172033;
        background: #fff;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
        padding: 12px;
      }
      .leetgit-fixed #leetgit-panel {
        top: auto;
        bottom: 42px;
      }
      .leetgit-panel-head,
      .leetgit-row,
      .leetgit-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .leetgit-pill {
        border-radius: 999px;
        background: #eef2ff;
        color: #3730a3;
        font-size: 11px;
        padding: 3px 8px;
        white-space: nowrap;
      }
      .leetgit-error {
        margin-top: 10px;
        padding: 8px;
        border-radius: 6px;
        background: #fef2f2;
        color: #991b1b;
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .leetgit-diagnostic {
        margin-top: 10px;
        padding: 8px;
        border-radius: 6px;
        background: #eff6ff;
        color: #1e3a8a;
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .leetgit-section-title {
        margin-top: 12px;
        margin-bottom: 6px;
        font-size: 12px;
        font-weight: 700;
        color: #475569;
      }
      .leetgit-list {
        display: grid;
        gap: 6px;
        max-height: 210px;
        overflow-y: auto;
      }
      .leetgit-row {
        padding: 8px;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
      }
      .leetgit-title {
        font-size: 13px;
        font-weight: 700;
        color: #0f172a;
      }
      .leetgit-problem-link {
        color: inherit;
        text-decoration: none;
      }
      .leetgit-problem-link:hover {
        color: #2563eb;
        text-decoration: underline;
      }
      .leetgit-meta,
      .leetgit-empty {
        margin-top: 2px;
        font-size: 12px;
        color: #64748b;
      }
      .leetgit-link {
        color: #2563eb;
        text-decoration: none;
        font-size: 16px;
      }
      .leetgit-badge {
        display: inline-block;
        border-radius: 999px;
        background: #fff7ed;
        color: #9a3412;
        font-size: 10px;
        font-weight: 800;
        padding: 1px 6px;
        vertical-align: middle;
      }
      .leetgit-actions {
        margin-top: 12px;
        align-items: stretch;
      }
      .leetgit-action {
        flex: 1;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #f8fafc;
        color: #0f172a;
        padding: 7px 8px;
        font-size: 12px;
        cursor: pointer;
      }
      .leetgit-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .leetgit-options {
        display: inline-block;
        margin-top: 10px;
        border: 0;
        background: transparent;
        color: #2563eb;
        cursor: pointer;
        font-size: 12px;
        font: inherit;
        padding: 0;
        text-decoration: none;
      }
      .leetgit-head-right {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .leetgit-sync-toggle {
        position: relative;
        width: 30px;
        height: 17px;
        border-radius: 999px;
        border: none;
        background: #22c55e;
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
        transition: background 160ms;
      }
      .leetgit-sync-toggle.leetgit-sync-toggle-off {
        background: #cbd5e1;
      }
      .leetgit-sync-toggle-thumb {
        position: absolute;
        top: 2.5px;
        left: 2.5px;
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        transition: transform 160ms;
      }
      .leetgit-sync-toggle:not(.leetgit-sync-toggle-off) .leetgit-sync-toggle-thumb {
        transform: translateX(13px);
      }
      .leetgit-sync-toggle-label {
        font-size: 11px;
        font-weight: 700;
        color: #047857;
        min-width: 18px;
      }
      .leetgit-sync-toggle-label-off {
        color: #94a3b8;
      }
      .leetgit-paused-notice {
        margin-top: 8px;
        padding: 7px 9px;
        border-radius: 6px;
        background: #fef9c3;
        color: #854d0e;
        font-size: 12px;
        line-height: 1.35;
      }
      #leetgit-root[data-paused="true"] #leetgit-button {
        color: #92400e;
        border-color: #fbbf24;
      }
      #leetgit-root[data-paused="true"] #leetgit-button::before {
        background: #f59e0b !important;
      }
      #leetgit-root[data-paused="true"] #leetgit-button::after {
        content: "⏸";
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(254, 243, 199, 0.88);
        border-radius: 999px;
        font-size: 11px;
        color: #92400e;
        font-family: system-ui, sans-serif;
      }
      .leetgit-commit-message {
        margin-top: 10px;
      }
      .leetgit-commit-input {
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 8px;
        color: #0f172a;
        background: #fff;
        font: inherit;
        font-size: 12px;
        line-height: 1.4;
      }
      @keyframes leetgit-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.22), 0 10px 25px rgba(15, 23, 42, 0.12); }
        50% { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0), 0 10px 25px rgba(15, 23, 42, 0.12); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function iconSvg() {
    return `
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M18 9a6 6 0 0 1-6 6H6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M14 5l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
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

  function formatDiagnostic(stage, detail = {}) {
    if (stage === "submit-seen") return `Detected submission for ${detail.titleSlug || "current problem"} (${detail.language || "language unknown"}).`;
    if (stage === "submission-id-seen") return `LeetCode submission id ${detail.submissionId} detected. Waiting for result...`;
    if (stage === "result-polling") return `Checking LeetCode result for submission ${detail.submissionId}...`;
    if (stage === "result-poll-error") return `Could not read result yet for ${detail.submissionId} (HTTP ${detail.status}). Retrying...`;
    if (stage === "check-complete") return `LeetCode result received: ${detail.status || "unknown status"}.`;
    return `Capture event: ${stage}`;
  }
})();
