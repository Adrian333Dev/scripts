# Google SERP Collector Spec

Build a repo-integrated CLI tool exposed as `collect-serp`.

## Goal

Given one or more Google search queries, open a visible Chrome/Chromium browser, collect organic Google search results, handle manual CAPTCHA if needed, and save JSON output continuously.

## Scope

- Runs inside this existing `scripts` repo through `node run.js collect-serp`.
- Plain JavaScript ES modules under `serp-helpers/`.
- Writes structured per-query output.
- Supports one query, repeated `--query`, or a newline-separated `--queries-file`.
- Uses a persistent automation profile by default so cookies/search settings survive between runs.
- Can optionally connect to an existing Chrome DevTools endpoint for diagnostics.
- Does not use CAPTCHA-solving services, proxy rotation, stealth plugins, or bot-evasion logic.

## CLI Shape

```bash
node run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --max-pages 10 \
  --page-concurrency 5 \
  --delay-ms 0:0 \
  --out runs/test-parallel \
  --verbose
```

Important options:

| Option | Purpose |
|--------|---------|
| `--query`, `-q` | Query to collect; repeat for multiple queries |
| `--queries-file` | Newline-separated query file |
| `--max-pages` | Maximum SERP pages per query |
| `--page-concurrency` | Load direct result-page URLs in parallel tabs, `1` to `8` |
| `--delay-ms` / `--fast` | Sequential page pacing controls |
| `--fields` | Select output result fields, or `all` |
| `--open-only` | Open the query and keep the browser alive for manual testing |
| `--connect-cdp` | Attach to an existing Chrome DevTools endpoint |

## Output Structure

```txt
<out>/
├── manifest.json
└── queries/
    └── 001-zoned-out-lecture-site-reddit-com-<hash>.json
```

Each query file contains one JSON object:

```json
{
  "query": "\"zoned out\" lecture site:reddit.com",
  "metadata": {
    "query": "\"zoned out\" lecture site:reddit.com",
    "startedAt": "2026-06-01T12:00:00.000Z",
    "finishedAt": "2026-06-01T12:03:00.000Z",
    "maxPages": 10,
    "pageConcurrency": 5,
    "delayMs": { "min": 0, "max": 0 },
    "pagesCollected": 10,
    "totalRawResults": 96,
    "totalUniqueResults": 84,
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

Default result fields:

- `title`
- `url`
- `source`
- `displayUrl`
- `snippet`
- `rank`

`--fields all` also includes provenance/debug fields such as page, rank on page, language, result position, Google data attributes, and collection timestamp.

## Browser Behavior

Default browser mode:

- Playwright persistent context
- headed browser
- Chrome channel when available, Playwright Chromium fallback otherwise
- profile directory: `scripts/.chrome-profile`
- viewport: `1366x900`
- locale: `en-US`

Diagnostic modes:

- `--open-only` loads the query and keeps the browser open for manual navigation testing.
- `--connect-cdp <url>` attaches to an existing Chrome DevTools endpoint and opens a new tab.

## CAPTCHA And Consent

CAPTCHA/unusual-traffic detection checks:

- `/sorry/` in the URL
- `unusual traffic`
- `Our systems have detected`
- `I'm not a robot` / `I’m not a robot`

When detected, the command prints:

```txt
CAPTCHA detected. Solve it in the browser. Collection will continue automatically, or press Enter here to re-check now.
```

The command polls until the challenge clears. It never attempts to bypass CAPTCHA.

## Extraction

Organic extraction is defensive because Google markup changes often:

- Prefer visible result blocks with a visible `h3` inside an anchor.
- Ignore ads, People Also Ask, image packs, Google internal links, cache links, translate links, and empty titles.
- Extract title, final URL, visible source, display URL, snippet, language, result position, and optional debug data attributes.
- Deduplicate by normalized final URL.

## Pagination And Speed

Sequential mode:

- Page 1 loads normally.
- Later pages use direct `start=` URLs.
- `--delay-ms` controls delay between sequential pages.

Parallel-page mode:

- `--page-concurrency N` opens direct result-page URLs in parallel tabs.
- Results are merged back in page order so final ranks remain deterministic.
- This overlaps Google's slow page requests and is the recommended speed workaround.
- Start with `2` or `3`; `5` worked in manual testing but may increase CAPTCHA pressure.

## Stop Reasons

| Reason | Meaning |
|--------|---------|
| `max_pages` | Reached `--max-pages` |
| `no_next_page` | No next page or repeated zero-result pages |
| `captcha_timeout` | CAPTCHA did not clear |
| `manual_stop` | User interrupted with `Ctrl+C` |
| `error` | Unexpected failure after saving progress where possible |

## Verification

```bash
node --check serp-helpers/collect-google.mjs
node --check serp-helpers/google.mjs
node run.js collect-serp --help
pnpm test:serp
```
