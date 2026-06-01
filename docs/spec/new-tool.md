Build a local CLI tool called `google-serp-collector`.

Goal:
Given one Google search query, open a visible Chrome browser, run the query, collect as many organic Google search results as possible, paginate through results, pause for manual CAPTCHA if needed, and export results to JSON and CSV.

Scope:

- One input query.
- No query generation.
- No relevance scoring.
- No result filtering except deduplication by normalized URL.
- Collect title, URL, snippet, rank, page number, query, timestamp.
- Use Playwright with visible/headed Chrome.
- Use a persistent automation profile directory so cookies/search settings survive between runs.
- Do not use CAPTCHA-solving services, proxy rotation, stealth plugins, or bot-evasion logic.
- If CAPTCHA/unusual traffic page appears, pause and wait for the user to solve it manually in the visible browser.

Tech stack:

- Node.js
- TypeScript
- Playwright
- Commander.js or simple argv parsing
- csv-stringify or manual CSV writer
- Zod optional for output validation

CLI shape:

```bash
pnpm collect \
  --query '"zoned out" lecture (site:reddit.com inurl:comments|inurl:thread)' \
  --max-pages 20 \
  --out ./runs/zoned-out-lecture
```

Project structure:

```txt
google-serp-collector/
  package.json
  tsconfig.json
  src/
    cli.ts
    collect.ts
    google.ts
    extract.ts
    normalize.ts
    output.ts
    captcha.ts
    types.ts
  runs/
```

Output files:

```txt
runs/<slug>/results.json
runs/<slug>/results.csv
runs/<slug>/meta.json
```

Result schema:

```ts
type SearchResult = {
  query: string;
  page: number;
  rankOnPage: number;
  globalRank: number;
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  collectedAt: string;
};
```

Meta schema:

```ts
type RunMeta = {
  query: string;
  startedAt: string;
  finishedAt: string;
  maxPages: number;
  pagesCollected: number;
  totalRawResults: number;
  totalUniqueResults: number;
  stoppedReason:
    | "max_pages"
    | "no_next_page"
    | "captcha_timeout"
    | "manual_stop"
    | "error";
};
```

Implementation behavior:

1. Parse CLI args.
2. Create output directory.
3. Launch Playwright Chromium in headed mode with:
   - persistent profile directory: `./.chrome-profile`
   - channel: `"chrome"` if available
   - viewport: large desktop size
   - locale: `"en-US"` by default

4. Open `https://www.google.com/search?q=<encoded query>&num=10`.
5. Wait for page load.
6. If consent page appears, allow user to handle it manually or click a safe visible accept button only if obvious.
7. Detect CAPTCHA/unusual traffic pages by checking for text like:
   - “unusual traffic”
   - “Our systems have detected”
   - “I’m not a robot”
   - `/sorry/` in URL

8. If CAPTCHA appears:
   - print message: “CAPTCHA detected. Solve it in the browser, then press Enter here.”
   - wait for stdin Enter
   - re-check whether normal results are visible

9. Extract organic results from current SERP.
10. Save progress after every page.
11. Click next page:

- prefer link with id `pnnext`
- fallback to link text “Next”
- fallback to URL parameter start += 10

12. Stop when:

- max pages reached
- no next page exists
- repeated CAPTCHA unresolved
- extraction returns zero results twice

13. Deduplicate by normalized final URL:

- remove Google redirect wrapper if present
- strip common tracking params: `utm_*`, `fbclid`, `gclid`
- preserve Reddit comment/thread paths

14. Write JSON, CSV, and meta.

Organic result extraction strategy:

- Google DOM changes often, so implement multiple fallback selectors.
- Prefer collecting links inside visible result blocks.
- Ignore:
  - ads
  - “People also ask”
  - image packs
  - videos unless they appear as normal organic links
  - Google internal links
  - cached/translate links

- For each candidate result block:
  - title: first visible h3 text
  - url: nearest parent anchor href
  - snippet: nearby visible text excluding title/url

- Keep extraction defensive and log skipped candidates.

Pacing:

- Add delay between pages: 3–8 seconds.
- Add small random delay before clicking next.
- Never parallelize Google queries.
- Save progress continuously.

Useful scripts:

```json
{
  "scripts": {
    "collect": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit",
    "dev": "tsx src/cli.ts"
  }
}
```

Acceptance test:
Run:

```bash
pnpm collect --query '"zoned out" lecture site:reddit.com' --max-pages 3 --out ./runs/test
```

Expected:

- Opens visible Chrome.
- Runs Google search.
- Collects results from at least page 1.
- Writes `results.json`, `results.csv`, and `meta.json`.
- If CAPTCHA appears, script pauses and waits for manual user action.
- No stealth, proxy, or CAPTCHA bypass code is added.
