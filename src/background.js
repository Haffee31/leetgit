let CONFIG = {};
try {
  ({ CONFIG } = await import("./config.js"));
} catch { /* production — config.js not present */ }
import {
  exportExtensionData,
  getStoredConfig,
  importExtensionData,
  saveStoredConfig,
  wipeExtensionData
} from "./settings.js";
import {
  buildHistoryPath,
  buildSubmissionFilename,
  buildSubmissionPath,
  extractCodeHash,
  extractNotesHash,
  normalizeLeetCodeStatus,
  parseHistoryEntries,
  parseMemoryMb,
  parsePercentile,
  parseRuntimeMs,
  renderCommitMessage,
  renderHistoryMarkdown,
  renderSolutionMarkdown
} from "./shared.js";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LEETGIT_GET_CONFIG") {
    getStoredConfig()
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_OPEN_SETTINGS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "LEETGIT_SAVE_CONFIG") {
    saveStoredConfig(message.config || {})
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_LIST_REPOS") {
    listRepos(message.token)
      .then((repos) => sendResponse({ ok: true, repos }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_TEST_CONNECTION") {
    testConnection(message.config)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_EXPORT_DATA") {
    exportExtensionData()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_IMPORT_DATA") {
    importExtensionData(message.data || {})
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_WIPE_DATA") {
    wipeExtensionData()
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_GET_STATE") {
    getUiState()
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_RETRY_LAST_FAILED") {
    retryLastFailed(sender.tab?.id)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LEETGIT_QUICK_DUPLICATE_CHECK") {
    quickDuplicateCheck(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(() => sendResponse({ ok: true, isDuplicate: false }));
    return true;
  }

  if (message?.type === "LEETGIT_SET_PAUSED") {
    getStoredConfig()
      .then((config) => saveStoredConfig({ settings: { ...config.settings, paused: message.paused } }))
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type !== "LEETGIT_SUBMISSION_CAPTURED") return false;

  syncCapturedSubmission(message.payload, sender.tab?.id)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      console.error("[LeetGit] sync failed", error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

let syncLock = Promise.resolve();

const headCache = new Map(); // key → { commitSha, treeSha, capturedAt }
const HEAD_CACHE_TTL_MS = 60 * 60 * 1000;

async function syncCapturedSubmission(raw, tabId = null) {
  return new Promise((resolve, reject) => {
    syncLock = syncLock
      .catch(() => {})
      .then(() => syncCapturedSubmissionCore(raw, tabId))
      .then(resolve, reject);
  });
}

async function syncCapturedSubmissionCore(raw, tabId = null) {
  const config = await getRuntimeConfig();
  if (config.settings.paused) {
    const result = { skipped: true, reason: "paused" };
    notifyTab(tabId, { type: "LEETGIT_SYNC_SKIPPED", ...result, recentSyncs: await getRecentSyncs() });
    return result;
  }
  const status = normalizeLeetCodeStatus(raw.status);
  if (!status) {
    const result = { skipped: true, reason: "unsupported-status", status: raw.status };
    notifyTab(tabId, { type: "LEETGIT_SYNC_SKIPPED", ...result, recentSyncs: await getRecentSyncs() });
    return result;
  }
  if (!config.settings.syncStatuses.includes(status)) {
    const result = { skipped: true, reason: "status-not-enabled", status };
    notifyTab(tabId, { type: "LEETGIT_SYNC_SKIPPED", ...result, recentSyncs: await getRecentSyncs() });
    return result;
  }

  let submission = null;
  try {
    const metadata = await fetchProblemMetadata(raw.titleSlug);
    const codeHash = await sha256(raw.code);
    const notesHash = await sha256(raw.notes || "");
    submission = {
      problemNumber: Number(metadata.problemNumber),
      title: metadata.title,
      titleSlug: raw.titleSlug,
      difficulty: metadata.difficulty,
      topics: metadata.topics,
      problemUrl: `https://leetcode.com/problems/${raw.titleSlug}/`,
      language: raw.language,
      status,
      runtimeMs: parseRuntimeMs(raw.runtime),
      runtimePercentile: parsePercentile(raw.runtimePercentile),
      memoryMb: parseMemoryMb(raw.memory),
      memoryPercentile: parsePercentile(raw.memoryPercentile),
      code: raw.code,
      notes: raw.notes || "",
      submittedAt: raw.submittedAt || new Date().toISOString(),
      submissionId: String(raw.submissionId),
      commitMessage: raw.commitMessage || "",
      codeHash,
      notesHash
    };

    notifyTab(tabId, {
      type: "LEETGIT_SYNC_STARTED",
      title: `${submission.problemNumber}. ${submission.title}`
    });

    const synced = await syncToGitHub(submission, config);
    await clearLastFailure(raw);
    await rememberRecentSync(submission, synced);
    if (!synced.skipped) {
      retryQueuedFailures(raw.submissionId);
    }
    const recentSyncs = await getRecentSyncs();
    notifyTab(tabId, synced.skipped
      ? { type: "LEETGIT_SYNC_SKIPPED", reason: synced.reason, recentSyncs }
      : {
          type: "LEETGIT_SYNC_COMPLETE",
          title: `${submission.problemNumber}. ${submission.title}`,
          language: submission.language,
          status: submission.status,
          recentSyncs
        });
    return synced;
  } catch (error) {
    const friendlyMessage = friendlyErrorMessage(error, submission);
    const failure = await rememberFailure(raw, submission, friendlyMessage);
    if (config.settings.notifyOnFailure) {
      showFailureNotification(friendlyMessage, submission);
    }
    notifyTab(tabId, {
      type: "LEETGIT_SYNC_ERROR",
      error: friendlyMessage,
      failure
    });
    throw new Error(friendlyMessage);
  }
}

function assertRuntimeConfigured(config) {
  const missing = [];
  if (!config.token || config.token.includes("replace_me")) missing.push("GitHub token");
  if (!config.repo.owner || config.repo.owner.includes("your-")) missing.push("repo owner");
  if (!config.repo.name) missing.push("repo name");
  if (missing.length) {
    throw new Error(`Configure LeetGit before syncing: ${missing.join(", ")}`);
  }
}

async function getRuntimeConfig() {
  const config = await getStoredConfig();
  assertRuntimeConfigured(config);
  return config;
}

async function fetchProblemMetadata(titleSlug) {
  const cached = await chromeStorageGet("problemCache");
  if (cached?.[titleSlug]) return cached[titleSlug];

  const response = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: `query questionData($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          title
          difficulty
          topicTags { name }
        }
      }`,
      variables: { titleSlug }
    })
  });

  if (!response.ok) throw new Error(`LeetCode metadata request failed: ${response.status}`);
  const json = await response.json();
  const question = json?.data?.question;
  if (!question) throw new Error(`LeetCode metadata missing for ${titleSlug}`);

  const metadata = {
    problemNumber: Number(question.questionId),
    title: question.title,
    difficulty: question.difficulty,
    topics: question.topicTags.map((tag) => tag.name)
  };
  await chromeStorageSet({ problemCache: { ...(cached || {}), [titleSlug]: metadata } });
  return metadata;
}

async function syncToGitHub(submission, config) {
  let branch = await getBranchSnapshot(config);

  const filename = buildSubmissionFilename(submission);
  const submissionPath = buildSubmissionPath(submission, config.repo.subfolder);
  const historyPath = buildHistoryPath(submission, config.repo.subfolder);
  let historyMarkdown = await readBlobFromTree(branch.tree, historyPath, config);
  let previousEntries = parseHistoryEntries(historyMarkdown);

  if (config.settings.skipDuplicates && previousEntries.length) {
    const latestMarkdown = await readBlobFromTree(branch.tree, siblingPath(historyPath, previousEntries[0].file), config);
    const latestHash = extractCodeHash(latestMarkdown);
    const latestNotesHash = extractNotesHash(latestMarkdown) ?? "0".repeat(64);
    const latestStatus = previousEntries[0].status.replace(/^[✅❌]\s*/, "");
    if (latestHash === submission.codeHash && latestNotesHash === submission.notesHash && latestStatus === submission.status) {
      const duplicatePath = siblingPath(historyPath, previousEntries[0].file);
      return {
        skipped: true,
        reason: "duplicate",
        submissionPath: duplicatePath,
        githubUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/blob/${config.repo.branch}/${duplicatePath}`
      };
    }
  }

  const solutionMarkdown = renderSolutionMarkdown(submission);
  const commitMessage = getCommitMessage(submission, config);

  // Create both blobs in parallel — they are independent.
  let [solutionBlob, historyBlob] = await Promise.all([
    createBlob(solutionMarkdown, config),
    createBlob(renderHistoryMarkdown(submission, previousEntries, filename), config)
  ]);

  // Retry loop: on 422 the local HEAD cache is invalidated so the re-read bypasses
  // any eventual-consistency lag on GitHub's ref endpoint.
  const RETRY_DELAYS = [5000, 10000];
  const key = headCacheKey(config);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const nextTree = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/trees`, {
      token: config.token,
      method: "POST",
      body: {
        base_tree: branch.treeSha,
        tree: [
          { path: submissionPath, mode: "100644", type: "blob", sha: solutionBlob.sha },
          { path: historyPath, mode: "100644", type: "blob", sha: historyBlob.sha }
        ]
      }
    });
    const nextCommit = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/commits`, {
      token: config.token,
      method: "POST",
      body: {
        message: commitMessage,
        tree: nextTree.sha,
        parents: [branch.commitSha]
      }
    });

    try {
      const patched = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/refs/heads/${config.repo.branch}`, {
        token: config.token,
        method: "PATCH",
        body: { sha: nextCommit.sha, force: false }
      });
      // Use the PATCH response as the authoritative new HEAD — avoids any read-after-write lag.
      headCache.set(key, { commitSha: patched.object.sha, treeSha: nextTree.sha, capturedAt: Date.now() });
      await persistHead(config, patched.object.sha, nextTree.sha);
      return {
        skipped: false,
        commitSha: patched.object.sha,
        submissionPath,
        historyPath,
        githubUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/blob/${config.repo.branch}/${submissionPath}`
      };
    } catch (patchError) {
      if (!isStaleRefError(patchError) || attempt >= 3) throw patchError;

      // Invalidate cached HEAD so the re-read goes through the cold path.
      await invalidateHead(config);
      await sleep(RETRY_DELAYS[attempt - 1]);
      branch = await getBranchSnapshot(config);

      // If our file already landed (concurrent sync), return as skipped.
      const freshHistory = await readBlobFromTree(branch.tree, historyPath, config);
      const freshEntries = parseHistoryEntries(freshHistory);
      if (freshEntries.some((e) => e.file === filename)) {
        const dupPath = siblingPath(historyPath, filename);
        return {
          skipped: true,
          reason: "duplicate",
          submissionPath: dupPath,
          githubUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/blob/${config.repo.branch}/${dupPath}`
        };
      }
      previousEntries = freshEntries;
      historyBlob = await createBlob(renderHistoryMarkdown(submission, previousEntries, filename), config);
    }
  }
}

function headCacheKey(config) {
  return `${config.repo.owner}/${config.repo.name}#${config.repo.branch}`;
}

async function loadPersistedHead(config) {
  const stored = await chromeStorageGet("lastSyncedHead");
  if (!stored || stored.key !== headCacheKey(config)) return null;
  if (Date.now() - stored.ts > HEAD_CACHE_TTL_MS) return null;
  return { commitSha: stored.commitSha, treeSha: stored.treeSha };
}

async function persistHead(config, commitSha, treeSha) {
  try {
    await chromeStorageSet({ lastSyncedHead: { key: headCacheKey(config), commitSha, treeSha, ts: Date.now() } });
  } catch {}
}

async function invalidateHead(config) {
  headCache.delete(headCacheKey(config));
  try {
    await chrome.storage.local.remove("lastSyncedHead");
  } catch {}
}

async function getBranchSnapshot(config) {
  const key = headCacheKey(config);

  const mem = headCache.get(key);
  if (mem && Date.now() - mem.capturedAt < HEAD_CACHE_TTL_MS) {
    try {
      return await readBranchSnapshotHot(config, mem);
    } catch {
      headCache.delete(key);
    }
  }

  const persisted = await loadPersistedHead(config);
  if (persisted) {
    try {
      const snapshot = await readBranchSnapshotHot(config, persisted);
      headCache.set(key, { ...persisted, capturedAt: Date.now() });
      return snapshot;
    } catch {
      await invalidateHead(config);
    }
  }

  return readBranchSnapshotCold(config);
}

async function readBranchSnapshotCold(config) {
  try {
    return await fetchBranchSnapshot(config.repo.branch, config);
  } catch (error) {
    if (!isEmptyRepositoryError(error)) throw error;
    await initializeEmptyRepository(config);
    return fetchBranchSnapshot(config.repo.branch, config);
  }
}

async function fetchBranchSnapshot(branchName, config) {
  // Use the git-database ref endpoint — it works reliably with Contents-scoped
  // fine-grained tokens and returns 409 for empty repos (handled by the caller).
  const ref = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/ref/heads/${encodeURIComponent(branchName)}`, { token: config.token });
  const baseCommit = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/commits/${ref.object.sha}`, { token: config.token });
  const tree = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/trees/${baseCommit.tree.sha}?recursive=1`, { token: config.token });
  return { commitSha: ref.object.sha, treeSha: baseCommit.tree.sha, tree };
}

async function readBranchSnapshotHot(config, cached) {
  const tree = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/trees/${cached.treeSha}?recursive=1`, { token: config.token });
  return { commitSha: cached.commitSha, treeSha: cached.treeSha, tree };
}

async function initializeEmptyRepository(config) {
  const repo = await github(`/repos/${config.repo.owner}/${config.repo.name}`, { token: config.token });
  const defaultBranch = repo.default_branch || config.repo.branch || "main";
  const initializerPath = ".leetgit-init.md";
  const initializerContent = "# LeetGit\n\nRepository initialized by LeetGit.\n";

  let created;
  try {
    created = await createContentFile(initializerPath, initializerContent, config.repo.branch, config);
  } catch (error) {
    if (!isMissingBranchError(error)) throw error;
    created = await createContentFile(initializerPath, initializerContent, null, config);
  }

  if (config.repo.branch && config.repo.branch !== defaultBranch) {
    await ensureConfiguredBranch(created.commit.sha, config);
  }
}

async function ensureConfiguredBranch(commitSha, config) {
  try {
    await github(`/repos/${config.repo.owner}/${config.repo.name}/git/ref/heads/${encodeURIComponent(config.repo.branch)}`, { token: config.token });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github(`/repos/${config.repo.owner}/${config.repo.name}/git/refs`, {
      token: config.token,
      method: "POST",
      body: {
        ref: `refs/heads/${config.repo.branch}`,
        sha: commitSha
      }
    });
  }
}

async function createContentFile(path, content, branchName, config) {
  return github(`/repos/${config.repo.owner}/${config.repo.name}/contents/${encodeURIComponent(path)}`, {
    token: config.token,
    method: "PUT",
    body: {
      message: "Initialize LeetGit repository",
      content: encodeBase64(content),
      ...(branchName ? { branch: branchName } : {})
    }
  });
}

async function retryLastFailed(tabId = null) {
  const config = await getStoredConfig();
  if (config.settings.paused) throw new Error("LeetGit is paused. Resume to retry.");
  const queue = (await chromeStorageGet("retryQueue")) || [];
  const lastFailure = queue[0];
  if (!lastFailure?.raw) throw new Error("No failed sync to retry.");
  return syncCapturedSubmission(lastFailure.raw, tabId);
}

async function retryQueuedFailures(exceptSubmissionId = null) {
  const config = await getStoredConfig();
  if (config.settings.paused) return;
  const queue = (await chromeStorageGet("retryQueue")) || [];
  const next = queue.find((failure) => failure.raw?.submissionId !== exceptSubmissionId);
  if (!next) return;
  syncCapturedSubmission(next.raw).catch((error) => {
    console.warn("[LeetGit] queued retry failed", error);
  });
}

async function createBlob(content, config) {
  return github(`/repos/${config.repo.owner}/${config.repo.name}/git/blobs`, {
    token: config.token,
    method: "POST",
    body: {
      content,
      encoding: "utf-8"
    }
  });
}

async function readBlobFromTree(tree, path, config) {
  const entry = tree.tree.find((item) => item.path === path && item.type === "blob");
  if (!entry) return "";
  const blob = await github(`/repos/${config.repo.owner}/${config.repo.name}/git/blobs/${entry.sha}`, { token: config.token });
  if (blob.encoding !== "base64") return blob.content || "";
  return decodeBase64(blob.content);
}

function siblingPath(historyPath, filename) {
  return `${historyPath.split("/").slice(0, -1).join("/")}/${filename}`;
}

function decodeBase64(content) {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(content) {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${options.token || CONFIG.githubToken}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new GitHubApiError(response.status, text);
  }
  await rememberTokenExpiration(response);
  return response.json();
}

async function rememberTokenExpiration(response) {
  const expiresAt = response.headers.get("github-authentication-token-expiration");
  if (!expiresAt) return;
  await chrome.storage.local.set({ tokenMeta: { expiresAt } });
}

async function listRepos(token) {
  const githubToken = token || (await getStoredConfig()).token;
  if (!githubToken) throw new Error("Paste a GitHub token first.");
  const repos = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await github(`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`, { token: githubToken });
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.map((repo) => ({
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
    htmlUrl: repo.html_url
  }));
}

async function testConnection(configPatch = null) {
  const stored = await getStoredConfig();
  const config = {
    settings: { ...stored.settings, ...(configPatch?.settings || {}) },
    token: configPatch?.token ?? stored.token,
    repo: { ...stored.repo, ...(configPatch?.repo || {}) }
  };
  assertRuntimeConfigured(config);
  const repo = await github(`/repos/${config.repo.owner}/${config.repo.name}`, { token: config.token });
  return {
    owner: repo.owner.login,
    name: repo.name,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url
  };
}

class GitHubApiError extends Error {
  constructor(status, body) {
    super(`GitHub API ${status}: ${body}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.body = body;
  }
}

function isEmptyRepositoryError(error) {
  return error.status === 409 && /Git Repository is empty/i.test(error.body || error.message || "");
}

function isMissingBranchError(error) {
  return (error.status === 404 || error.status === 422) && /branch|reference|not found/i.test(error.body || error.message || "");
}

function isStaleRefError(error) {
  return error.status === 422 && /not a fast forward/i.test(error.body || error.message || "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function chromeStorageGet(key) {
  return chrome.storage.local.get(key).then((result) => result[key]);
}

async function chromeStorageSet(value) {
  return chrome.storage.local.set(value);
}

async function getUiState() {
  const [recentSyncs, retryQueue] = await Promise.all([
    getRecentSyncs(),
    chromeStorageGet("retryQueue")
  ]);
  return {
    recentSyncs,
    lastFailure: retryQueue?.[0] || null
  };
}

async function getRecentSyncs() {
  return (await chromeStorageGet("recentSyncs")) || [];
}

async function rememberRecentSync(submission, result) {
  const recentSyncs = await getRecentSyncs();
  recentSyncs.unshift({
    titleSlug: submission.titleSlug,
    problemNumber: submission.problemNumber,
    title: submission.title,
    language: submission.language,
    status: submission.status,
    submittedAt: submission.submittedAt,
    problemUrl: submission.problemUrl || null,
    githubUrl: result.githubUrl || null,
    submissionPath: result.submissionPath || null,
    duplicate: result.reason === "duplicate",
    skipped: result.skipped || false,
    codeHash: submission.codeHash,
    notesHash: submission.notesHash
  });
  await chromeStorageSet({ recentSyncs: recentSyncs.slice(0, 20) });
}

async function quickDuplicateCheck({ titleSlug, status, codeHash, notesHash }) {
  const recentSyncs = await getRecentSyncs();
  const last = recentSyncs.find((s) => s.titleSlug === titleSlug && !s.skipped);
  if (!last) return { isDuplicate: false };
  return {
    isDuplicate: last.codeHash === codeHash && last.notesHash === notesHash && last.status === status
  };
}

function getCommitMessage(submission, config) {
  const customMessage = String(submission.commitMessage || "").trim();
  if (config.settings.commitMessageMode === "prompt" && customMessage) return customMessage;
  return renderCommitMessage(config.settings.commitMessageTemplate, submission);
}

async function rememberFailure(raw, submission, errorMessage) {
  const queue = (await chromeStorageGet("retryQueue")) || [];
  const failure = {
    raw,
    error: errorMessage,
    failedAt: new Date().toISOString(),
    title: submission ? `${submission.problemNumber}. ${submission.title}` : raw.titleSlug,
    language: submission?.language || raw.language || "",
    status: submission?.status || raw.status || ""
  };
  await chromeStorageSet({ retryQueue: [failure, ...queue].slice(0, 10) });
  return failure;
}

async function clearLastFailure(raw) {
  const queue = (await chromeStorageGet("retryQueue")) || [];
  if (!queue.length) return;
  await chromeStorageSet({
    retryQueue: queue.filter((failure) => failure.raw?.submissionId !== raw.submissionId)
  });
}

function notifyTab(tabId, message) {
  if (!tabId) return;
  chrome.tabs?.sendMessage(tabId, message).catch(() => {});
}

function showFailureNotification(message, submission) {
  chrome.notifications?.create({
    type: "basic",
    iconUrl: "icons/icon.svg",
    title: "LeetGit sync failed",
    message: submission ? `${submission.problemNumber}. ${submission.title}: ${message}` : message
  });
}

function friendlyErrorMessage(error, submission = null) {
  const body = error.body || error.message || "";
  if (error.status === 401) return "Your GitHub token is invalid. Click Settings to update it.";
  if (error.status === 403 && /rate limit/i.test(body)) return "GitHub rate limit hit. Retrying later.";
  if (error.status === 403) return "GitHub denied access. Check that your token has Contents read/write permission for this repo.";
  if (error.status === 404 && submission) return `The connected repo was not found, or the token cannot access it.`;
  if (error.status === 409 && /empty/i.test(body)) return "The connected GitHub repository is empty and could not be initialized.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(body)) return "Offline or network unavailable. Submission queued.";
  return error.message || "Sync failed. Click for details.";
}
