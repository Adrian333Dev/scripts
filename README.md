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

The `collect-serp` command also requires Playwright. After installing dependencies, install a Chromium browser if Playwright has not already done so:

```bash
cd scripts && pnpm exec playwright install chromium
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

### collect-serp

Collect organic Google search results using a visible Playwright browser. The command writes JSON-only per-query output files and saves progress after each batch.

```bash
node scripts/run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --max-pages 3 \
  --out runs/test
```

From inside the `scripts/` directory:

```bash
pnpm collect-serp --query '"zoned out" lecture site:reddit.com' --max-pages 3 --out runs/test
```

#### collect-serp options

| Option | Default | Description |
|--------|---------|-------------|
| `--query <query>` | required unless `--queries-file` is used | Google query to run; repeat for multiple queries |
| `--queries-file <file>` | — | Newline-separated query file; blank lines and `#` comments are ignored |
| `--max-pages <number>` | `10` | Maximum result pages to collect |
| `--out <dir>` | `runs/<query-slug>` for one query, otherwise `runs/google-serp-run` | Output directory, relative to the caller's cwd |
| `--profile-dir <dir>` | `scripts/.chrome-profile` | Persistent browser profile for cookies and search settings |
| `--connect-cdp <url>` | — | Connect to an existing Chrome DevTools endpoint instead of launching an isolated browser |
| `--locale <locale>` | `en-US` | Browser locale |
| `--fields <list\|all>` | `title,url,source,displayUrl,snippet,rank` | Result fields to include |
| `--delay-ms <min>:<max>` | `1000:3000` | Delay range between result pages |
| `--fast` | off | Shorthand for `--delay-ms 100:500` |
| `--page-concurrency <n>` | `1` | Load direct result pages in parallel tabs, from `1` to `8` |
| `--open-only` | off | Open the first query in Playwright and keep the browser open for manual pagination testing |
| `--verbose` | off | Log timing details and skipped extraction candidates |

Recommended speed path:

```bash
node scripts/run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --max-pages 10 \
  --page-concurrency 5 \
  --delay-ms 0:0 \
  --out runs/test-parallel \
  --verbose
```

This opens direct Google `start=` pages in parallel tabs and merges results back in page order. Start with `2` or `3` if CAPTCHA pressure increases.

**Output files:**

```
<out>/
├── manifest.json
└── queries/
    └── 001-zoned-out-lecture-site-reddit-com-<hash>.json
```

Each query JSON file has this shape:

```json
{
  "query": "\"zoned out\" lecture site:reddit.com",
  "metadata": {
    "maxPages": 3,
    "pagesCollected": 3,
    "totalUniqueResults": 24,
    "stoppedReason": "max_pages"
  },
  "results": [
    {
      "title": "Example result title",
      "url": "https://www.reddit.com/r/example/comments/abc/example_thread/",
      "source": "Reddit",
      "displayUrl": "https://www.reddit.com › r/example",
      "snippet": "Nearby result text from the SERP.",
      "rank": 1
    }
  ]
}
```

If Google shows a CAPTCHA or unusual traffic page, the command pauses with:

```txt
CAPTCHA detected. Solve it in the browser. Collection will continue automatically, or press Enter here to re-check now.
```

Solve it manually in the visible browser. The command polls the page and continues automatically once the challenge clears; pressing Enter in the terminal forces an immediate re-check. This tool intentionally does not use proxy rotation, stealth plugins, or CAPTCHA-solving services.

By default, `collect-serp` uses `scripts/.chrome-profile/`, a separate persistent Chrome automation profile. It does not attach to your everyday Chrome profile. That isolation avoids profile-locking and accidental changes to your normal browser state, while still preserving cookies and consent state between collector runs.

To isolate browser/session delay from collector logic, open the query without collecting:

```bash
node scripts/run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --open-only \
  --verbose
```

The browser stays open while the process runs. Manually click Google's pagination in that browser, then press `Ctrl+C` in the terminal when done.

To compare against your real Chrome profile, start Chrome with a DevTools endpoint:

```bash
google-chrome --remote-debugging-port=9222
```

Then attach the script to it:

```bash
node scripts/run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --connect-cdp http://127.0.0.1:9222 \
  --open-only \
  --verbose
```

CDP mode opens a new tab in that Chrome session. Use it only when you explicitly want the tool to share your real browser state.

More details: `serp-helpers/README.md`. Short LLM handoff: `serp-helpers/LLM.md`.

## Adding Scripts

1. Add the script file to a category folder (e.g. `img-helpers/optimize.mjs`)
2. Register it in `run.js` under `COMMANDS`

## Tips

- Always run from your project root — paths are relative to your current working directory
- Add `scripts/` to `.gitignore` if you prefer not to commit it, or keep it for team sharing
- Add `node_modules/` and `*/optimized/.optimize-cache.json` to your project's `.gitignore` if you commit the optimized output
