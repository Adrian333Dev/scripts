# SERP Helpers

`collect-serp` collects organic Google results with a visible Playwright browser and writes JSON output. It is part of this `scripts` repo, not a standalone package.

## Quick Run

```bash
node run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --max-pages 10 \
  --page-concurrency 5 \
  --delay-ms 0:0 \
  --out runs/test-parallel \
  --verbose
```

From another project root that contains this repo as `scripts/`:

```bash
node scripts/run.js collect-serp --query "example query" --max-pages 5 --out runs/serp
```

## Options

| Option | Purpose |
|--------|---------|
| `--query`, `-q` | Query to collect; repeat for multiple queries |
| `--queries-file` | Newline-separated query file; blank lines and `#` comments ignored |
| `--max-pages` | Google result pages to collect, default `10` |
| `--page-concurrency` | Parallel direct `start=` pages, `1` to `8`; use `5` if CAPTCHA is tolerable |
| `--out` | Output directory |
| `--fields` | Result fields, default `title,url,source,displayUrl,snippet,rank`; use `all` for debug fields |
| `--delay-ms` / `--fast` | Delay between sequential pages; mostly irrelevant when `--page-concurrency > 1` |
| `--profile-dir` | Persistent automation profile, default `scripts/.chrome-profile` |
| `--open-only` | Open the query and keep the browser alive for manual testing |
| `--connect-cdp` | Diagnostic attach to an existing Chrome DevTools endpoint |
| `--verbose` | Timing logs and skipped extraction candidates |

## Output

```txt
<out>/
├── manifest.json
└── queries/
    └── 001-<query-slug>-<hash>.json
```

Each query file:

```json
{
  "query": "example query",
  "metadata": {
    "maxPages": 10,
    "pageConcurrency": 5,
    "pagesCollected": 10,
    "totalUniqueResults": 84,
    "stoppedReason": "max_pages"
  },
  "results": [
    {
      "title": "Example",
      "url": "https://example.com/",
      "source": "Example",
      "displayUrl": "example.com",
      "snippet": "Visible SERP text.",
      "rank": 1
    }
  ]
}
```

## Behavior

- Uses headed Playwright Chrome when available, with Chromium fallback.
- Stores browser state in `.chrome-profile` so Google consent/cookies persist.
- Uses direct Google `start=` URLs for result pages.
- `--page-concurrency` overlaps slow page loads and merges results back in page order.
- CAPTCHA/unusual traffic is manual only. The command waits and polls until the visible browser returns to results.
- No proxy rotation, stealth plugins, CAPTCHA solvers, or bot-evasion code.

## Files

| File | Purpose |
|------|---------|
| `collect-google.mjs` | CLI parsing and orchestration |
| `google.mjs` | Playwright sessions and Google navigation |
| `extract.mjs` | Organic result extraction |
| `normalize.mjs` | URL cleanup and dedupe keys |
| `output.mjs` | JSON files and manifest |
| `captcha.mjs` | CAPTCHA detection and manual wait |

## Verify

```bash
node --check serp-helpers/collect-google.mjs
node --check serp-helpers/google.mjs
node run.js collect-serp --help
pnpm test:serp
```
