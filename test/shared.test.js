import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoryPath,
  buildProblemFolder,
  buildSubmissionFilename,
  buildSubmissionPath,
  extractCodeHash,
  parseHistoryEntries,
  renderHistoryMarkdown,
  renderSolutionMarkdown
} from "../src/shared.js";

const submission = {
  problemNumber: 1,
  title: "Two Sum",
  titleSlug: "two-sum",
  difficulty: "Easy",
  topics: ["Array", "Hash Table"],
  problemUrl: "https://leetcode.com/problems/two-sum/",
  language: "python3",
  status: "Accepted",
  runtimeMs: 52,
  runtimePercentile: 87,
  memoryMb: 17.1,
  memoryPercentile: 71.4,
  code: "class Solution:\n    pass",
  submittedAt: "2026-05-11T13:45:00.000Z",
  submissionId: "123",
  codeHash: "a".repeat(64)
};

test("builds stable problem, submission, and history paths", () => {
  assert.equal(buildProblemFolder(submission), "0001-two-sum");
  assert.match(buildSubmissionFilename(submission), /^2026-05-11_\d{2}-\d{2}_python3_accepted\.md$/);
  assert.match(buildSubmissionPath(submission, "daily"), /^daily\/0001-two-sum\/2026-05-11_\d{2}-\d{2}_python3_accepted\.md$/);
  assert.equal(buildHistoryPath(submission, "daily"), "daily/0001-two-sum/history.md");
});

test("renders accepted solution markdown with metrics and metadata", () => {
  const markdown = renderSolutionMarkdown(submission);
  assert.match(markdown, /# 1\. Two Sum/);
  assert.match(markdown, /\*\*Runtime:\*\* 52 ms \(beats 87%\)/);
  assert.match(markdown, /leetgit:submissionId=123 codeHash=aaaaaaaa/);
  assert.equal(extractCodeHash(markdown), "a".repeat(64));
});

test("omits metrics for non-accepted submissions", () => {
  const markdown = renderSolutionMarkdown({ ...submission, status: "Wrong Answer" });
  assert.doesNotMatch(markdown, /\*\*Runtime:\*\*/);
  assert.doesNotMatch(markdown, /\*\*Memory:\*\*/);
});

test("renders newest history entry first and parses existing entries", () => {
  const filename = buildSubmissionFilename(submission);
  const history = renderHistoryMarkdown(submission, [], filename);
  assert.match(history, /\| 1 \| .* \| Python3 \| ✅ Accepted \| 52 ms \(87%\) \| 17.1 MB \(71.4%\) \| \[view\]\(\.\/.*python3_accepted\.md\) \|/);

  const parsed = parseHistoryEntries(history);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].language, "Python3");
  assert.equal(parsed[0].status, "✅ Accepted");
  assert.equal(parsed[0].file, filename);
});
