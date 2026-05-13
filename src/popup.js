const repoLink = document.getElementById("repo-link");
const statusDot = document.getElementById("status-dot");
const connectionLabel = document.getElementById("connection-label");
const tokenWarning = document.getElementById("token-warning");
const recentSyncs = document.getElementById("recent-syncs");
const settingsButton = document.getElementById("settings");
const viewRepoButton = document.getElementById("view-repo");
const pauseToggle = document.getElementById("pause-toggle");
const pauseToggleLabel = document.getElementById("pause-toggle-label");

let config = null;
let state = null;

document.getElementById("credit-year").textContent = new Date().getFullYear();

init();

async function init() {
  settingsButton.addEventListener("click", () => sendMessage({ type: "LEETGIT_OPEN_SETTINGS" }));
  document.getElementById("open-settings-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    sendMessage({ type: "LEETGIT_OPEN_SETTINGS" });
  });
  viewRepoButton.addEventListener("click", openRepo);
  repoLink.addEventListener("click", openRepo);
  pauseToggle.addEventListener("click", togglePause);
  try {
    [config, state] = await Promise.all([
      sendMessage({ type: "LEETGIT_GET_CONFIG" }).then((response) => response.config),
      sendMessage({ type: "LEETGIT_GET_STATE" })
    ]);
    render();
  } catch {
    statusDot.className = "status-dot status-dot-error";
    connectionLabel.textContent = "Setup needed";
    connectionLabel.classList.add("connection-label-error");
    viewRepoButton.disabled = true;
  }
}

async function togglePause() {
  const newPaused = !config.settings.paused;
  try {
    const response = await sendMessage({ type: "LEETGIT_SET_PAUSED", paused: newPaused });
    config = response.config;
    renderPauseToggle();
  } catch {}
}

function render() {
  const connected = Boolean(config.token && config.repo.owner && config.repo.name);

  repoLink.textContent = connected ? `${config.repo.owner}/${config.repo.name}` : "Not configured";
  repoLink.disabled = !connected;

  statusDot.className = `status-dot ${connected ? "status-dot-ok" : "status-dot-error"}`;
  connectionLabel.textContent = connected ? "Connected to GitHub" : "Setup needed";
  connectionLabel.classList.toggle("connection-label-error", !connected);

  viewRepoButton.disabled = !connected;

  renderTokenWarning();
  renderPauseToggle();
  recentSyncs.innerHTML = (state.recentSyncs || []).slice(0, 3).map(renderSyncRow).join("") || (
    `<div class="empty">No synced submissions yet.</div>`
  );
}

function renderPauseToggle() {
  const paused = Boolean(config?.settings?.paused);
  pauseToggle.setAttribute("aria-pressed", String(!paused));
  pauseToggle.classList.toggle("sync-toggle-off", paused);
  pauseToggleLabel.textContent = paused ? "OFF" : "ON";
  pauseToggleLabel.classList.toggle("sync-toggle-state-paused", paused);
}

function renderTokenWarning() {
  const expiresAt = config.tokenMeta?.expiresAt;
  if (!expiresAt) {
    tokenWarning.hidden = true;
    return;
  }
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  if (days > 14) {
    tokenWarning.hidden = true;
    return;
  }
  tokenWarning.hidden = false;
  tokenWarning.textContent = days < 0
    ? `Your GitHub token expired on ${formatDate(expiresAt)}.`
    : `Your GitHub token expires in ${days} day${days === 1 ? "" : "s"}.`;
}

function renderSyncRow(sync) {
  const title = escapeHtml(`${sync.problemNumber}. ${sync.title}`);
  const titleHtml = sync.problemUrl
    ? `<button class="sync-title sync-title-link" data-url="${escapeAttribute(sync.problemUrl)}" type="button">${title}</button>`
    : `<div class="sync-title">${title}</div>`;
  return `
    <div class="sync-row">
      <div>
        ${titleHtml}
        <div class="sync-meta">${escapeHtml(sync.language)} · ${sync.status === "Accepted" ? "✅" : "❌"} ${escapeHtml(sync.status)} · ${relativeTime(sync.submittedAt)}</div>
      </div>
      ${sync.githubUrl ? `<button class="open-file" data-url="${escapeAttribute(sync.githubUrl)}" type="button">↗</button>` : ""}
    </div>
  `;
}

recentSyncs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-url]");
  if (button) chrome.tabs.create({ url: button.dataset.url });
});

function openRepo() {
  if (!config?.repo?.owner || !config?.repo?.name) return;
  chrome.tabs.create({ url: `https://github.com/${config.repo.owner}/${config.repo.name}` });
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "LeetGit request failed.");
  return response;
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

function formatDate(value) {
  return new Date(value).toLocaleDateString();
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
