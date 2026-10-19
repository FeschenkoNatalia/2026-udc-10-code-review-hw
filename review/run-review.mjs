#!/usr/bin/env node
// Runs the AI reviewer (.claude/commands/review-pr.md) on ONE queued PR in a fresh headless Claude Code
// session. The session works in a temporary copy of only what it may see — app/ (base code), the
// standard, the conventions and review-queue/pr-N/ — so other PRs, saved reports and git history are
// not there to read. Tools: Read, Grep, Glob; no MCP servers.
//
// --reviewer review-task runs a second reviewer on the same queue (Task E, path 3): the generic review
// skill github.com/koldovsky/skill-review-task, installed outside this repo as its README says —
// git clone into ~/.claude/skills/review-task. The run log records the skill's commit.
// It sees the same code and conventions, but not our standard; its session hands the review to a fresh
// subagent, so it also gets the Agent tool — the subagent has the same read-only tools.
//
// Tests are not run here: they are a separate deterministic gate (rule R13) — locally the manual
// command in docs/review-standard.md, in CI a separate required job before the AI review.
//
// Usage:  node review/run-review.mjs <N> [--tag v2] [--model sonnet] [--reviewer review-task]
// Writes review-runs/pr-N[.tag].md (the report, verbatim; the tag defaults to the reviewer name for
// review-task) and adds a row with the verdict, model, time, tokens, cost and commit to the table
// review-runs/runs.md.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fail(message) {
  console.error(`run-review: ${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const n = args.shift();
if (!/^\d+$/.test(n ?? "")) {
  fail("usage: node review/run-review.mjs <N> [--tag v2] [--model sonnet] [--reviewer review-task]");
}
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args.splice(i, 2)[1];
};
const reviewerName = option("--reviewer", "review-pr");
const tag = option("--tag", reviewerName === "review-pr" ? "" : reviewerName);
const model = option("--model", "opus"); // pinned: --restricted ignores the user's model setting
if (args.length) fail(`unknown arguments: ${args.join(" ")}`);

// What differs between the reviewers: their config, tools and report format. The verdict is mechanical
// in both, so a blocking verdict must match the count of blocking findings. `config` gives the notes that
// show which version of the config a run used.
const skillHome = path.join(os.homedir(), ".claude", "skills", "review-task");
const reviewers = {
  "review-pr": {
    config: () => (git("status", "--porcelain", "--", ".claude/commands/review-pr.md", "docs/review-standard.md")
      ? ["конфіг не закомічено"] : []),
    tools: ["Glob", "Grep", "Read"],
    heading: `## PR-${n}`,
    verdict: /\*\*Вердикт:\*\*\s*(\w+)/,
    blocking: /блокує: так/g,
    blocks: (verdict) => verdict === "REQUEST_CHANGES",
  },
  "review-task": {
    config: () => [`skill-review-task@${git("-C", skillHome, "rev-parse", "--short", "HEAD")}`
      + (git("-C", skillHome, "status", "--porcelain") ? ", змінено локально" : "")],
    tools: ["Agent", "Glob", "Grep", "Read"],
    heading: "## Review target",
    verdict: /^## Verdict\s+(\w+)/m,
    blocking: /\*\*Severity\*\*:\s*Critical/g,
    blocks: (verdict) => verdict === "REQUEST_CHANGES" || verdict === "BLOCK",
  },
};
const reviewer = reviewers[reviewerName];
if (!reviewer) fail(`unknown reviewer ${reviewerName}; one of: ${Object.keys(reviewers).join(", ")}`);
const skillFiles = ["SKILL.md", "CRITERIA.md", "OUTPUT_FORMAT.md"];
if (reviewerName === "review-task" && !skillFiles.every((f) => fs.existsSync(path.join(skillHome, f)))) {
  fail(`no skill in ${skillHome}; run without --reviewer to use review-pr, `
    + `or install it: git clone https://github.com/koldovsky/skill-review-task.git ${skillHome}`);
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
process.chdir(git("rev-parse", "--show-toplevel"));

const prDir = `review-queue/pr-${n}`;
if (!fs.existsSync(`${prDir}/PR.md`) || !fs.existsSync(`${prDir}/change.diff`)) fail(`no ${prDir}`);
if (git("status", "--porcelain", "--", "app")) {
  fail("app/ has local changes; restore it first: git checkout -- app && git clean -fd app");
}
const out = `review-runs/pr-${n}${tag ? `.${tag}` : ""}.md`;
if (fs.existsSync(out)) fail(`${out} exists; pass --tag to keep both runs`);

const stripFrontmatter = (text) => text.replace(/^---[\s\S]*?\n---\s*/, "");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "review-pr-"));
const workspaceRoots = [workspace, fs.realpathSync(workspace)]; // the CLI may report either form
for (const p of ["app", "docs/team-conventions.md", prDir]) {
  fs.cpSync(p, path.join(workspace, p), { recursive: true, filter: (src) => !src.includes("node_modules") });
}

let prompt;
if (reviewerName === "review-pr") {
  // The command file is the prompt, so /review-pr N and this script run the same reviewer.
  prompt = stripFrontmatter(fs.readFileSync(".claude/commands/review-pr.md", "utf8")).replaceAll("$ARGUMENTS", n);
  // The reviewer gets the rules, not the operator how-to that follows them.
  const standard = fs.readFileSync("docs/review-standard.md", "utf8").split("\n### Як запустити рев'ю")[0];
  fs.writeFileSync(path.join(workspace, "docs/review-standard.md"), standard.trimEnd() + "\n");
} else {
  // The skill is the prompt, as when it is invoked; the request names only the target and what the session
  // can do — no hints about what to look for.
  const skillDir = path.join(workspace, ".claude/skills/review-task");
  for (const f of skillFiles) fs.cpSync(path.join(skillHome, f), path.join(skillDir, f));
  prompt = stripFrontmatter(fs.readFileSync(path.join(skillHome, "SKILL.md"), "utf8")) + `
---

## Request

Review PR-${n}. Target: \`pr\`. Its description is \`review-queue/pr-${n}/PR.md\` and its change is
\`review-queue/pr-${n}/change.diff\`, a unified diff against the base code in \`app/\`. The team's conventions
are in \`docs/team-conventions.md\`. CRITERIA.md and OUTPUT_FORMAT.md are in \`${skillDir}\`.

This session can read files (Read, Grep, Glob) and launch subagents, and cannot run anything: \`cd app && npm test\`
runs in CI as a separate required check. Your final message is the subagent's output, verbatim.
`;
}

const run = spawnSync("claude", [
  "-p", "--model", model,
  "--restricted", "--strict-mcp-config", "--tools", reviewer.tools.join(","), "--permission-mode", "dontAsk",
  "--no-session-persistence", "--output-format", "stream-json", "--verbose",
], { cwd: workspace, input: prompt, encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
fs.rmSync(workspace, { recursive: true, force: true });
if (run.error) fail(`could not start claude: ${run.error.message}`);

const events = run.stdout.split("\n").flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const init = events.find((e) => e.type === "system" && e.subtype === "init");
const result = events.findLast((e) => e.type === "result");

// Fail closed: a run with more than read-only tools is not a valid measurement. Agent starts a subagent with
// the same tools; the CLI may still report it under its old name, Task.
const tools = (init?.tools ?? []).map((t) => (t === "Task" ? "Agent" : t)).sort().join();
if (!init || tools !== reviewer.tools.join() || init.mcp_servers.length) {
  fail(`session was not read-only: tools ${JSON.stringify(init?.tools)}, mcp ${JSON.stringify(init?.mcp_servers)}`);
}
// Fail closed: every path a tool was asked to touch stays inside the workspace — the model key is in this
// process's environment, and the full checkout with .git sits next to it in CI. A subagent's tool calls come in
// the same stream as assistant events (with parent_tool_use_id), so they are checked too.
const inWorkspace = (p) => workspaceRoots.some((root) => {
  const rel = path.relative(root, path.resolve(root, p));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
});
const outside = events.filter((e) => e.type === "assistant").flatMap((e) => e.message?.content ?? [])
  .filter((c) => c.type === "tool_use").flatMap((c) => [c.input?.file_path, c.input?.path])
  .filter((p) => typeof p === "string" && !inWorkspace(p));
if (outside.length) fail(`tool access outside the workspace: ${outside.join(", ")}`);
if (!result || result.is_error || typeof result.result !== "string") {
  fail(`review failed: ${result?.result ?? run.stderr}`);
}

const report = result.result.trimEnd() + "\n";
fs.mkdirSync("review-runs", { recursive: true });
fs.writeFileSync(out, report);

// Saved verbatim; format problems are flagged for the scorer, never fixed.
const verdict = report.match(reviewer.verdict)?.[1] ?? null;
const findings = (report.match(/^### F\d+/gm) ?? []).length;
const blocking = (report.match(reviewer.blocking) ?? []).length;
const warnings = [
  ...(report.startsWith(reviewer.heading) ? [] : ["report does not start with the format heading"]),
  ...(reviewer.blocks(verdict) === (blocking > 0) ? [] : [`verdict ${verdict} does not match ${blocking} blocking finding(s)`]),
];

// One row per run in a Markdown table: time, tokens and cost for the scorecard, and the model and commit
// that show whether two runs were made under the same conditions.
const models = Object.keys(result.modelUsage ?? {}).join(", ");
const seconds = Math.round(result.duration_ms / 1000);
const inputTokens = (result.usage?.input_tokens ?? 0) + (result.usage?.cache_read_input_tokens ?? 0)
  + (result.usage?.cache_creation_input_tokens ?? 0);
const notes = [...reviewer.config(), ...warnings].join("; ");
const table = "review-runs/runs.md";
if (!fs.existsSync(table)) {
  fs.writeFileSync(table, "| Файл | Вердикт | Знахідок (блок.) | Модель | Час | Токени (вх/вих) | $ | Коміт | Примітки |\n"
    + "|---|---|---|---|---|---|---|---|---|\n");
}
fs.appendFileSync(table, `| ${path.basename(out)} | ${verdict ?? "—"} | ${findings} (${blocking}) | ${models} | ${seconds} s `
  + `| ${inputTokens} / ${result.usage?.output_tokens ?? "?"} | ${result.total_cost_usd?.toFixed(2) ?? "?"} `
  + `| ${git("rev-parse", "--short", "HEAD")} | ${notes} |\n`);

console.log(`${out}: ${verdict}, ${findings} finding(s), ${blocking} blocking; ${seconds} s, $${result.total_cost_usd?.toFixed(2)}, ${models}`);
for (const w of warnings) console.warn(`run-review: warning: ${w}`);
