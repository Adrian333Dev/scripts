# Site Fetcher

`extract-sources` turns a known list of URLs into a local Markdown research corpus. It is designed to run after URL discovery, such as `collect-serp`, but it does not decide which URLs are worth fetching.

`compact-sources` turns that raw corpus into a smaller LLM-ready corpus while keeping the original fetched files intact.

## Quick Run

```bash
node run.js extract-sources \
  --url 'https://example.com/' \
  --out runs/site-corpus \
  --verbose
```

## Test One URL

From inside this `scripts/` repo:

```bash
node run.js extract-sources \
  --url 'https://example.com/' \
  --out runs/site-fetcher-single \
  --force \
  --verbose
```

From another project root that contains this repo as `scripts/`:

```bash
node scripts/run.js extract-sources \
  --url 'https://example.com/' \
  --out runs/site-fetcher-single \
  --force \
  --verbose
```

Keep raw HTML for debugging extraction quality:

```bash
node scripts/run.js extract-sources \
  --url 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise' \
  --out runs/site-fetcher-debug \
  --force \
  --debug-artifacts \
  --verbose
```

From another project root that contains this repo as `scripts/`:

```bash
node scripts/run.js extract-sources --urls-file urls.txt --out runs/site-corpus
```

## SERP Input

```bash
node scripts/run.js extract-sources \
  --input runs/project/serp \
  --out runs/project/corpus \
  --max-urls 300
```

The command reads `collect-serp` query JSON files, dedupes normalized URLs, and attempts every remaining URL in input order unless `--max-urls` is set.

## Current Extraction Method

The current implementation is local and free to run:

```txt
auto: direct HTTP -> Readability -> Reddit old fallback when applicable -> Jina fallback
http: direct HTTP -> Readability -> Reddit old fallback when applicable
jina: Jina Reader only
```

It does not bypass CAPTCHA, login walls, Cloudflare challenges, or bot protection. Those sources are marked as `manual_required` when detected.

## Options

| Option | Purpose |
|--------|---------|
| `--url` | URL to fetch; repeat for multiple URLs |
| `--input` | SERP output directory or a SERP JSON file |
| `--urls-file` | Newline-separated URL file; blank lines and `#` comments ignored |
| `--out` | Output corpus directory, default `runs/site-corpus` |
| `--max-urls` | Maximum deduped URLs to fetch |
| `--method` | Extraction method: `auto`, `http`, or `jina`; default `auto` |
| `--jina-api-key-env` | Read Jina API key from an environment variable |
| `--concurrency` | Parallel fetches, default `3` |
| `--timeout-ms` | Per-request timeout, default `20000` |
| `--force` | Refetch URLs even when cached metadata exists |
| `--debug-artifacts` | Keep raw artifacts where supported |
| `--verbose` | Log each URL status |

## Output

```txt
<out>/
├── manifest.json
├── sources/
│   └── 001-example-title.md
├── metadata/
│   └── <sha256-url>.json
├── failed/
│   └── <sha256-url>.json
└── artifacts/            # only with --debug-artifacts
    └── <sha256-url>.html
```

Successful and weak extractions produce Markdown files with frontmatter. Failed and manual-required sources produce JSON metadata under `failed/`.

## Verify

```bash
node --check site-fetcher/extract-sources.mjs
node --check site-fetcher/compact-sources.mjs
node run.js extract-sources --help
node run.js compact-sources --help
pnpm test:site-fetcher
```

## Compact Sources

Raw fetched pages can be too large to feed directly into an LLM. Run `compact-sources` after extraction to remove obvious shell noise, strip Markdown images, strip raw HTML tags/scripts, dedupe repeated blocks, and optionally cap each source. CAPTCHA, login, and bot-verification pages are replaced with an explicit blocked-source placeholder instead of being treated as evidence.

```bash
node run.js compact-sources \
  --input runs/site-fetcher-single \
  --verbose
```

From another project root:

```bash
node scripts/run.js compact-sources \
  --input runs/site-corpus \
  --out runs/site-corpus-compact \
  --verbose
```

Clean and dedupe without a character cap:

```bash
node scripts/run.js compact-sources \
  --input runs/site-corpus \
  --max-chars 0
```

### compact-sources options

| Option | Purpose |
|--------|---------|
| `--input` | Corpus directory containing `sources/*.md` |
| `--out` | Output directory, default `<input>/compact` |
| `--max-chars` | Maximum compacted body characters per source; default `12000`; use `0` to disable |
| `--keep-images` | Keep Markdown image lines |
| `--verbose` | Log each compacted source |

Output shape:

```txt
<out>/
├── manifest.json
└── sources/
    └── 001-example-title.md
```
