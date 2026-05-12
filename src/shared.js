export const SYNCABLE_STATUSES = new Set([
  "Accepted",
  "Wrong Answer",
  "Time Limit Exceeded",
  "Memory Limit Exceeded",
  "Runtime Error",
  "Compile Error"
]);

export function slugifyStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function padProblemNumber(problemNumber) {
  return String(problemNumber).padStart(4, "0");
}

export function formatLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    fileTime: `${pad(date.getHours())}-${pad(date.getMinutes())}`
  };
}

export function buildProblemFolder(submission) {
  return `${padProblemNumber(submission.problemNumber)}-${submission.titleSlug}`;
}

export function buildSubmissionFilename(submission) {
  const { date, fileTime } = formatLocalDateTime(new Date(submission.submittedAt));
  return `${date}_${fileTime}_${submission.language}_${slugifyStatus(submission.status)}.md`;
}

export function joinRepoPath(...parts) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function buildSubmissionPath(submission, subfolder = "") {
  return joinRepoPath(subfolder, buildProblemFolder(submission), buildSubmissionFilename(submission));
}

export function buildHistoryPath(submission, subfolder = "") {
  return joinRepoPath(subfolder, buildProblemFolder(submission), "history.md");
}

export function displayLanguage(language) {
  const labels = {
    cpp: "C++",
    java: "Java",
    python: "Python",
    python3: "Python3",
    javascript: "JavaScript",
    typescript: "TypeScript",
    csharp: "C#",
    golang: "Go",
    rust: "Rust",
    ruby: "Ruby",
    swift: "Swift",
    kotlin: "Kotlin",
    scala: "Scala",
    php: "PHP",
    dart: "Dart",
    racket: "Racket",
    erlang: "Erlang",
    elixir: "Elixir"
  };
  return labels[language] || language;
}

export function renderMetric(value, unit, percentile) {
  if (value == null) return null;
  if (percentile == null) return `${value} ${unit}`;
  return `${value} ${unit} (beats ${percentile}%)`;
}

export function renderSolutionMarkdown(submission) {
  const submitted = formatLocalDateTime(new Date(submission.submittedAt));
  const topics = submission.topics.length ? submission.topics.join(", ") : "None";
  const runtime = renderMetric(submission.runtimeMs, "ms", submission.runtimePercentile);
  const memory = renderMetric(submission.memoryMb, "MB", submission.memoryPercentile);
  const metrics = submission.status === "Accepted" && runtime && memory
    ? `\n**Runtime:** ${runtime}\n**Memory:** ${memory}\n`
    : "";

  return `# ${submission.problemNumber}. ${submission.title}

**Difficulty:** ${submission.difficulty}
**Topics:** ${topics}
**Language:** ${submission.language}
**Status:** ${submission.status}
**Submitted:** ${submitted.date} ${submitted.time} local time
${metrics}
**Problem:** ${submission.problemUrl}

<!-- leetgit:submissionId=${submission.submissionId} codeHash=${submission.codeHash} -->

## Solution

\`\`\`${submission.language}
${submission.code}
\`\`\`
`;
}

export function createHistoryEntry(submission, filename) {
  const submitted = formatLocalDateTime(new Date(submission.submittedAt));
  const accepted = submission.status === "Accepted";
  return {
    submissionId: submission.submissionId,
    codeHash: submission.codeHash,
    date: `${submitted.date} ${submitted.time}`,
    language: displayLanguage(submission.language),
    status: `${accepted ? "✅" : "❌"} ${submission.status}`,
    runtime: accepted && submission.runtimeMs != null
      ? `${submission.runtimeMs} ms${submission.runtimePercentile == null ? "" : ` (${submission.runtimePercentile}%)`}`
      : "—",
    memory: accepted && submission.memoryMb != null
      ? `${submission.memoryMb} MB${submission.memoryPercentile == null ? "" : ` (${submission.memoryPercentile}%)`}`
      : "—",
    file: filename
  };
}

export function parseHistoryEntries(markdown) {
  if (!markdown) return [];
  return markdown
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      const match = cells[6]?.match(/\]\(\.\/([^)]+)\)/);
      return {
        date: cells[1],
        language: cells[2],
        status: cells[3],
        runtime: cells[4],
        memory: cells[5],
        file: match ? match[1] : ""
      };
    })
    .filter((entry) => entry.file);
}

export function renderHistoryMarkdown(submission, previousEntries = [], filename) {
  const topics = submission.topics.length ? submission.topics.join(", ") : "None";
  const entries = [
    createHistoryEntry(submission, filename),
    ...previousEntries.filter((entry) => entry.file !== filename)
  ];
  const rows = entries.map((entry, index) => (
    `| ${entries.length - index} | ${entry.date} | ${entry.language} | ${entry.status} | ${entry.runtime} | ${entry.memory} | [view](./${entry.file}) |`
  ));

  return `# Submission History — ${submission.problemNumber}. ${submission.title}

**Difficulty:** ${submission.difficulty}
**Topics:** ${topics}
**Problem:** ${submission.problemUrl}

| # | Date | Language | Status | Runtime | Memory | File |
|---|------|----------|--------|---------|--------|------|
${rows.join("\n")}
`;
}

export function renderCommitMessage(template, submission) {
  return template
    .replaceAll("{number}", String(submission.problemNumber))
    .replaceAll("{title}", submission.title)
    .replaceAll("{language}", submission.language)
    .replaceAll("{status}", submission.status)
    .replaceAll("{difficulty}", submission.difficulty);
}

export function extractCodeHash(markdown) {
  const match = markdown?.match(/codeHash=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

export function normalizeLeetCodeStatus(status) {
  const value = String(status || "").trim();
  if (SYNCABLE_STATUSES.has(value)) return value;
  return "";
}

export function parseRuntimeMs(runtime) {
  if (runtime == null || runtime === "") return null;
  const match = String(runtime).match(/([\d.]+)/);
  return match ? Number(match[1]) : null;
}

export function parseMemoryMb(memory) {
  if (memory == null || memory === "") return null;
  const match = String(memory).match(/([\d.]+)/);
  return match ? Number(match[1]) : null;
}

export function parsePercentile(value) {
  if (value == null || value === "") return null;
  const match = String(value).match(/([\d.]+)/);
  return match ? Number(match[1]) : null;
}
