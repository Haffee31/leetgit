const STATUSES = [
  "Accepted",
  "Wrong Answer",
  "Time Limit Exceeded",
  "Memory Limit Exceeded",
  "Runtime Error",
  "Compile Error"
];

const DEBOUNCE_MS = 600;

// ── Element refs ───────────────────────────────────────────────────
const tokenInput = document.getElementById("token");
const repoSelect = document.getElementById("repo-select");
const branchInput = document.getElementById("branch");
const subfolderInput = document.getElementById("subfolder");
const statusChecks = document.getElementById("status-checks");
const skipDuplicatesInput = document.getElementById("skip-duplicates");
const commitModeInputs = document.querySelectorAll('input[name="commit-mode"]');
const commitTemplateInput = document.getElementById("commit-template");
const glowInput = document.getElementById("glow-on-success");
const failureInput = document.getElementById("notify-on-failure");
const navItems = document.querySelectorAll(".nav-item");
const panes = document.querySelectorAll(".section-pane");

let loadedConfig = null;
let repos = [];
let activeSection = "repository";
const debounceTimers = {};

init();

async function init() {
  renderStatusChecks();
  await loadConfig();
  bindSidebarNav();
  bindAutoSave();
  bindActions();
}

// ── Sidebar navigation ─────────────────────────────────────────────
function bindSidebarNav() {
  for (const item of navItems) {
    item.addEventListener("click", () => activateSection(item.dataset.section));
  }
}

function activateSection(section) {
  activeSection = section;
  for (const item of navItems) {
    item.classList.toggle("is-active", item.dataset.section === section);
  }
  for (const pane of panes) {
    pane.classList.toggle("is-active", pane.id === `pane-${section}`);
  }
}

// ── Auto-save ──────────────────────────────────────────────────────
function bindAutoSave() {
  // Token: blur only (avoid saving partial pastes)
  tokenInput.addEventListener("blur", () => save("repository"));

  // Text inputs: debounced
  for (const [input, section] of [
    [branchInput, "repository"],
    [subfolderInput, "repository"],
    [commitTemplateInput, "format"]
  ]) {
    input.addEventListener("input", () => {
      clearTimeout(debounceTimers[input.id]);
      debounceTimers[input.id] = setTimeout(() => save(section), DEBOUNCE_MS);
    });
  }

  // Repo select: immediate, also auto-fills branch
  repoSelect.addEventListener("change", () => {
    const repo = repos.find((r) => r.fullName === repoSelect.value);
    if (repo) branchInput.value = repo.defaultBranch || "main";
    save("repository");
  });

  // Checkboxes / radios: immediate
  for (const input of statusChecks.querySelectorAll("input")) {
    input.addEventListener("change", () => save("sync"));
  }
  skipDuplicatesInput.addEventListener("change", () => save("sync"));

  for (const input of commitModeInputs) {
    input.addEventListener("change", () => save("format"));
  }

  glowInput.addEventListener("change", () => save("notifications"));
  failureInput.addEventListener("change", () => save("notifications"));
}

async function save(section) {
  try {
    const response = await sendMessage({ type: "LEETGIT_SAVE_CONFIG", config: readFormConfig() });
    loadedConfig = response.config;
    showSavedBadge(section);
  } catch (error) {
    setSectionStatus(section, error.message, true);
  }
}

function showSavedBadge(section) {
  const badge = document.getElementById(`saved-${section}`);
  if (!badge) return;
  badge.hidden = false;
  clearTimeout(badge._leetgitTimer);
  badge._leetgitTimer = setTimeout(() => { badge.hidden = true; }, 2000);
}

// ── Action buttons ─────────────────────────────────────────────────
function bindActions() {
  document.getElementById("toggle-token").addEventListener("click", () => {
    const hidden = tokenInput.type === "password";
    tokenInput.type = hidden ? "text" : "password";
    document.getElementById("toggle-token").textContent = hidden ? "Hide" : "Show";
  });

  document.getElementById("load-repos").addEventListener("click",
    withErrorHandling(loadRepos, "repository"));
  document.getElementById("test-connection").addEventListener("click",
    withErrorHandling(testConnection, "repository"));
  document.getElementById("export-data").addEventListener("click",
    withErrorHandling(exportData, "data"));
  document.getElementById("import-data").addEventListener("change",
    withErrorHandling(importData, "data"));
  document.getElementById("wipe-data").addEventListener("click",
    withErrorHandling(wipeData, "data"));
}

// ── Status checks ──────────────────────────────────────────────────
function renderStatusChecks() {
  statusChecks.innerHTML = STATUSES.map((status) => `
    <label class="check-row">
      <input type="checkbox" name="syncStatus" value="${escapeHtml(status)}">
      <span>${escapeHtml(status)}</span>
    </label>
  `).join("");
}

// ── Config load / read ─────────────────────────────────────────────
async function loadConfig() {
  const response = await sendMessage({ type: "LEETGIT_GET_CONFIG" });
  loadedConfig = response.config;
  tokenInput.value = loadedConfig.token || "";
  branchInput.value = loadedConfig.repo.branch || "main";
  subfolderInput.value = loadedConfig.repo.subfolder || "";
  skipDuplicatesInput.checked = Boolean(loadedConfig.settings.skipDuplicates);
  commitTemplateInput.value = loadedConfig.settings.commitMessageTemplate || "";
  for (const input of commitModeInputs) {
    input.checked = input.value === (loadedConfig.settings.commitMessageMode || "template");
  }
  glowInput.checked = Boolean(loadedConfig.settings.glowOnSuccess);
  failureInput.checked = Boolean(loadedConfig.settings.notifyOnFailure);
  for (const input of statusChecks.querySelectorAll("input")) {
    input.checked = loadedConfig.settings.syncStatuses.includes(input.value);
  }
  if (loadedConfig.repo.owner && loadedConfig.repo.name) {
    setRepoOptions([{
      owner: loadedConfig.repo.owner,
      name: loadedConfig.repo.name,
      fullName: `${loadedConfig.repo.owner}/${loadedConfig.repo.name}`,
      defaultBranch: loadedConfig.repo.branch,
      private: false
    }]);
  }
}

function readFormConfig() {
  const selectedRepo = repos.find((repo) => repo.fullName === repoSelect.value);
  const [owner = loadedConfig?.repo?.owner || "", name = loadedConfig?.repo?.name || ""] =
    repoSelect.value.split("/");
  return {
    token: tokenInput.value.trim(),
    repo: {
      owner: selectedRepo?.owner || owner,
      name: selectedRepo?.name || name,
      branch: branchInput.value.trim() || selectedRepo?.defaultBranch || "main",
      subfolder: subfolderInput.value.trim()
    },
    settings: {
      syncStatuses: [...statusChecks.querySelectorAll("input:checked")].map((i) => i.value),
      skipDuplicates: skipDuplicatesInput.checked,
      commitMessageMode: document.querySelector('input[name="commit-mode"]:checked')?.value || "template",
      commitMessageTemplate: commitTemplateInput.value.trim() || "Solve {number}. {title} ({language})",
      glowOnSuccess: glowInput.checked,
      notifyOnFailure: failureInput.checked,
      paused: loadedConfig?.settings?.paused ?? false
    }
  };
}

// ── Repo actions ───────────────────────────────────────────────────
async function loadRepos() {
  setSectionStatus("repository", "Loading repositories...");
  const response = await sendMessage({ type: "LEETGIT_LIST_REPOS", token: tokenInput.value.trim() });
  setRepoOptions(response.repos);
  setSectionStatus("repository", `${response.repos.length} repositor${response.repos.length !== 1 ? "ies" : "y"} loaded.`);
}

function setRepoOptions(nextRepos) {
  repos = nextRepos;
  const current = loadedConfig?.repo?.owner && loadedConfig?.repo?.name
    ? `${loadedConfig.repo.owner}/${loadedConfig.repo.name}`
    : repoSelect.value;
  repoSelect.innerHTML = `<option value="">Choose a repository</option>${repos.map((repo) =>
    `<option value="${escapeAttribute(repo.fullName)}">${escapeHtml(repo.fullName)}${repo.private ? " · private" : ""}</option>`
  ).join("")}`;
  if (current) repoSelect.value = current;
}

async function testConnection() {
  setSectionStatus("repository", "Testing connection...");
  const response = await sendMessage({ type: "LEETGIT_TEST_CONNECTION", config: readFormConfig() });
  setSectionStatus("repository", `✓ Connected to ${response.result.owner}/${response.result.name}.`);
}

// ── Data actions ───────────────────────────────────────────────────
async function exportData() {
  const response = await sendMessage({ type: "LEETGIT_EXPORT_DATA" });
  const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leetgit-settings.json";
  a.click();
  URL.revokeObjectURL(url);
  setSectionStatus("data", "Settings exported successfully.");
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  const response = await sendMessage({ type: "LEETGIT_IMPORT_DATA", data });
  loadedConfig = response.config;
  await loadConfig();
  setSectionStatus("data", "Settings imported successfully.");
}

async function wipeData() {
  if (!confirm("Wipe all LeetGit data from this browser? This cannot be undone.")) return;
  const response = await sendMessage({ type: "LEETGIT_WIPE_DATA" });
  loadedConfig = response.config;
  await loadConfig();
  setSectionStatus("data", "Extension data wiped.");
}

// ── Utilities ──────────────────────────────────────────────────────
async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "LeetGit request failed.");
  return response;
}

function withErrorHandling(fn, section = "repository") {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      setSectionStatus(section, error.message, true);
    }
  };
}

function setSectionStatus(section, message, isError = false) {
  const el = document.querySelector(`[data-message-for="${section}"]`);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", isError);
  clearTimeout(el._leetgitTimer);
  el._leetgitTimer = setTimeout(() => {
    el.textContent = "";
    el.classList.remove("is-error");
  }, isError ? 7000 : 4500);
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
