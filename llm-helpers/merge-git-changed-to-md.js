#!/usr/bin/env node
/**
 * Merges git changed files (added/modified) into a single Markdown file by invoking
 * merge-to-md.js with --git.
 *
 * Usage:
 *   node path/to/merge-git-changed-to-md.js [--out <dir>] [--name <basename>] [--except <list>] [--include <list>]
 *
 * Options (passed through to merge-to-md.js):
 *   --out <dir>     Output directory (default: temp/llm-context).
 *   --name <name>   Output filename without extension (default: git-changed).
 *   --except <list> Comma-separated paths/globs to exclude.
 *   --include <list> Comma-separated globs to include.
 *
 * Uses same default ignores as merge-to-md.js (.git, node_modules, temp, tmp, etc.).
 *
 * Example:
 *   node merge-git-changed-to-md.js
 *   node merge-git-changed-to-md.js --out temp/llm-context --name changed
 *   node merge-git-changed-to-md.js --except "*.test.ts"
 */

const { spawnSync } = require("child_process");
const path = require("path");

const cwd = process.cwd();
const scriptDir = path.resolve(__dirname);

function parseArgs() {
  const args = process.argv.slice(2);
  const passThrough = ["--git"];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      passThrough.push("--out", args[i + 1]);
      i++;
    } else if (args[i] === "--name" && args[i + 1]) {
      passThrough.push("--name", args[i + 1]);
      i++;
    } else if (args[i] === "--except" && args[i + 1]) {
      passThrough.push("--except", args[i + 1]);
      i++;
    } else if (args[i] === "--include" && args[i + 1]) {
      passThrough.push("--include", args[i + 1]);
      i++;
    }
  }
  return passThrough;
}

const mergeScript = path.join(scriptDir, "merge-to-md.js");
const result = spawnSync("node", [mergeScript, ...parseArgs()], {
  stdio: "inherit",
  cwd,
});
process.exit(result.status ?? 1);
