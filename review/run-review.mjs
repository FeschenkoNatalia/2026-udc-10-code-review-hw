#!/usr/bin/env node
// Runs the AI reviewer (.claude/commands/review-pr.md) on ONE queued PR in a fresh headless Claude Code
// session. The session works in a temporary copy of only what it may see — app/ (base code), the
// standard, the conventions and review-queue/pr-N/ — so other PRs, saved reports and git history are
// not there to read. Tools: Read, Grep, Glob; no MCP servers.
//
// Tests are not run here: they are a separate deterministic gate (rule R13) — locally the manual
// command in docs/review-standard.md, in CI a separate required job before the AI review.
//
// Usage:  node review/run-review.mjs <N> [--tag v2] [--model sonnet]
// Writes review-runs/pr-N[.tag].md (the report, verbatim) and adds a row with the verdict, model, time,
// tokens, cost and commit to the table review-runs/runs.md.

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
if (!/^\d+$/.test(n ?? "")) fail("usage: node review/run-review.mjs <N> [--tag v2] [--model sonnet]");
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args.splice(i, 2)[1];
};
const tag = option("--tag", "");
const model = option("--model", "opus"); // pinned: --restricted ignores the user's model setting
if (args.length) fail(`unknown arguments: ${args.join(" ")}`);

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
process.chdir(git("rev-parse", "--show-toplevel"));

const prDir = `review-queue/pr-${n}`;
if (!fs.existsSync(`${prDir}/PR.md`) || !fs.existsSync(`${prDir}/change.diff`)) fail(`no ${prDir}`);
if (git("status", "--porcelain", "--", "app")) {
  fail("app/ has local changes; restore it first: git checkout -- app && git clean -fd app");
}
const out = `review-runs/pr-${n}${tag ? `.${tag}` : ""}.md`;
if (fs.existsSync(out)) fail(`${out} exists; pass --tag to keep both runs`);

// The command file is the prompt, so /review-pr N and this script run the same reviewer.
const prompt = fs.readFileSync(".claude/commands/review-pr.md", "utf8")
  .replace(/^---[\s\S]*?\n---\s*/, "")
  .replaceAll("$ARGUMENTS", n);

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "review-pr-"));
for (const p of ["app", "docs/team-conventions.md", prDir]) {
  fs.cpSync(p, path.join(workspace, p), { recursive: true, filter: (src) => !src.includes("node_modules") });
}
// The reviewer gets the rules, not the operator how-to that follows them.
const standard = fs.readFileSync("docs/review-standard.md", "utf8").split("\n### Як запустити рев'ю")[0];
fs.writeFileSync(path.join(workspace, "docs/review-standard.md"), standard.trimEnd() + "\n");

const run = spawnSync("claude", [
  "-p", "--model", model,
  "--restricted", "--strict-mcp-config", "--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk",
  "--no-session-persistence", "--output-format", "stream-json", "--verbose",
], { cwd: workspace, input: prompt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
fs.rmSync(workspace, { recursive: true, force: true });
if (run.error) fail(`could not start claude: ${run.error.message}`);

const events = run.stdout.split("\n").flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const init = events.find((e) => e.type === "system" && e.subtype === "init");
const result = events.findLast((e) => e.type === "result");

// Fail closed: a run with more than read-only tools is not a valid measurement.
if (!init || [...init.tools].sort().join() !== "Glob,Grep,Read" || init.mcp_servers.length) {
  fail(`session was not read-only: tools ${JSON.stringify(init?.tools)}, mcp ${JSON.stringify(init?.mcp_servers)}`);
}
if (!result || result.is_error || typeof result.result !== "string") {
  fail(`review failed: ${result?.result ?? run.stderr}`);
}

const report = result.result.trimEnd() + "\n";
fs.mkdirSync("review-runs", { recursive: true });
fs.writeFileSync(out, report);

// Saved verbatim; format problems are flagged for the scorer, never fixed.
const verdict = report.match(/\*\*Вердикт:\*\*\s*(\w+)/)?.[1] ?? null;
const findings = (report.match(/^### F\d+/gm) ?? []).length;
const blocking = (report.match(/блокує: так/g) ?? []).length;
const warnings = [
  ...(report.startsWith(`## PR-${n}`) ? [] : ["report does not start with the format heading"]),
  ...((verdict === "REQUEST_CHANGES") === (blocking > 0) ? [] : [`verdict ${verdict} does not match ${blocking} blocking finding(s)`]),
];

// One row per run in a Markdown table: time, tokens and cost for the scorecard, and the model and commit
// that show whether two runs were made under the same conditions.
const configUncommitted = Boolean(git("status", "--porcelain", "--", ".claude/commands/review-pr.md", "docs/review-standard.md"));
const models = Object.keys(result.modelUsage ?? {}).join(", ");
const seconds = Math.round(result.duration_ms / 1000);
const inputTokens = (result.usage?.input_tokens ?? 0) + (result.usage?.cache_read_input_tokens ?? 0)
  + (result.usage?.cache_creation_input_tokens ?? 0);
const notes = [...(configUncommitted ? ["конфіг не закомічено"] : []), ...warnings].join("; ");
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
