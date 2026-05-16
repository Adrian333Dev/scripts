# File Index

| Path | Start | End |
|------|-------|-----|
| README.md | 9 | 86 |
| package.json | 87 | 100 |
| run.js | 101 | 154 |

```markdown README.md
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

```json package.json
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

```javascript run.js
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
