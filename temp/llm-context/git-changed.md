# File Index

| Path | Start | End |
|------|-------|-----|
| .gitignore | 9 | 18 |
| README.md | 19 | 89 |
| package.json | 90 | 103 |

```.gitignore
# Dependencies (if any scripts add them later)
node_modules/

# OS
.DS_Store
Thumbs.db

```

```markdown README.md
# LLM Scripts

Portable scripts for LLM workflows. Clone this repo into any codebase and run scripts from your project root.

## Setup

```bash
# Clone into your project (e.g. as a scripts/ or tools/ subfolder)
git clone https://github.com/YOUR_USER/scripts.git scripts
cd your-project   # your project root
```

**No dependencies** — scripts use plain Node.js (no npm install needed).

## Usage

Run from your **project root** (the directory you want to process). Paths are relative to the current working directory.

### merge-to-md

Merge files/folders into a single Markdown file with an LLM-friendly File Index.

```bash
# From project root — process a folder
node scripts/llm-helpers/merge-to-md.js src

# Or if you cloned as "tools":
node tools/llm-helpers/merge-to-md.js src

# Multiple paths
node scripts/llm-helpers/merge-to-md.js apps/web/src packages/shared

# Git changed files only
node scripts/llm-helpers/merge-to-md.js --git
```

**Default ignores** (applied automatically): `.git`, `node_modules`, `temp`, `tmp`, `.tmp`, `.temp`, `vendor`, `.venv`, `__pycache__`

Override with `--except` or `--include`. See `merge-to-md.js` header for full options.

### merge-git-changed-to-md

Thin wrapper that merges only git changed files (added/modified). Invokes `merge-to-md.js --git` with the same options.

```bash
# From project root — merge all changed files
node scripts/llm-helpers/merge-git-changed-to-md.js

# Custom output
node scripts/llm-helpers/merge-git-changed-to-md.js --out temp/llm-context --name changed

# Exclude tests
node scripts/llm-helpers/merge-git-changed-to-md.js --except "*.test.ts,*.spec.ts"
```

Same default ignores as `merge-to-md`. Use `merge-to-md.js --git` directly if you prefer.

## Script Types

- **JavaScript** — `node path/to/script.js` (runs everywhere Node.js is installed)
- **Bash** — planned; will follow same path conventions

## Tips

- Works from any folder: `cwd` is where you run the command
- Paths are always relative to your current directory
- Add `scripts/` to `.gitignore` if you prefer not to commit, or keep it for team sharing

```

```json package.json
{
  "name": "llm-scripts",
  "description": "Portable scripts for LLM workflows. Clone into any repo and run from your project root.",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "merge-to-md": "node llm-helpers/merge-to-md.js",
    "merge-git-changed-to-md": "node llm-helpers/merge-git-changed-to-md.js"
  }
}

```
