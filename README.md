# LLM Scripts

Portable scripts for LLM workflows and asset tooling. Clone into any codebase and run from your project root.

## Setup

```bash
git clone https://github.com/Adrian333Dev/scripts.git scripts
```

Most commands run with plain Node.js — no install needed. The `optimize` command requires `sharp`, so install once inside `scripts/`:

```bash
cd scripts && pnpm install      # or: npm install
```

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

#### merge / merge-git options

| Option | Description |
|--------|-------------|
| `--out <dir>` | Output directory (default: `temp/llm-context`) |
| `--name <name>` | Output filename without `.md` |
| `--except <list>` | Comma-separated patterns to exclude |
| `--include <list>` | Comma-separated patterns to include only |
| `--assets <mode>` | `ignore` (default) or `mention` binary/asset files |

**Default ignores** (applied automatically): `.git`, `node_modules`, `dist`, `temp`, `tmp`, `vendor`, `.venv`, `__pycache__`, `.turbo`

### optimize

Batch-optimize raster images to AVIF at responsive widths. Uses `sharp` (libvips) under the hood. Produces a `manifest.json` for downstream `<picture>`/`srcset` consumers.

AVIF is the default-and-only format because evergreen browser support (Chrome, Safari 16+, Firefox, Edge) is universal as of mid-2025. Pass `--formats avif,webp` if you still need a WebP fallback.

**Requires** `pnpm install` inside `scripts/` (see Setup).

```bash
# Default — output to <input>/optimized/, AVIF only, widths 480..1920
node scripts/run.js optimize src/assets/scenes

# Custom widths and output dir
node scripts/run.js optimize --widths 640,1280,1920 --out public/img src/assets/scenes

# Subset re-run
node scripts/run.js optimize --only "**/hero-*.png" --force src/assets

# Quality bump (for screenshot/UI-heavy folders with text)
node scripts/run.js optimize --quality avif=68,webp=90 src/assets/screenshots

# Add JPEG fallback alongside AVIF + WebP
node scripts/run.js optimize --formats avif,webp,jpeg src/assets/scenes

# Plan only, no writes
node scripts/run.js optimize --dry-run src/assets/scenes
```

**Defaults:** AVIF q60 (conservative, preserves text/UI detail; chromaSubsampling 4:4:4). Variants whose encoded bytes don't beat the source are silently dropped — the script only writes a variant when it's genuinely smaller. Outputs are skipped on re-run when the source `mtime` + size + encoding config are unchanged. Use `--force` to regenerate. Originals are never modified, and variants are never upscaled.

#### optimize options

| Option | Default | Description |
|--------|---------|-------------|
| `--out <dir>` | smart per input shape | Output directory |
| `--widths <list>` | `480,768,1024,1440,1920` | Comma-separated widths |
| `--formats <list>` | `avif` | Output formats (`avif`, `webp`, `jpeg`) |
| `--quality <list>` | `avif=60,webp=85,jpeg=82` | Per-format quality overrides |
| `--only <glob>` | — | Process only matching files |
| `--except <glob>` | — | Exclude matching files |
| `--force` | off | Regenerate even if cache is fresh |
| `--dry-run` | off | Print the plan without writing |

**Recognized input extensions:** `.png .jpg .jpeg .webp .avif`. SVG and GIF are intentionally not handled — use dedicated tooling.

**Manifest:** Written to `<out-dir>/manifest.json`. Keys are source paths relative to cwd; each entry has `source`, `width`, `height`, `aspectRatio`, `hasAlpha`, and `variants` (per-format arrays of `{width, path, bytes}` where `path` is relative to the manifest file).

**Output layout:**

```
<out-dir>/
├── <basename>/
│   ├── <basename>-480.avif
│   ├── <basename>-480.webp
│   └── ...
├── manifest.json
└── .optimize-cache.json    (gitignore this)
```

**Exit codes:** `0` success, `1` partial encode failure, `2` CLI / setup error.

## Adding Scripts

1. Add the script file to a category folder (e.g. `img-helpers/optimize.mjs`)
2. Register it in `run.js` under `COMMANDS`

## Tips

- Always run from your project root — paths are relative to your current working directory
- Add `scripts/` to `.gitignore` if you prefer not to commit it, or keep it for team sharing
- Add `node_modules/` and `*/optimized/.optimize-cache.json` to your project's `.gitignore` if you commit the optimized output
