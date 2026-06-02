# Google SERP Collector Design

**Date:** 2026-06-01
**Status:** Implemented

## Summary

`collect-serp` is a repo-integrated JavaScript CLI command for collecting organic Google SERP results with a visible Playwright browser. It saves progress continuously, supports multiple queries, and keeps CAPTCHA handling manual.

The command lives in the existing scripts dispatcher:

```bash
node run.js collect-serp --query '"zoned out" lecture site:reddit.com'
```

## Module Layout

```txt
serp-helpers/
├── collect-google.mjs  # CLI parsing and run orchestration
├── google.mjs          # Playwright launch/session, search navigation, pagination
├── extract.mjs         # Defensive organic result extraction
├── normalize.mjs       # URL cleanup, Google redirect unwrapping, dedupe keys
├── output.mjs          # JSON query output and run manifest
├── captcha.mjs         # CAPTCHA detection and manual wait
└── __tests__/          # node:test coverage
```

## Key Decisions

- Use JavaScript ES modules, matching the repo's existing script style.
- Keep the tool inside this repo instead of a standalone package.
- Use Playwright because a visible browser and manual CAPTCHA handling are core requirements.
- Write structured per-query output for downstream research workflows.
- Default to a persistent automation profile at `scripts/.chrome-profile`.
- Provide `--connect-cdp` only as a diagnostic mode for attaching to an existing Chrome DevTools endpoint.
- Keep query execution sequential. Page-level concurrency is allowed with `--page-concurrency` because it overlaps slow paginated Google requests for one query while preserving output order.

## Output

```txt
<out>/
├── manifest.json
└── queries/
    └── 001-<query-slug>-<hash>.json
```

Each query JSON object contains:

- `query`
- `metadata`
- `results`

Default result fields are `title`, `url`, `source`, `displayUrl`, `snippet`, and `rank`. `--fields all` includes provenance/debug fields.

## Performance Finding

Manual testing showed the slow path is Google's page navigation request itself, not extraction or saving. Even manual clicks inside the Playwright-launched browser can trigger roughly 5-7 second delays on some result pages. Parallel tabs with direct `start=` URLs reduce wall-clock time by overlapping those requests:

```bash
node run.js collect-serp \
  --query '"zoned out" lecture site:reddit.com' \
  --max-pages 10 \
  --page-concurrency 5 \
  --delay-ms 0:0 \
  --out runs/test-parallel \
  --verbose
```

Use concurrency conservatively because higher values can increase CAPTCHA pressure.

## Verification

```bash
node --check serp-helpers/collect-google.mjs
node --check serp-helpers/google.mjs
node run.js collect-serp --help
pnpm test:serp
```
