const repoLink = document.getElementById("repo-link");
const connectionPill = document.getElementById("connection-pill");
const tokenWarning = document.getElementById("token-warning");
const recentSyncs = document.getElementById("recent-syncs");
const settingsButton = document.getElementById("settings");
const viewRepoButton = document.getElementById("view-repo");

let config = null;
let state = null;

init();

async function init() {
  settingsButton.addEventListener("click", () => sendMessage({ type: "LEETGIT_OPEN_SETTINGS" }));
  viewRepoButton.addEventListener("click", openRepo);
  repoLink.addEventListener("click", openRepo);
  try {
    [config, state] = await Promise.all([
      sendMessage({ type: "LEETGIT_GET_CONFIG" }).then((response) => response.config),
      sendMessage({ type: "LEETGIT_GET_STATE" })
    ]);
    render();
  } catch (error) {
    connectionPill.textContent = "Setup needed";
    connectionPill.classList.add("error");
    viewRepoButton.disabled = true;
  }
}

function render() {
  const connected = Boolean(config.token && config.repo.owner && config.repo.name);
  connectionPill.textContent = connected ? "Connected" : "Setup needed";
  connectionPill.classList.toggle("error", !connected);
  repoLink.textContent = connected ? `${config.repo.owner}/${config.repo.name}` : "Not connected";
  viewRepoButton.disabled = !connected;

  renderTokenWarning();
  recentSyncs.innerHTML = (state.recentSyncs || []).slice(0, 3).map(renderSyncRow).join("") || (
    `<div class="empty">No synced submissions yet.</div>`
  );
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
  const title = `${sync.problemNumber}. ${sync.title}`;
  return `
    <div class="sync-row">
      <div>
        <div class="sync-title">${escapeHtml(title)}</div>
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
