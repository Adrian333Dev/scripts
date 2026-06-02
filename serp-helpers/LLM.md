# collect-serp LLM Context

Use this when you need a quick model-readable summary of the SERP tool.

## What It Does

`collect-serp` is a JavaScript CLI in this repo. It opens a visible Playwright browser, runs Google searches, extracts organic results, dedupes normalized URLs, and writes structured result files.

## Main Command

```bash
node run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --max-pages 10 \
  --page-concurrency 5 \
  --delay-ms 0:0 \
  --out runs/test \
  --verbose
```

## Important Constraints

- Result pages are loaded through direct Google `start=` URLs.
- `--page-concurrency` opens multiple page URLs in tabs and merges results in page order.
- CAPTCHA handling is manual. No stealth, proxies, CAPTCHA solvers, or bot bypass.
- Browser state persists in `scripts/.chrome-profile` by default.

## Output

```txt
<out>/
├── manifest.json
└── queries/
    └── 001-<query-slug>-<hash>.json
```

Each query JSON has:

- `query`
- `metadata`
- `results`

Default result fields:

- `title`
- `url`
- `source`
- `displayUrl`
- `snippet`
- `rank`

Use `--fields all` for debug/provenance fields.

## Code Map

- `collect-google.mjs`: CLI and orchestration
- `google.mjs`: browser/session/navigation
- `extract.mjs`: Google result parsing
- `normalize.mjs`: URL cleanup/dedupe
- `output.mjs`: JSON output
- `captcha.mjs`: CAPTCHA detection/manual wait

## Known Performance Finding

Google may delay individual paginated requests in the Playwright browser by 5-7 seconds. Parallel tabs overlap those delays; `--page-concurrency 5` worked in manual testing. Reduce to `2` or `3` if CAPTCHA pressure increases.
