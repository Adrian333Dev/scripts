# Google SERP Collector Implementation Record

**Status:** Complete

## Implemented

- [x] Registered `collect-serp` in `run.js`.
- [x] Added Playwright dependency and `pnpm collect-serp` / `pnpm test:serp` scripts.
- [x] Implemented headed Playwright browser sessions with a persistent automation profile.
- [x] Added optional Chrome DevTools Protocol attach mode with `--connect-cdp`.
- [x] Added `--open-only` manual browser test mode.
- [x] Added one-query, repeated-query, and `--queries-file` support.
- [x] Added output under `<out>/manifest.json` and `<out>/queries/*.json`.
- [x] Added configurable output fields with `--fields`.
- [x] Added richer result extraction: title, URL, source, display URL, snippet, language, result position, and optional debug attributes.
- [x] Added URL normalization and deduplication.
- [x] Added CAPTCHA/unusual-traffic detection and manual polling.
- [x] Added direct `start=` page navigation.
- [x] Added `--page-concurrency` for parallel direct page loads in separate tabs.
- [x] Added tests for CLI parsing, output writing, extraction, normalization, CAPTCHA handling, and pagination helpers.
- [x] Added README documentation and `serp-helpers/README.md`.

## Final Recommended Speed Path

Manual testing showed individual Google paginated requests may stall for roughly 5-7 seconds in the Playwright-launched browser. Parallel page loading overlaps those waits:

```bash
node run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --max-pages 10 \
  --page-concurrency 5 \
  --delay-ms 0:0 \
  --out runs/test-parallel \
  --verbose
```

Start lower, such as `--page-concurrency 2` or `3`, if CAPTCHA pressure increases.

## Verification

```bash
node --check serp-helpers/collect-google.mjs
node --check serp-helpers/google.mjs
node run.js collect-serp --help
pnpm test:serp
```
