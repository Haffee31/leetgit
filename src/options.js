const STATUSES = [
  "Accepted",
  "Wrong Answer",
  "Time Limit Exceeded",
  "Memory Limit Exceeded",
  "Runtime Error",
  "Compile Error"
];

const form = document.getElementById("settings-form");
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

let loadedConfig = null;
let repos = [];
let lastTouchedSection = "repository";

init();

async function init() {
  renderStatusChecks();
  bindEvents();
  await loadConfig();
}

function bindEvents() {
  document.getElementById("toggle-token").addEventListener("click", () => {
    const isHidden = tokenInput.type === "password";
    tokenInput.type = isHidden ? "text" : "password";
    document.getElementById("toggle-token").textContent = isHidden ? "Hide" : "Show";
  });
  document.getElementById("load-repos").addEventListener("click", withErrorHandling(loadRepos));
  document.getElementById("test-connection").addEventListener("click", withErrorHandling(testConnection));
  document.getElementById("export-data").addEventListener("click", withErrorHandling(exportData));
  document.getElementById("import-data").addEventListener("change", withErrorHandling(importData));
  document.getElementById("wipe-data").addEventListener("click", withErrorHandling(wipeData));
  form.addEventListener("submit", withErrorHandling(saveConfig));
  form.addEventListener("input", (event) => {
    lastTouchedSection = sectionForEvent(event);
  });
  form.addEventListener("change", (event) => {
    lastTouchedSection = sectionForEvent(event);
  });
  repoSelect.addEventListener("change", () => {
    const repo = repos.find((item) => item.fullName === repoSelect.value);
    if (repo) branchInput.value = repo.defaultBranch || "main";
  });
}

function renderStatusChecks() {
  statusChecks.innerHTML = STATUSES.map((status) => `
    <label class="check-row">
      <input type="checkbox" name="syncStatus" value="${escapeHtml(status)}">
      <span>${escapeHtml(status)}</span>
    </label>
  `).join("");
}

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

async function loadRepos() {
  setSectionStatus("repository", "Loading repos...");
  const response = await sendMessage({ type: "LEETGIT_LIST_REPOS", token: tokenInput.value.trim() });
  setRepoOptions(response.repos);
  setSectionStatus("repository", `Loaded ${response.repos.length} repos.`);
}

function setRepoOptions(nextRepos) {
  repos = nextRepos;
  const current = loadedConfig?.repo?.owner && loadedConfig?.repo?.name
    ? `${loadedConfig.repo.owner}/${loadedConfig.repo.name}`
    : repoSelect.value;
  repoSelect.innerHTML = `<option value="">Choose a repo</option>${repos.map((repo) => (
    `<option value="${escapeAttribute(repo.fullName)}">${escapeHtml(repo.fullName)}${repo.private ? " private" : ""}</option>`
  )).join("")}`;
  if (current) repoSelect.value = current;
}

async function testConnection() {
  setSectionStatus("repository", "Testing connection...");
  const response = await sendMessage({ type: "LEETGIT_TEST_CONNECTION", config: readFormConfig() });
  setSectionStatus("repository", `Connected to ${response.result.owner}/${response.result.name}.`);
}

async function saveConfig(event) {
  event.preventDefault();
  setSectionStatus(lastTouchedSection, "Saving settings...");
  const response = await sendMessage({ type: "LEETGIT_SAVE_CONFIG", config: readFormConfig() });
  loadedConfig = response.config;
  setSectionStatus(lastTouchedSection, "Settings saved.");
}

function readFormConfig() {
  const selectedRepo = repos.find((repo) => repo.fullName === repoSelect.value);
  const [owner = loadedConfig?.repo?.owner || "", name = loadedConfig?.repo?.name || ""] = repoSelect.value.split("/");
  return {
    token: tokenInput.value.trim(),
    repo: {
      owner: selectedRepo?.owner || owner,
      name: selectedRepo?.name || name,
      branch: branchInput.value.trim() || selectedRepo?.defaultBranch || "main",
      subfolder: subfolderInput.value.trim()
    },
    settings: {
      syncStatuses: [...statusChecks.querySelectorAll("input:checked")].map((input) => input.value),
      skipDuplicates: skipDuplicatesInput.checked,
      commitMessageMode: document.querySelector('input[name="commit-mode"]:checked')?.value || "template",
      commitMessageTemplate: commitTemplateInput.value.trim() || "Solve {number}. {title} ({language})",
      glowOnSuccess: glowInput.checked,
      notifyOnFailure: failureInput.checked
    }
  };
}

async function exportData() {
  const response = await sendMessage({ type: "LEETGIT_EXPORT_DATA" });
  const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "leetgit-settings.json";
  anchor.click();
  URL.revokeObjectURL(url);
  setSectionStatus("data", "Exported settings.");
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  const response = await sendMessage({ type: "LEETGIT_IMPORT_DATA", data });
  loadedConfig = response.config;
  await loadConfig();
  setSectionStatus("data", "Imported settings.");
}

async function wipeData() {
  if (!confirm("Wipe all LeetGit data from this browser?")) return;
  const response = await sendMessage({ type: "LEETGIT_WIPE_DATA" });
  loadedConfig = response.config;
  await loadConfig();
  setSectionStatus("data", "Extension data wiped.");
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "LeetGit request failed.");
  return response;
}

function withErrorHandling(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      setSectionStatus(event?.type === "submit" ? lastTouchedSection : sectionForEvent(event), error.message, true);
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

function sectionForEvent(event) {
  return event?.target?.closest?.("details")?.dataset?.section || "repository";
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
