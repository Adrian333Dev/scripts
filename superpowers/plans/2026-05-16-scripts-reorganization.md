# Scripts Repo Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `run.js` dispatcher so any script can be invoked as `node scripts/run.js <command> [args]` instead of the full nested path.

**Architecture:** A plain Node.js dispatcher at `scripts/run.js` holds a command registry mapping short names to script paths + prepended args, then delegates to the target script via `spawnSync`. The existing `merge-to-md.js` workhorse is unchanged. The thin `merge-git-changed-to-md.js` wrapper and docs-only `default-ignores.txt` are deleted — their roles are absorbed by the dispatcher and README respectively.

**Tech Stack:** Plain Node.js (no npm install required), `spawnSync` from `child_process`.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `scripts/run.js` | Dispatcher entry point |
| Modify | `scripts/package.json` | Update npm scripts to use run.js |
| Modify | `scripts/README.md` | Rewrite usage to show run.js invocations |
| Delete | `scripts/llm-helpers/merge-git-changed-to-md.js` | Replaced by `merge-git` command in dispatcher |
| Delete | `scripts/llm-helpers/default-ignores.txt` | Docs-only, covered by README |

---

## Task 1: Create `run.js` dispatcher

**Files:**
- Create: `scripts/run.js`

- [ ] **Step 1: Write `scripts/run.js`**

```js
#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const COMMANDS = {
  'merge': {
    script: 'llm-helpers/merge-to-md.js',
    args: [],
    description: 'Merge files/folders into a single Markdown file for LLM context',
  },
  'merge-git': {
    script: 'llm-helpers/merge-to-md.js',
    args: ['--git'],
    description: 'Merge git changed files (added/modified) into a Markdown file',
  },
};

const scriptDir = path.resolve(__dirname);
const cwd = process.cwd();

function printHelp() {
  console.log('Usage: node scripts/run.js <command> [options]\n');
  console.log('Commands:');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(16)} ${cmd.description}`);
  }
  console.log('\nRun node scripts/run.js <command> --help for command-specific options.');
}

const [, , command, ...rest] = process.argv;

if (!command || command === '--help') {
  printHelp();
  process.exit(0);
}

const cmd = COMMANDS[command];
if (!cmd) {
  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

const scriptPath = path.join(scriptDir, cmd.script);
const result = spawnSync('node', [scriptPath, ...cmd.args, ...rest], {
  stdio: 'inherit',
  cwd,
});
process.exit(result.status ?? 1);
```

- [ ] **Step 2: Verify help output**

Run from the project root (where `scripts/` is cloned):
```bash
node scripts/run.js
```
Expected output:
```
Usage: node scripts/run.js <command> [options]

Commands:
  merge            Merge files/folders into a single Markdown file for LLM context
  merge-git        Merge git changed files (added/modified) into a Markdown file

Run node scripts/run.js <command> --help for command-specific options.
```

- [ ] **Step 3: Verify --help flag**

```bash
node scripts/run.js --help
```
Expected: same help output as above, exits 0.

- [ ] **Step 4: Verify unknown command error**

```bash
node scripts/run.js foobar
```
Expected: prints `Unknown command: foobar` followed by help list, exits 1.

- [ ] **Step 5: Verify `merge` command works**

```bash
node scripts/run.js merge scripts
```
Expected: creates `temp/llm-context/scripts.md` with file contents, prints `Wrote N files to temp/llm-context/scripts.md`.

- [ ] **Step 6: Verify `merge-git` command works**

Make a small edit to any file, then run:
```bash
node scripts/run.js merge-git
```
Expected: creates `temp/llm-context/git-changed.md` containing only the changed file(s).

- [ ] **Step 7: Commit**

```bash
git add scripts/run.js
git commit -m "feat(scripts): add run.js dispatcher for short invocations"
```

---

## Task 2: Remove redundant files

**Files:**
- Delete: `scripts/llm-helpers/merge-git-changed-to-md.js`
- Delete: `scripts/llm-helpers/default-ignores.txt`

- [ ] **Step 1: Delete the wrapper script**

```bash
rm scripts/llm-helpers/merge-git-changed-to-md.js
```

- [ ] **Step 2: Delete the docs-only ignores file**

```bash
rm scripts/llm-helpers/default-ignores.txt
```

- [ ] **Step 3: Verify `run.js merge-git` still works after deletion**

```bash
node scripts/run.js merge-git
```
Expected: same successful output as Task 1 Step 6 (dispatcher delegates directly to `merge-to-md.js --git`, not via the deleted wrapper).

- [ ] **Step 4: Commit**

```bash
git add -A scripts/llm-helpers/
git commit -m "chore(scripts): remove merge-git wrapper and docs-only ignores file"
```

---

## Task 3: Update `package.json`

**Files:**
- Modify: `scripts/package.json`

- [ ] **Step 1: Replace npm scripts**

Replace the entire `scripts/package.json` with:
```json
{
  "name": "llm-scripts",
  "description": "Portable scripts for LLM workflows. Clone into any repo and run from your project root.",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "merge":     "node run.js merge",
    "merge-git": "node run.js merge-git"
  }
}
```

- [ ] **Step 2: Verify npm scripts work (optional)**

```bash
cd scripts && npm run merge -- ../src
```
Expected: creates `../temp/llm-context/src.md` (or equivalent), prints file count.

- [ ] **Step 3: Commit**

```bash
git add scripts/package.json
git commit -m "chore(scripts): update package.json scripts to use run.js"
```

---

## Task 4: Rewrite `README.md`

**Files:**
- Modify: `scripts/README.md`

- [ ] **Step 1: Replace `scripts/README.md`**

```markdown
# LLM Scripts

Portable scripts for LLM workflows. Clone into any codebase and run from your project root.

## Setup

```bash
git clone https://github.com/Adrian333Dev/scripts.git scripts
```

No dependencies — scripts use plain Node.js (no npm install needed).

## Usage

Run from your **project root** (the directory containing `scripts/`):

```bash
node scripts/run.js <command> [options]
node scripts/run.js --help        # list all commands
```

### merge

Merge files/folders into a single Markdown file with an LLM-friendly File Index. Output includes a path/line-range table at the top so LLMs can jump directly to specific files.

```bash
# Single folder
node scripts/run.js merge src

# Multiple paths
node scripts/run.js merge apps/web/src packages/shared

# Exclude test files
node scripts/run.js merge --except "*.test.ts,*.spec.ts" src

# Custom output location and name
node scripts/run.js merge --out docs/context --name assistant src
```

### merge-git

Merge only git changed files (added/modified) into a Markdown file.

```bash
node scripts/run.js merge-git
node scripts/run.js merge-git --out temp --name changed
node scripts/run.js merge-git --except "*.test.ts"
```

## Options

All commands accept:

| Option | Description |
|--------|-------------|
| `--out <dir>` | Output directory (default: `temp/llm-context`) |
| `--name <name>` | Output filename without `.md` |
| `--except <list>` | Comma-separated patterns to exclude |
| `--include <list>` | Comma-separated patterns to include only |
| `--assets <mode>` | `ignore` (default) or `mention` binary/asset files |

**Default ignores** (applied automatically): `.git`, `node_modules`, `dist`, `temp`, `tmp`, `vendor`, `.venv`, `__pycache__`, `.turbo`

Override with `--except` or `--include`.

## Adding Scripts

1. Add the script file to a category folder (e.g. `img-helpers/optimize.js`)
2. Register it in `run.js` under `COMMANDS`

## Tips

- Always run from your project root — paths are relative to your current working directory
- Add `scripts/` to `.gitignore` if you prefer not to commit it, or keep it for team sharing
```

- [ ] **Step 2: Verify README renders correctly**

Open `scripts/README.md` in a Markdown previewer (IDE or GitHub). Confirm:
- No broken code fences
- Options table renders as a table
- No references to the old `llm-helpers/merge-to-md.js` path remain

- [ ] **Step 3: Commit**

```bash
git add scripts/README.md
git commit -m "docs(scripts): rewrite README to document run.js invocation"
```
