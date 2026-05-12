(() => {
  if (window.__leetGitInjected) return;
  window.__leetGitInjected = true;

  const pendingSubmissions = new Map();
  const completedSubmissions = new Set();
  const activePolls = new Set();
  const problemNotes = new Map();

  const SUBMIT_PATTERN = /\/problems\/([^/]+)\/submit\/?/;
  const CHECK_PATTERN = /\/submissions\/detail\/(\d+)\/check\/?/;
  const GRAPHQL_PATTERN = /\/graphql\/?$/;

  function parseBody(body) {
    if (!body) return {};
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return Object.fromEntries(new URLSearchParams(body));
      }
    }
    if (body instanceof FormData) {
      return Object.fromEntries(body.entries());
    }
    if (body instanceof URLSearchParams) {
      return Object.fromEntries(body.entries());
    }
    return {};
  }

  function getUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function getTitleSlugFromLocation() {
    const match = location.pathname.match(/^\/problems\/([^/]+)/);
    return match ? match[1] : "";
  }

  function postDiagnostic(stage, detail = {}) {
    window.postMessage({
      type: "LEETGIT_PAGE_DIAGNOSTIC",
      stage,
      detail
    });
  }

  function rememberSubmittedCode(url, requestBody) {
    const parsed = parseBody(requestBody);

    let titleSlug = "";
    let code = "";
    let language = "";

    const submitMatch = url.match(SUBMIT_PATTERN);
    if (submitMatch) {
      titleSlug = submitMatch[1] || getTitleSlugFromLocation();
      code = parsed.typed_code || parsed.typedCode || parsed.code || "";
      language = parsed.lang || parsed.language || "";
    } else if (isSubmitGraphQl(url, parsed)) {
      const variables = parsed.variables || {};
      titleSlug = variables.titleSlug || parsed.titleSlug || getTitleSlugFromLocation();
      code = variables.typedCode || variables.typed_code || variables.code || parsed.typedCode || parsed.typed_code || "";
      language = variables.lang || variables.language || parsed.lang || "";
    } else {
      return;
    }

    if (!titleSlug || !code || !language) return;

    pendingSubmissions.set(titleSlug, {
      titleSlug,
      code,
      language,
      submittedAt: new Date().toISOString()
    });
    postDiagnostic("submit-seen", { titleSlug, language });
  }

  async function handleSubmitResponse(url, response) {
    const data = await readJson(response);
    const parsedRequest = response.__leetGitRequestBody ? parseBody(response.__leetGitRequestBody) : {};
    const match = url.match(SUBMIT_PATTERN);
    if (!match && !isSubmitGraphQl(url, parsedRequest)) return;
    const titleSlug = match?.[1] || parsedRequest.variables?.titleSlug || parsedRequest.titleSlug || getTitleSlugFromLocation();
    const pending = pendingSubmissions.get(titleSlug);
    if (!pending) return;
    const submissionId =
      data?.submission_id ||
      data?.submissionId ||
      data?.id ||
      data?.data?.submitQuestion?.submission_id ||
      data?.data?.submitQuestion?.submissionId;
    if (submissionId) {
      pendingSubmissions.set(String(submissionId), pending);
      postDiagnostic("submission-id-seen", { titleSlug, submissionId: String(submissionId) });
      pollSubmissionResult(String(submissionId));
    }
  }

  async function handleGraphQlNoteResponse(url, requestBody, response) {
    if (!GRAPHQL_PATTERN.test(url)) return;
    const parsed = parseBody(requestBody);
    if (parsed.operationName !== "questionNote") return;
    const data = await readJson(response);
    const raw = data?.data?.question?.note ?? null;
    if (raw == null) return;
    const titleSlug = parsed.variables?.titleSlug || getTitleSlugFromLocation();
    if (titleSlug) problemNotes.set(titleSlug, stripHtml(raw));
  }

  async function handleCheckResponse(url, response) {
    const match = url.match(CHECK_PATTERN);
    if (!match) return;
    const submissionId = match[1];
    const pending = pendingSubmissions.get(submissionId) || pendingSubmissions.get(getTitleSlugFromLocation());
    if (!pending) return;

    const data = await readJson(response);
    if (!data || data.state !== "SUCCESS") return;

    emitSubmissionResult(submissionId, pending, data);
  }

  async function emitSubmissionResult(submissionId, pending, data) {
    if (completedSubmissions.has(String(submissionId))) return;
    completedSubmissions.add(String(submissionId));

    const status = data.status_msg || data.status || "";
    postDiagnostic("check-complete", { submissionId, status });

    const notes = await fetchProblemNote(pending.titleSlug);

    window.postMessage({
      type: "LEETGIT_PAGE_SUBMISSION_CAPTURED",
      payload: {
        titleSlug: pending.titleSlug,
        language: pending.language,
        code: pending.code,
        submittedAt: pending.submittedAt,
        submissionId,
        status,
        runtime: data.status_runtime || data.runtime || null,
        runtimePercentile: data.runtime_percentile ?? data.runtimePercentile ?? null,
        memory: data.status_memory || data.memory || null,
        memoryPercentile: data.memory_percentile ?? data.memoryPercentile ?? null,
        notes
      }
    });

    pendingSubmissions.delete(submissionId);
  }

  async function fetchProblemNote(titleSlug) {
    if (problemNotes.has(titleSlug)) return problemNotes.get(titleSlug);
    try {
      const csrfToken = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
      const response = await originalFetch("/graphql", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrftoken": csrfToken
        },
        body: JSON.stringify({
          operationName: "questionNote",
          query: `query questionNote($titleSlug: String!) {
            question(titleSlug: $titleSlug) { note }
          }`,
          variables: { titleSlug }
        })
      });
      if (!response.ok) return "";
      const json = await response.json();
      const raw = json?.data?.question?.note || "";
      const note = stripHtml(raw);
      problemNotes.set(titleSlug, note);
      return note;
    } catch {
      return "";
    }
  }

  function stripHtml(html) {
    return String(html || "")
      .replace(/<\/p>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function pollSubmissionResult(submissionId) {
    if (activePolls.has(submissionId) || completedSubmissions.has(submissionId)) return;
    activePolls.add(submissionId);

    const pending = pendingSubmissions.get(submissionId) || pendingSubmissions.get(getTitleSlugFromLocation());
    if (!pending) {
      activePolls.delete(submissionId);
      return;
    }

    postDiagnostic("result-polling", { submissionId });

    try {
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await sleep(attempt === 0 ? 350 : 1000);
        const response = await originalFetch(`/submissions/detail/${submissionId}/check/`, {
          credentials: "include",
          headers: {
            accept: "application/json, text/plain, */*"
          }
        });
        if (!response.ok) {
          postDiagnostic("result-poll-error", { submissionId, status: response.status });
          continue;
        }

        const data = await response.json().catch(() => null);
        if (!data) continue;
        if (data.state === "SUCCESS") {
          emitSubmissionResult(submissionId, pending, data);
          break;
        }
      }
    } finally {
      activePolls.delete(submissionId);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isSubmitGraphQl(url, parsed) {
    if (!GRAPHQL_PATTERN.test(url)) return false;
    const operationName = String(parsed.operationName || "").toLowerCase();
    const query = String(parsed.query || "").toLowerCase();
    return operationName.includes("submit") || query.includes("submitquestion");
  }

  async function readRequestBody(input, init) {
    if (init?.body != null) return bodyToText(init.body);
    if (input && typeof input.clone === "function") {
      try {
        return await input.clone().text();
      } catch {
        return "";
      }
    }
    return "";
  }

  async function bodyToText(body) {
    if (!body) return "";
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return JSON.stringify(Object.fromEntries(body.entries()));
    if (body instanceof Blob) return body.text();
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
    return "";
  }

  async function readJson(response) {
    try {
      return await response.clone().json();
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function leetGitFetch(input, init = {}) {
    const url = getUrl(input);
    const requestBodyPromise = readRequestBody(input, init);
    const response = await originalFetch.apply(this, arguments);
    const requestBody = await requestBodyPromise;
    rememberSubmittedCode(url, requestBody);
    const responseWithRequest = response.clone();
    responseWithRequest.__leetGitRequestBody = requestBody;
    handleSubmitResponse(url, responseWithRequest);
    handleCheckResponse(url, response.clone());
    handleGraphQlNoteResponse(url, requestBody, response.clone());
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function leetGitOpen(_method, url) {
    this.__leetGitUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function leetGitSend(body) {
    const url = this.__leetGitUrl || "";
    bodyToText(body).then((requestBody) => rememberSubmittedCode(url, requestBody));
    this.addEventListener("load", () => {
      const fakeResponse = {
        __leetGitRequestBody: typeof body === "string" ? body : "",
        clone: () => ({
          json: async () => JSON.parse(this.responseText || "null")
        })
      };
      handleSubmitResponse(url, fakeResponse);
      handleCheckResponse(url, fakeResponse);
    });
    return originalSend.apply(this, arguments);
  };
})();
