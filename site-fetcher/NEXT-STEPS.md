# Site Fetcher Next Steps

This document records the known issues, risks, and future implementation work for `extract-sources` and `compact-sources`. The current implementation is useful for testing, but it is not finished enough to be treated as a reliable large-scale source ingestion pipeline.

## Current State

Implemented commands:

- `extract-sources`: fetches known URLs into a Markdown corpus.
- `compact-sources`: reads extracted Markdown and writes a smaller LLM-oriented corpus.

Current extraction path:

```txt
auto: direct HTTP -> Readability -> Reddit old fallback when applicable -> Jina fallback
http: direct HTTP -> Readability -> Reddit old fallback when applicable
jina: Jina Reader only
```

Current compaction path:

```txt
raw source Markdown -> strip obvious shell/noise/image/html artifacts -> dedupe repeated blocks -> block-page placeholder -> per-source char cap
```

The current design intentionally keeps raw fetched files intact. Compaction writes a second corpus so the raw source remains available for audit, reruns, and better future extraction.

## Known Examples

These files exposed the main failure modes:

- `001-how-to-learn-english-easily-quora.md`: Jina can return large but usable content with significant shell/noise and repeated low-value content.
- `001-this-subreddit-is-just-filled-with-indians-creating-ai-slop.md`: Reddit's modern site can return a verification page, while `old.reddit.com` can return server-rendered content.
- `001-forum-lazarus-freepascal-org.md`: Jina returned usable forum content, but with noisy forum artifacts such as icons, `Logged`, separators, profile signatures, and repeated quoted text.
- `001-forums-codeguru-com.md`: Jina returned a bot/security verification page.
- `001-vbforums-com.md`: Jina returned a bot/security verification page.

## Main Conclusions

Jina is not a dependable final fallback. It helps for some pages, especially when direct HTTP fails, but it can also return CAPTCHA, Cloudflare, or security-verification pages. Those pages must be detected and treated as unusable, not weak evidence.

Generic local extraction is also not enough. Direct HTTP plus Readability works well for article-like pages, but forums, Q&A pages, Reddit, Quora, and older community sites often require additional structure-aware extraction or better fallback options.

Deterministic compaction is necessary but not sufficient. It can prevent obvious token explosions and remove boilerplate, but it cannot reliably decide what is important. A later semantic distillation step is likely needed for 100+ source workflows.

## Priority 1: Fix Incorrect Success States

### Problem

Some blocked pages are currently classified late or only during compaction. The extractor itself should avoid writing bot-check pages as usable source files whenever possible.

### Required Work

- Strengthen `classifyExtraction` with more block-page signatures.
- Add tests from real blocked snippets:
  - `Performing security verification`
  - `security service to protect against malicious bots`
  - `Just a moment...`
  - `Please wait for verification`
  - `Enable JavaScript and cookies to continue`
  - `Checking if the site connection is secure`
- Make Jina extraction run the same block detection after cleanup.
- Consider returning `manual_required` even when the HTTP status is `200` if the text clearly describes verification.

### Acceptance Criteria

- CodeGuru/VBForums-style bot-check output must not produce `sources/*.md` as usable evidence.
- Manifest should count those URLs under `manualRequired`.
- Compaction should still keep the placeholder behavior as a second safety net.

## Priority 2: Add Fetch Attempt Diagnostics

### Problem

When a URL fails or returns weak content, it is hard to tell which method failed, why it failed, and whether another fallback might help.

### Required Work

- Extend metadata with a structured `attempts` array:

```json
[
  {
    "method": "http-readability",
    "status": "manual_required",
    "reason": "http_403",
    "httpStatus": 403,
    "textLength": 0,
    "fetchedUrl": "https://example.com/page"
  },
  {
    "method": "jina",
    "status": "manual_required",
    "reason": "captcha_or_login_or_block",
    "httpStatus": 200,
    "textLength": 281,
    "fetchedUrl": "https://r.jina.ai/http://https://example.com/page"
  }
]
```

- Store only concise diagnostics by default.
- Add `--debug-artifacts` support for method-specific raw artifacts where safe and useful.

### Acceptance Criteria

- A failed URL can be diagnosed from one metadata JSON file without rerunning.
- The manifest can summarize counts by final status and by attempted method.

## Priority 3: Better Fallback Strategy

### Problem

The current fallback chain is too shallow. If direct HTTP and Jina both fail, the command has no browser-rendered or alternate-reader option.

### Possible Solutions

- Add a `browser` extraction method using Playwright:
  - Load page with a real browser context.
  - Wait for network idle or a configurable selector.
  - Extract `document.body.innerText` plus optional HTML.
  - Run Readability inside the browser page when possible.
  - Detect CAPTCHA/login/security pages before accepting content.
- Add an `auto` chain that can be configured:

```txt
http -> site-specific fallback -> jina no-key -> jina key -> browser -> manual_required
```

- Add `--methods` or `--fallbacks` option if a fixed `--method` becomes too limiting.
- Add a per-domain cooldown/rate limit so browser fallback does not hammer protected sites.

### Risks

- Browser extraction is slower and may trigger bot protection if abused.
- It can accidentally capture cookie banners, login pages, or SPA shells.
- It may require a persistent browser profile for pages that need user cookies.

### Acceptance Criteria

- Browser fallback is opt-in at first.
- `auto` remains conservative and does not try expensive fallbacks unless explicitly enabled.
- Captured browser content is quality-scored before it becomes a source file.

## Priority 4: Jina Handling

### Problem

Jina has two usage modes:

- no API key: easier and does not consume paid/keyed quota, but limited by IP rate limits and reliability.
- API key: higher quota, but consumes account resources.

Current code only uses a key if `--jina-api-key-env` is supplied. It does not implement a no-key-to-key retry mode.

### Required Work

- Add `--jina-mode auto|no-key|key`.
- In `auto`, try no-key first, then retry with key only for rate-limit or transient failures.
- Detect and record Jina-specific failure types:
  - rate limit
  - upstream bot check
  - empty response
  - wrapper-only response
  - non-content response
- Make the Jina Reader URL construction explicit and tested.

### Acceptance Criteria

- A run can conserve keyed quota by default.
- If no-key Jina hits rate limits and a key is available, the retry is visible in metadata.
- Jina bot-check pages are never accepted as usable source content.

## Priority 5: Site-Specific Extractors

### Problem

Fully generic extraction will not work equally well across forums, Q&A sites, Reddit, and article pages. The Reddit old fallback showed that site-specific handling can materially improve results.

### Approach

Do not write one-off hacks for every domain immediately. Instead, build a small extractor registry:

```txt
extractors/
  reddit-old
  forum-generic
  stackexchange
  quora
  vbulletin
  discourse
```

Each extractor should expose:

```js
{
  name,
  matches(url),
  extract(url, options)
}
```

### Candidate Extractors

- `reddit-old`: already exists as `reddit-extract.mjs`; formalize it into the registry.
- `forum-generic`: clean common forum layouts and signatures from server-rendered HTML or Jina Markdown.
- `vbulletin`: likely useful for `vbforums.com` and `forums.codeguru.com` if reachable.
- `discourse`: many modern forums have predictable JSON endpoints and page structure.
- `stackexchange`: Stack Exchange pages have stable post/comment/vote structure and can be extracted cleanly.
- `quora`: high risk because content is often gated and noisy; treat as a later extractor.

### Acceptance Criteria

- Extractor choice is recorded in metadata.
- Generic fallback remains available.
- Site-specific extractors are tested with saved fixtures, not only live network calls.

## Priority 6: Stronger Compaction

### Problem

Current deterministic compaction is intentionally simple. It removes obvious noise and caps size, but it can still preserve too much low-value content:

- repeated quoted replies
- user signatures
- forum OS/version footers
- vote/share/action labels
- repeated headings
- unrelated recommendations
- massive code blocks or pasted logs
- old quote chains

### Required Work

- Add compaction modes:

```txt
clean: remove boilerplate only, no semantic judgment
compact: default, deterministic cleanup plus caps
evidence: keep likely facts, quotes, code snippets, accepted/top answers
outline: headings plus short excerpts only
```

- Add options:

```txt
--max-source-chars <n>
--max-block-chars <n>
--max-code-chars <n>
--drop-quotes
--keep-code
--drop-signatures
--min-block-chars <n>
```

- Treat raw HTML as a first-class failure/safety case:
  - strip scripts/styles
  - strip tags
  - cap before and after cleanup
  - if text still looks like markup/shell, mark `blocked` or `weak_compaction`

### Acceptance Criteria

- No compacted file can exceed the configured max unless explicitly disabled.
- Manifest reports total original chars, compact chars, saved chars, truncated count, blocked count, and weak-compaction count.
- Compact output remains traceable to the original source filename.

## Priority 7: Semantic Distillation

### Problem

For 100+ sources, deterministic compaction is not enough. Even 10k chars per source can be too expensive, and many sources contain only a few useful claims.

### Proposed Command

```bash
node scripts/run.js distill-sources \
  --input runs/project/corpus/compact \
  --out runs/project/corpus/distilled \
  --mode research
```

### Output Shape

Each source could produce a compact research note:

````md
# Source Title

Source: https://example.com/page
Status: distilled

## Useful Claims

- Claim...
- Claim...

## Relevant Quotes

- "Short quote..." - context

## Code / Procedures

```txt
...
```

## Caveats

- Source is old.
- Thread has conflicting answers.
````

### Requirements

- Keep raw and compact files as traceability layers.
- Distillation should never overwrite raw or compact content.
- Include source URL and original file in every distilled note.
- Consider chunking long sources before LLM distillation.
- Consider deterministic pre-selection before sending content to an LLM.

### Risks

- LLM distillation can drop important minority details.
- Quotes may be paraphrased unless explicitly constrained.
- Cost can still be high without chunking and source caps.

## Priority 8: Output Hygiene and Stale Files

### Problem

When refetching a URL with `--force`, title changes can produce a new source filename while the old source file remains in `sources/`.

### Required Work

- Store previous `sourceFile` in metadata.
- On force refetch, remove or mark stale previous source files for the same hash.
- Alternatively write source files by stable hash plus optional slug:

```txt
sources/001-<slug>-<hash-prefix>.md
```

or

```txt
sources/<hash>.md
```

### Acceptance Criteria

- A corpus directory cannot silently contain stale source files for a refetched URL.
- Manifest outputs should be the authoritative list of current source files.

## Priority 9: Corpus-Level Budgeting

### Problem

Per-source caps are not enough. A 100-source run at 12k chars per source can still produce over 1.2M characters.

### Required Work

- Add corpus-level budgeting to `compact-sources`:

```txt
--max-total-chars <n>
--allocation equal|weighted
--priority-file <path>
```

- Possible weighting signals:
  - SERP rank
  - source type
  - extraction quality
  - domain trust/priority
  - user-supplied priority

### Acceptance Criteria

- The compact manifest reports whether the total budget was hit.
- Low-priority sources can be heavily reduced before high-priority ones.

## Priority 10: Quality Scoring

### Problem

Current status values (`ok`, `weak`, `manual_required`, `failed`) are too coarse. We need a better quality signal before deciding whether a source should enter compaction or distillation.

### Proposed Signals

- text length
- title quality
- sentence count
- code block count
- link-to-text ratio
- repeated-block ratio
- blocked-page signature hits
- navigation/noise ratio
- boilerplate phrase count
- source method reliability

### Output

Add fields:

```json
{
  "qualityScore": 0.82,
  "qualityFlags": ["high_repetition", "missing_title"]
}
```

### Acceptance Criteria

- A high-volume run can be sorted by quality.
- Bad sources can be excluded from distillation automatically.

## Priority 11: Test Fixtures

### Problem

The current tests are mostly synthetic. We need realistic fixtures so future cleanup changes do not regress known pages.

### Required Fixtures

- Reddit verification page.
- Old Reddit thread HTML.
- Quora Jina Markdown output.
- Forum Lazarus Jina Markdown output.
- CodeGuru security verification Jina output.
- VBForums security verification Jina output.
- Generic article Readability HTML.
- Raw HTML dump that should be stripped safely.

### Acceptance Criteria

- Tests do not require network access.
- Each fixture has an expected status and compacted-output snapshot or key assertions.

## Priority 12: Documentation Updates

### Required Work

- Update `site-fetcher/README.md` after implementing each major change.
- Add a short operational recommendation:

```txt
1. extract-sources
2. inspect manifest failures/manual_required
3. compact-sources
4. inspect blocked/truncated counts
5. distill-sources, when implemented
```

- Document that `compact-sources` is a safety and cleanup layer, not a true semantic summarizer.
- Document Jina quota/rate-limit behavior and the recommended no-key/key strategy once implemented.

## Suggested Implementation Order

1. Improve block-page detection and extractor metadata attempts.
2. Add realistic fixtures for the examples above.
3. Refactor method handling into an extractor registry.
4. Add browser fallback as opt-in.
5. Strengthen compaction modes and corpus-level budgeting.
6. Add semantic `distill-sources` only after deterministic extraction/compaction is stable.

## Open Design Questions

- Should `auto` ever run browser fallback by default, or should it always require an explicit flag?
- Should weak sources be written to `sources/`, or should they go to a separate `weak/` directory?
- Should compact output include frontmatter from raw sources, or should it normalize metadata into a smaller header?
- Should blocked compact files exist at all, or should blocked sources only appear in manifest?
- Should site-specific extractors be opt-in, or should the registry always choose the best match?
- What is the target maximum corpus size before feeding an LLM: per source, total corpus, or both?

## Current Risk Summary

- Large-scale runs will still produce many `manual_required` URLs.
- Jina may return blocked pages and must never be trusted blindly.
- Generic extraction will miss or mangle some forum/Q&A structures.
- Compaction can reduce size but cannot reliably identify the most important information.
- Without corpus-level budgeting, 100+ compacted sources can still be too large.
- Without realistic fixtures, cleanup improvements can easily regress earlier examples.
