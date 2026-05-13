export const DEFAULT_SETTINGS = {
  syncStatuses: ["Accepted"],
  skipDuplicates: true,
  commitMessageMode: "template",
  commitMessageTemplate: "Solve {number}. {title} ({language})",
  glowOnSuccess: true,
  notifyOnFailure: true,
  paused: false
};

export const DEFAULT_REPO = {
  owner: "",
  name: "",
  branch: "main",
  subfolder: ""
};

export async function getStoredConfig() {
  const stored = await chrome.storage.local.get(["settings", "token", "repo", "tokenMeta"]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings || {}) },
    token: stored.token || "",
    repo: { ...DEFAULT_REPO, ...(stored.repo || {}) },
    tokenMeta: stored.tokenMeta || null
  };
}

export async function saveStoredConfig({ settings, token, repo }) {
  const next = {};
  if (settings) next.settings = { ...DEFAULT_SETTINGS, ...settings };
  if (token !== undefined) next.token = token;
  if (repo) next.repo = { ...DEFAULT_REPO, ...repo };
  if (repo) {
    const prev = await chrome.storage.local.get("repo").then((r) => r.repo || {});
    if (prev.owner !== next.repo.owner || prev.name !== next.repo.name || prev.branch !== next.repo.branch) {
      await chrome.storage.local.remove("lastSyncedHead");
    }
  }
  await chrome.storage.local.set(next);
  return getStoredConfig();
}

export async function exportExtensionData() {
  return chrome.storage.local.get(null);
}

export async function importExtensionData(data) {
  const allowed = {};
  for (const key of ["settings", "token", "repo", "tokenMeta", "problemCache", "retryQueue", "recentSyncs"]) {
    if (data[key] !== undefined) allowed[key] = data[key];
  }
  await chrome.storage.local.set(allowed);
  return getStoredConfig();
}

export async function wipeExtensionData() {
  await chrome.storage.local.clear();
  return getStoredConfig();
}
