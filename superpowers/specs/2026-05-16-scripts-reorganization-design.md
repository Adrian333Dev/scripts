# Scripts Repo Reorganization Design

**Date:** 2026-05-16
**Scope:** Reduce invocation verbosity via a single dispatcher entry point; clean up redundant files.

---

## Problem

Running scripts requires typing the full nested path:

```bash
node scripts/llm-helpers/merge-to-md.js src
```

This is the primary friction when the repo is cloned into a project.

---

## Solution

Add `scripts/run.js` as the single entry point. Users only ever type:

```bash
node scripts/run.js <command> [options]
```

---

## File Structure

**After reorganization:**

```
scripts/
├── run.js                      ← NEW: dispatcher entry point
├── package.json                ← updated npm scripts
├── README.md                   ← rewritten usage section
├── .gitignore
└── llm-helpers/
    └── merge-to-md.js          ← unchanged
```

**Removed:**
- `llm-helpers/merge-git-changed-to-md.js` — replaced by `merge-git` command in dispatcher
- `llm-helpers/default-ignores.txt` — docs-only, covered by README

**Future scripts** land in their own category folder (e.g. `img-helpers/`) and are registered in `run.js`. No structural change needed.

---

## Dispatcher Contract (`run.js`)

Plain Node.js, zero dependencies.

### Command registry

```js
const COMMANDS = {
  'merge':     { script: 'llm-helpers/merge-to-md.js', args: [] },
  'merge-git': { script: 'llm-helpers/merge-to-md.js', args: ['--git'] },
};
```

### Behaviour

| Invocation | Result |
|---|---|
| `node scripts/run.js merge src` | runs `merge-to-md.js src` |
| `node scripts/run.js merge-git --except "*.test.ts"` | runs `merge-to-md.js --git --except "*.test.ts"` |
| `node scripts/run.js` | prints help (command list + descriptions), exits 0 |
| `node scripts/run.js --help` | same as above |
| `node scripts/run.js unknown` | prints error + help list, exits 1 |

Args are passed through via `spawnSync` — all existing flags (`--out`, `--name`, `--except`, `--include`, `--assets`, `--git`) keep working unchanged.

---

## `package.json` Updates

```json
{
  "scripts": {
    "merge":     "node run.js merge",
    "merge-git": "node run.js merge-git"
  }
}
```

(For running from inside the `scripts/` dir: `cd scripts && npm run merge src`.)

---

## README Structure

```
# LLM Scripts
(one-liner description)

## Setup
git clone ...
(no npm install needed)

## Usage
node scripts/run.js <command> [options]
node scripts/run.js --help

## Commands
### merge
### merge-git

## Adding scripts
(add file to category folder, register in run.js)

## Tips
```

Old verbose invocation examples are removed. `run.js` is the only path documented.

---

## Out of Scope

- Image optimization script (separate design to follow)
- Shell alias setup / host `package.json` mutation
