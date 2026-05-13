const obSteps = document.querySelectorAll(".ob-step");
const progressSteps = document.querySelectorAll(".progress-step");
const progressConnectors = document.querySelectorAll(".progress-connector");
const stepCard = document.querySelector(".step-card");
const successCard = document.getElementById("ob-success");

let repos = [];

init();

function init() {
  // Step 1
  document.getElementById("ob-next-1").addEventListener("click", () => goToStep(2));

  // Step 2
  document.getElementById("ob-back-2").addEventListener("click", () => goToStep(1));
  document.getElementById("ob-next-2").addEventListener("click", () => goToStep(3));

  // Step 3
  document.getElementById("ob-back-3").addEventListener("click", () => goToStep(2));
  document.getElementById("ob-toggle-token").addEventListener("click", toggleToken);
  document.getElementById("ob-load-repos").addEventListener("click", handleLoadRepos);
  document.getElementById("ob-repo").addEventListener("change", handleRepoChange);
  document.getElementById("ob-finish").addEventListener("click", handleFinish);

  goToStep(1);
}

function goToStep(n) {
  // Show the right step panel
  for (const step of obSteps) {
    step.classList.toggle("is-active", step.dataset.step === String(n));
  }

  // Update progress dots
  for (const pStep of progressSteps) {
    const sn = Number(pStep.dataset.step);
    pStep.classList.remove("done", "active");
    if (sn < n) pStep.classList.add("done");
    else if (sn === n) pStep.classList.add("active");
  }

  // Update connectors
  for (const conn of progressConnectors) {
    conn.classList.toggle("done", Number(conn.dataset.after) < n);
  }

  clearStatus();
}

function toggleToken() {
  const input = document.getElementById("ob-token");
  const btn = document.getElementById("ob-toggle-token");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  btn.textContent = hidden ? "Hide" : "Show";
}

async function handleLoadRepos() {
  const token = document.getElementById("ob-token").value.trim();
  if (!token) {
    setStatus("Please paste your GitHub token first.", true);
    return;
  }

  const btn = document.getElementById("ob-load-repos");
  btn.disabled = true;
  btn.textContent = "Loading...";
  setStatus("Fetching your repositories...", false);

  try {
    const response = await sendMessage({ type: "LEETGIT_LIST_REPOS", token });
    repos = response.repos;

    const select = document.getElementById("ob-repo");
    select.innerHTML = `<option value="">Choose a repository</option>` +
      repos.map((r) =>
        `<option value="${escapeAttribute(r.fullName)}">${escapeHtml(r.fullName)}${r.private ? " · private" : ""}</option>`
      ).join("");

    document.getElementById("ob-repo-section").hidden = false;
    setStatus(`${repos.length} repositor${repos.length !== 1 ? "ies" : "y"} loaded. Choose one below.`, false);
    select.focus();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Load repos";
  }
}

function handleRepoChange() {
  const repoFullName = document.getElementById("ob-repo").value;
  const branchSection = document.getElementById("ob-branch-section");

  if (!repoFullName) {
    branchSection.hidden = true;
    return;
  }

  const repo = repos.find((r) => r.fullName === repoFullName);
  if (repo?.defaultBranch) {
    document.getElementById("ob-branch").value = repo.defaultBranch;
  }
  branchSection.hidden = false;
}

async function handleFinish() {
  const token = document.getElementById("ob-token").value.trim();
  const repoFullName = document.getElementById("ob-repo").value;
  const branch = document.getElementById("ob-branch").value.trim() || "main";

  if (!token) {
    setStatus("Please paste your GitHub token.", true);
    return;
  }
  if (!repoFullName) {
    setStatus("Please select a repository.", true);
    return;
  }

  const repo = repos.find((r) => r.fullName === repoFullName);
  const [ownerFallback = "", nameFallback = ""] = repoFullName.split("/");

  const btn = document.getElementById("ob-finish");
  btn.disabled = true;
  btn.textContent = "Saving...";
  setStatus("Saving configuration...", false);

  try {
    await sendMessage({
      type: "LEETGIT_SAVE_CONFIG",
      config: {
        token,
        repo: {
          owner: repo?.owner || ownerFallback,
          name: repo?.name || nameFallback,
          branch,
          subfolder: ""
        }
      }
    });
    showSuccess();
  } catch (error) {
    setStatus(error.message, true);
    btn.disabled = false;
    btn.textContent = "Save & finish";
  }
}

function showSuccess() {
  stepCard.hidden = true;

  // Mark all steps done
  for (const pStep of progressSteps) {
    pStep.classList.remove("active");
    pStep.classList.add("done");
  }
  for (const conn of progressConnectors) {
    conn.classList.add("done");
  }

  successCard.classList.add("visible");
}

function setStatus(message, isError) {
  const el = document.getElementById("ob-status");
  if (!el) return;
  el.textContent = message;
  el.className = `step-status visible ${isError ? "step-status-err" : "step-status-ok"}`;
}

function clearStatus() {
  const el = document.getElementById("ob-status");
  if (!el) return;
  el.textContent = "";
  el.className = "step-status";
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "LeetGit request failed.");
  return response;
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
