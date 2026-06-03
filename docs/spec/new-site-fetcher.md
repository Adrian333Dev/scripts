# Webpage Fetching and Markdown Extraction Strategy

## Goal

We need a reliable way to turn a list of discovered URLs into clean, usable Markdown/text files.

This is the missing layer between:

```txt
Google SERP results → candidate URLs
```

and:

```txt
usable research corpus → LLM analysis
```

The purpose is not to scrape the whole internet perfectly. The purpose is to extract enough useful customer conversation, comments, reviews, forum posts, and public page content to support market research.

The output should be a local corpus of Markdown/text files, each with metadata, source URL, extraction method, and quality status.

---

## Core Principle

There is no fully free tool that can reliably extract clean content from every website.

A realistic system should use a layered fallback approach:

```txt
1. Jina Reader
2. Direct HTTP + local extraction
3. Playwright browser rendering
4. Manual-required status for blocked/login/CAPTCHA pages
```

The system should never depend on CAPTCHA bypass, proxy rotation, stealth plugins, or bot-evasion techniques.

If a source is blocked, login-gated, or CAPTCHA-protected, mark it as:

```txt
manual_required
```

and move on.

---

## Recommended Extraction Pipeline

For each URL:

```txt
URL
 ↓
Check cache
 ↓
Try Jina Reader
 ↓
If weak/failed, try direct HTTP + Trafilatura/Readability
 ↓
If weak/failed, try Playwright render + Trafilatura/Readability
 ↓
If still blocked, mark manual_required
 ↓
Save Markdown + metadata
```

---

# 1. Jina Reader

## What it is

Jina Reader converts public webpages into LLM-friendly Markdown. It can be used by prepending a URL with `https://r.jina.ai/`, and it also supports API-key usage.

Jina describes Reader as a free API that converts URLs into clean content for grounding and LLM usage. It also says new API keys receive free tokens.

## Usage styles

### No-key URL prefix

Example:

```txt
https://r.jina.ai/http://example.com
```

This is the simplest way to test extraction.

Pros:

```txt
- Very easy
- No local scraping code needed
- Good Markdown output when it works
- Useful for prototyping
```

Cons:

```txt
- Rate limits are less controllable
- IP-based limits may apply
- Less visibility into usage
- External dependency
```

### API-key mode

Example:

```bash
curl "https://r.jina.ai/http://example.com" \
  -H "Authorization: Bearer $JINA_API_KEY"
```

Pros:

```txt
- Better rate limits
- Usage tracking
- More suitable for automation
- Free token allowance
```

Cons:

```txt
- Token budget must be managed
- Still not guaranteed for every site
- Still may fail on blocked/login-gated pages
```

## Token-budget interpretation

If the free allowance is around 10 million tokens, then the practical capacity depends on how Jina counts each page. For planning, assume a conservative minimum of roughly 10,000 tokens per URL.

Rough estimate:

```txt
10M tokens ≈ ~1,000 URL extractions
20M tokens ≈ ~2,000 URL extractions
30M tokens ≈ ~3,000 URL extractions
```

This is enough for a serious MVP if the system does not fetch every SERP result blindly.

Recommended usage:

```txt
1. Collect many SERP results.
2. Dedupe URLs.
3. Pre-score candidates using title/snippet/query/rank.
4. Send only promising URLs to Jina.
5. Cache every successful extraction.
```

## Where Jina should sit in the pipeline

Jina should be the first real extraction method because it is simple and returns Markdown directly.

Recommended status values:

```txt
method: "jina"
status: "ok" | "weak" | "failed"
```

A Jina extraction should be considered weak if:

```txt
- content is too short
- page title is missing
- returned content looks like a block page
- returned content is mostly navigation/boilerplate
- customer comments/thread content is missing
```

---

# 2. Direct HTTP + Local Extraction

## What it is

This method fetches the raw HTML directly using `fetch`, `undici`, `axios`, or Python `requests`, then extracts the main readable content locally.

Good local extractors include:

```txt
- Trafilatura
- Mozilla Readability
```

## Trafilatura

Trafilatura is a Python package and command-line tool for gathering text from the web. Its docs say it includes discovery, extraction, and text-processing components, and can extract main text, metadata, and comments.

Good for:

```txt
- articles
- blogs
- old forums
- static pages
- pages with mostly server-rendered HTML
```

Weak for:

```txt
- JavaScript-heavy pages
- pages requiring login
- CAPTCHA-protected pages
- pages where comments load dynamically
```

Possible command-style usage:

```bash
python -m trafilatura -u "https://example.com/page"
```

Possible internal usage:

```python
import trafilatura

downloaded = trafilatura.fetch_url(url)
text = trafilatura.extract(downloaded, include_comments=True, include_tables=True)
```

## Mozilla Readability

Mozilla Readability is the standalone library used for Firefox Reader View, and it is available on npm as `@mozilla/readability`.

Good for:

```txt
- article-style pages
- blog posts
- clean content extraction in Node.js
```

Weak for:

```txt
- forum threads
- Reddit discussions
- pages where comments matter
- non-article layouts
```

Typical Node stack:

```txt
undici/fetch → jsdom → @mozilla/readability → Markdown conversion
```

## Where this fits

Direct HTTP extraction is useful as a fallback to Jina or as a cost-saving step.

Recommended order:

```txt
Jina first for simplicity
Direct HTTP second for local fallback/cost control
```

Or, if preserving Jina tokens is more important:

```txt
Direct HTTP first
Jina second
```

For this project, the better MVP order is probably:

```txt
Jina first → local fallback
```

because it gets clean Markdown faster.

---

# 3. Playwright Browser Rendering

## What it is

Some pages need JavaScript rendering before the useful content appears. In those cases, use Playwright to open the page in a browser, wait for the page to load, capture the rendered DOM, and then run extraction on that HTML.

Playwright supports browser control and can attach to Chromium-based browsers over Chrome DevTools Protocol.

## When to use it

Use Playwright when:

```txt
- direct HTTP returns empty/blocked/minimal HTML
- content appears only after JS loads
- page requires scrolling to load comments
- Jina returns weak output
```

Do not use Playwright to bypass access controls.

## Headed vs headless

For extraction, headless is usually fine.

For human-in-the-loop cases, headed is better:

```txt
- user can see the page
- user can handle consent dialogs
- user can log in if appropriate
- user can solve CAPTCHA manually
```

Recommended strategy:

```txt
Playwright headless by default
Playwright headed/manual mode when needed
```

## Manual-required flow

If a page shows CAPTCHA, unusual traffic, or a login wall:

```txt
1. Mark page as manual_required.
2. Optionally open it in visible browser.
3. Let user decide whether to handle manually.
4. If user resolves it, capture rendered DOM.
5. Otherwise skip.
```

Do not automate CAPTCHA solving.

---

# 4. CAPTCHA and Bot Protection

## Reality

No free universal extractor can reliably handle CAPTCHA and bot protection across the web.

There are only a few realistic approaches:

```txt
1. Avoid triggering protection with low-volume, normal behavior.
2. Use paid scraping infrastructure.
3. Use human-in-the-loop manual handling.
```

For this project, the acceptable approach is:

```txt
low-volume fetching + cache + manual_required status
```

The system should not include:

```txt
- CAPTCHA-solving services
- proxy rotation
- residential proxy pools
- stealth plugins
- browser fingerprint spoofing
- anti-bot bypass logic
```

## How blocked pages should be represented

A blocked source is still useful metadata. Save it as a failed/manual-required record.

Example:

```json
{
  "url": "https://example.com/thread",
  "status": "manual_required",
  "reason": "captcha_or_login",
  "methodAttempts": ["jina", "http", "playwright"],
  "extractedAt": "2026-06-02T00:00:00Z"
}
```

---

# 5. Caching Strategy

Caching is essential.

The system should never extract the same URL twice unless forced.

Recommended cache key:

```txt
sha256(normalized_url)
```

Cache files:

```txt
cache/
  sources/
    <hash>.md
    <hash>.json
```

Metadata should include:

```json
{
  "url": "original URL",
  "normalizedUrl": "normalized URL",
  "title": "Page title",
  "status": "ok",
  "method": "jina",
  "textLength": 12345,
  "contentHash": "sha256(markdown)",
  "extractedAt": "2026-06-02T00:00:00Z"
}
```

Cache statuses:

```txt
ok
weak
failed
manual_required
skipped
```

Cache benefits:

```txt
- saves Jina tokens
- avoids repeated bot triggers
- makes runs resumable
- allows later rescoring without refetching
```

---

# 6. URL Normalization

Before fetching, normalize URLs.

Basic normalization:

```txt
- remove Google redirect wrappers
- remove utm_* params
- remove fbclid, gclid, msclkid
- remove trailing slash where safe
- preserve meaningful paths and query params
```

For Reddit and forums, be careful not to over-normalize. Comment/thread URLs often contain meaningful path structure.

Example:

```txt
https://www.reddit.com/r/example/comments/abc123/title/?utm_source=...
→
https://www.reddit.com/r/example/comments/abc123/title/
```

---

# 7. Markdown Output Format

Each extracted source should become one Markdown file.

Recommended format:

```md
---
url: "https://example.com/thread"
normalized_url: "https://example.com/thread"
title: "Thread title"
source: "example.com"
platform: "forum"
method: "jina"
status: "ok"
extracted_at: "2026-06-02T00:00:00Z"
text_length: 12345
---

# Thread title

Source: https://example.com/thread

## Extracted Content

[clean Markdown content here]
```

If the source is weak or failed:

```md
---
url: "https://example.com/thread"
status: "manual_required"
reason: "captcha_or_login"
---

# Extraction failed

This source could not be extracted automatically.
```

---

# 8. Candidate Pre-Scoring Before Fetching

Do not send every URL to Jina immediately.

First score candidates using cheap SERP metadata:

```txt
- title
- snippet
- URL/domain
- query that found it
- Google rank
- platform
```

Pre-score examples:

High-value signals:

```txt
- Reddit/forum/thread URL
- first-person language in title/snippet
- pain words: struggle, problem, frustrated, can't, hard, confused
- target context appears: lecture, podcast, video, meeting, course, tutorial
- result found by multiple queries
- high rank across several queries
```

Low-value signals:

```txt
- generic SEO article
- vendor landing page
- dictionary/explainer page
- unrelated meaning of the phrase
- result from wrong audience
```

Recommended policy:

```txt
SERP raw results: maybe 1,000
deduped URLs: maybe 500–700
fetch first batch: top 200–400
then continue only if needed
```

---

# 9. Full Extraction Decision Tree

Use this decision tree per URL:

```txt
1. Is URL already cached?
   → use cache

2. Does URL look obviously irrelevant from SERP metadata?
   → skip or low priority

3. Try Jina Reader.
   → if content ok, save

4. Try direct HTTP + Trafilatura/Readability.
   → if content ok, save

5. Try Playwright render.
   → if content ok, save

6. If CAPTCHA/login/block:
   → mark manual_required

7. If all methods fail:
   → mark failed
```

---

# 10. Quality Checks for Extracted Content

After extraction, evaluate the output before adding it to the research corpus.

Basic checks:

```txt
- text length above threshold
- title exists
- source URL preserved
- content is not only nav/footer/cookie text
- content is not a CAPTCHA/block page
- content contains enough natural language
```

Market-research-specific checks:

```txt
- does it include first-person language?
- does it contain pain/problem language?
- does it appear to include comments/replies/reviews?
- is the target audience speaking?
- is it a real discussion, not just an article?
```

A page can extract successfully but still be research-useless. Extraction quality and research relevance should be scored separately.

---

# 11. Recommended Tool Interface

Create a command such as:

```bash
node scripts/run.js extract-sources \
  --input runs/<project>/serp \
  --out runs/<project>/corpus \
  --max-urls 300 \
  --jina-api-key-env JINA_API_KEY
```

Alternative input:

```bash
node scripts/run.js extract-sources \
  --urls-file urls.txt \
  --out runs/<project>/corpus
```

Useful options:

```txt
--input
--urls-file
--out
--max-urls
--method jina|http|playwright|auto
--jina-api-key-env
--cache-dir
--concurrency
--delay-ms
--resume
--force
--include-failed
--verbose
```

Default behavior:

```txt
method: auto
concurrency: low, e.g. 3–5
cache: enabled
resume: enabled
```

---

# 12. Recommended Output Directory

```txt
runs/<project>/corpus/
  manifest.json
  sources/
    001-source-title.md
    002-source-title.md
  metadata/
    <hash>.json
  failed/
    <hash>.json
  logs/
    extraction.log
```

Manifest:

```json
{
  "startedAt": "2026-06-02T00:00:00Z",
  "finishedAt": "2026-06-02T00:30:00Z",
  "totalCandidates": 650,
  "attempted": 300,
  "ok": 220,
  "weak": 35,
  "manualRequired": 20,
  "failed": 25,
  "methods": {
    "jina": 180,
    "http": 30,
    "playwright": 10
  }
}
```

---

# 13. Handling Platform-Specific Sources

## Reddit

Reddit is important for market research, but extraction can be inconsistent.

Options:

```txt
- Jina Reader
- direct page fetch
- Playwright render
- Reddit API if appropriate
```

For market research, comments matter. If the extraction only captures the original post and not comments, mark it as weak.

## YouTube

For YouTube, the video page itself is often not enough. The valuable content may be comments.

Possible approaches:

```txt
- YouTube Data API for comments
- manual/exported comments
- browser-based comment extraction
```

Jina may summarize or extract page text, but it may not capture enough comments.

## Forums

Old forums are usually good candidates for direct HTTP + Trafilatura/Readability.

They are often server-rendered and easier to extract than modern JS-heavy apps.

## Quora, LinkedIn, X/Twitter, Discord, Facebook

These are harder.

Default stance:

```txt
- try extraction
- if login-gated or incomplete, mark manual_required
- do not spend too much automation effort early
```

---

# 14. Recommended MVP

The first version should be simple:

```txt
Input: SERP output JSON or urls.txt
Output: Markdown corpus
Methods:
  1. Jina Reader API
  2. Direct HTTP + Trafilatura fallback
  3. Manual-required marking
```

Do not include Playwright extraction in the first version unless needed immediately.

MVP success criteria:

```txt
- Can process 200 URLs
- Produces Markdown files
- Caches results
- Tracks failures
- Does not refetch duplicates
- Keeps source URLs
- Produces manifest.json
```

Then add:

```txt
- Playwright fallback
- platform-specific Reddit extraction
- source relevance scoring
- quote extraction
```

---

# 15. Final Recommendation

Use a layered extractor.

Best practical design:

```txt
Jina Reader first
→ direct HTTP + Trafilatura/Readability fallback
→ Playwright render fallback
→ manual_required for blocked pages
```

Why this is the best fit:

```txt
- Jina gives fast URL-to-Markdown extraction.
- Local tools reduce dependency and help when Jina fails.
- Playwright covers JS-heavy pages.
- Manual-required handling avoids brittle or unsafe bot-bypass work.
- Caching keeps token usage and bot risk low.
```

The goal is not perfect extraction from every website.

The goal is:

```txt
enough clean, source-linked Markdown from enough relevant public pages
to support reliable market research analysis.
```
