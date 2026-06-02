import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectCaptcha, waitForManualCaptcha } from './captcha.mjs';
import { extractOrganicResults } from './extract.mjs';
import {
  delayBetweenPages,
  goToNextPage,
  openGoogleSession,
  openSearchPage,
  tryAcceptConsent,
} from './google.mjs';
import { normalizeResultUrl, isGoogleInternalUrl } from './normalize.mjs';
import {
  ALL_RESULT_FIELDS,
  DEFAULT_RESULT_FIELDS,
  slugifyQuery,
  writeManifest,
  writeQueryOutput,
} from './output.mjs';

const DEFAULT_MAX_PAGES = 10;
const GOOGLE_RESULTS_PER_PAGE = 10;
const DEFAULT_DELAY_MS = { min: 1000, max: 3000 };
const FAST_DELAY_MS = { min: 100, max: 500 };
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..');

export function parseArgs(argv) {
  const options = {
    queries: [],
    maxPages: DEFAULT_MAX_PAGES,
    locale: 'en-US',
    profileDir: path.join(repoDir, '.chrome-profile'),
    fields: DEFAULT_RESULT_FIELDS,
    delayMs: DEFAULT_DELAY_MS,
    pageConcurrency: 1,
    connectCdp: undefined,
    verbose: false,
    openOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--query' || arg === '-q') {
      options.queries.push(readValue(argv, index, arg));
      index += 1;
    } else if (arg === '--queries-file') {
      options.queriesFile = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--max-pages') {
      options.maxPages = parsePositiveInt(readValue(argv, index, arg), '--max-pages');
      index += 1;
    } else if (arg === '--out') {
      options.out = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--profile-dir') {
      options.profileDir = path.resolve(process.cwd(), readValue(argv, index, arg));
      index += 1;
    } else if (arg === '--connect-cdp') {
      options.connectCdp = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--locale') {
      options.locale = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--fields') {
      options.fields = parseFields(readValue(argv, index, arg));
      index += 1;
    } else if (arg === '--delay-ms') {
      options.delayMs = parseDelayRange(readValue(argv, index, arg));
      index += 1;
    } else if (arg === '--fast') {
      options.delayMs = FAST_DELAY_MS;
    } else if (arg === '--page-concurrency') {
      options.pageConcurrency = parsePageConcurrency(readValue(argv, index, arg));
      index += 1;
    } else if (arg === '--open-only') {
      options.openOnly = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }

  if (options.queries.length === 0 && !options.queriesFile) {
    throw new Error('--query is required');
  }

  if (!options.out) {
    options.out = options.queries.length === 1 && !options.queriesFile
      ? path.join('runs', slugifyQuery(options.queries[0]))
      : path.join('runs', 'google-serp-run');
  }

  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/run.js collect-serp --query <query> [options]

Options:
  --query, -q <query>       Google search query to collect; repeat for multiple queries
  --queries-file <file>     Newline-separated query file; blank lines and # comments are ignored
  --max-pages <number>      Maximum SERP pages to collect (default: ${DEFAULT_MAX_PAGES})
  --out <dir>               Output directory (default: runs/<query-slug>)
  --profile-dir <dir>       Persistent browser profile directory (default: scripts/.chrome-profile)
  --connect-cdp <url>       Connect to an existing Chrome DevTools endpoint instead of launching a browser
  --locale <locale>         Browser locale (default: en-US)
  --fields <list|all>       Result fields to include (default: ${DEFAULT_RESULT_FIELDS.join(',')})
  --delay-ms <min>:<max>    Delay between pages (default: ${DEFAULT_DELAY_MS.min}:${DEFAULT_DELAY_MS.max})
  --fast                    Shorthand for --delay-ms ${FAST_DELAY_MS.min}:${FAST_DELAY_MS.max}
  --page-concurrency <n>    Load direct result pages in parallel tabs, 1-8 (default: 1)
  --open-only               Open the first query in Playwright and keep the browser open for manual testing
  --verbose                 Log timing details and skipped extraction candidates
  --help, -h                Show this help
`);
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error('');
    printHelp();
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  options.queries = await resolveQueries(options);
  if (options.openOnly) {
    await openGoogleSearchForManualTest(options);
    return;
  }

  await collectGoogleSerp(options);
}

export async function openGoogleSearchForManualTest(options) {
  const query = options.queries[0];
  const log = options.verbose
    ? (message) => console.log(`[serp] ${query} ${message}`)
    : undefined;

  const session = await openGoogleSession({
    profileDir: options.profileDir,
    locale: options.locale,
    connectCdp: options.connectCdp,
  });

  const page = await openSearchPage(session.context, query, 0, {
    log,
    newPage: Boolean(options.connectCdp),
  });
  await timed(log, 'consent check', () => tryAcceptConsent(page));

  console.log(`Opened Google search for: ${query}`);
  console.log('Manual browser test mode is active. Navigate in the browser; this process will keep it open.');
  console.log('Press Ctrl+C in this terminal when you are done.');

  await new Promise(() => {});
}

export async function collectGoogleSerp(options) {
  const outDir = path.resolve(process.cwd(), options.out);
  const queryOutDir = path.join(outDir, 'queries');
  await mkdir(outDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const manifest = {
    startedAt,
    finishedAt: startedAt,
    queryCount: options.queries.length,
    outputs: [],
  };
  const runState = {
    interrupted: false,
  };

  const saveManifest = async () => {
    manifest.finishedAt = new Date().toISOString();
    await writeManifest(outDir, manifest);
  };

  const onSigint = () => {
    runState.interrupted = true;
    console.log('\nManual stop requested. Saving progress after current step...');
  };

  process.once('SIGINT', onSigint);

  let session;
  try {
    session = await openGoogleSession({
      profileDir: options.profileDir,
      locale: options.locale,
      connectCdp: options.connectCdp,
    });

    for (let index = 0; index < options.queries.length; index += 1) {
      if (runState.interrupted) {
        break;
      }

      const query = options.queries[index];
      const payload = await collectSingleQuery({
        context: session.context,
        options: { ...options, query },
        runState,
        save: async (currentPayload) => {
          const filename = await writeQueryOutput(queryOutDir, currentPayload, {
            index: index + 1,
            fields: options.fields,
          });
          const file = path.join('queries', filename);
          const output = {
            query,
            file,
            totalUniqueResults: currentPayload.metadata.totalUniqueResults,
            stoppedReason: currentPayload.metadata.stoppedReason,
          };
          manifest.outputs[index] = output;
          await saveManifest();
          return filename;
        },
      });

      manifest.outputs[index] = {
        query,
        file: path.join('queries', payload.filename),
        totalUniqueResults: payload.metadata.totalUniqueResults,
        stoppedReason: payload.metadata.stoppedReason,
      };
      await saveManifest();
    }
  } catch (error) {
    if (runState.interrupted || error.name === 'AbortError') {
      console.log('Manual stop requested. Saving progress...');
      process.exitCode = 130;
    } else {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    }
    await saveManifest();
  } finally {
    process.removeListener('SIGINT', onSigint);
    if (session) {
      await session.close();
    }
  }
}

async function collectSingleQuery({ context, options, runState, save }) {
  if (options.pageConcurrency > 1) {
    return collectSingleQueryParallel({ context, options, runState, save });
  }

  const startedAt = new Date().toISOString();
  const results = [];
  const seen = new Set();
  const state = {
    stoppedReason: 'error',
    pagesCollected: 0,
    totalRawResults: 0,
    zeroResultPages: 0,
    interrupted: false,
  };

  const metadata = () => ({
    query: options.query,
    startedAt,
    finishedAt: new Date().toISOString(),
    maxPages: options.maxPages,
    pageConcurrency: options.pageConcurrency,
    delayMs: options.delayMs,
    pagesCollected: state.pagesCollected,
    totalRawResults: state.totalRawResults,
    totalUniqueResults: results.length,
    stoppedReason: state.stoppedReason,
  });

  const payload = () => ({
    query: options.query,
    metadata: metadata(),
    results,
  });
  const log = options.verbose
    ? (message) => console.log(`[serp] ${options.query} ${message}`)
    : undefined;

  let filename;
  try {
    const page = await openSearchPage(context, options.query, 0, {
      log,
      newPage: Boolean(options.connectCdp),
    });
    await timed(log, 'consent check', () => tryAcceptConsent(page));

    for (let currentPage = 1; currentPage <= options.maxPages; currentPage += 1) {
      if (runState.interrupted) {
        break;
      }

      const rawResults = await extractPageResults(page, currentPage, options, log);
      if (!rawResults) {
        state.stoppedReason = 'captcha_timeout';
        break;
      }
      state.totalRawResults += rawResults.length;
      state.pagesCollected = currentPage;

      if (rawResults.length === 0) {
        state.zeroResultPages += 1;
      } else {
        state.zeroResultPages = 0;
      }

      appendResults(results, seen, rawResults, page.url(), currentPage);

      if (currentPage >= options.maxPages) {
        state.stoppedReason = 'max_pages';
        filename = await timed(log, `page ${currentPage} save`, () => save(payload()));
        break;
      }

      if (state.zeroResultPages >= 2) {
        state.stoppedReason = 'no_next_page';
        filename = await timed(log, `page ${currentPage} save`, () => save(payload()));
        break;
      }

      filename = await timed(log, `page ${currentPage} save`, () => save(payload()));
      await timed(log, `page ${currentPage} delay`, () => delayBetweenPages(options.delayMs.min, options.delayMs.max));

      const navigated = await goToNextPage(page, {
        query: options.query,
        nextStart: currentPage * GOOGLE_RESULTS_PER_PAGE,
        log,
      });

      if (!navigated) {
        state.stoppedReason = 'no_next_page';
        break;
      }
    }

    if (runState.interrupted) {
      state.stoppedReason = 'manual_stop';
    }

    filename = await save(payload());
  } catch (error) {
    state.stoppedReason = runState.interrupted || error.name === 'AbortError' ? 'manual_stop' : 'error';
    if (state.stoppedReason === 'error') {
      console.error(error.stack || error.message);
    } else {
      console.log('Manual stop requested. Saving progress...');
    }
    filename = await save(payload());
    process.exitCode = state.stoppedReason === 'manual_stop' ? 130 : 1;
  }

  return {
    filename,
    metadata: metadata(),
  };
}

async function collectSingleQueryParallel({ context, options, runState, save }) {
  const startedAt = new Date().toISOString();
  const results = [];
  const seen = new Set();
  const state = {
    stoppedReason: 'error',
    pagesCollected: 0,
    totalRawResults: 0,
    zeroResultPages: 0,
  };

  const metadata = () => ({
    query: options.query,
    startedAt,
    finishedAt: new Date().toISOString(),
    maxPages: options.maxPages,
    pageConcurrency: options.pageConcurrency,
    delayMs: options.delayMs,
    pagesCollected: state.pagesCollected,
    totalRawResults: state.totalRawResults,
    totalUniqueResults: results.length,
    stoppedReason: state.stoppedReason,
  });

  const payload = () => ({
    query: options.query,
    metadata: metadata(),
    results,
  });
  const log = options.verbose
    ? (message) => console.log(`[serp] ${options.query} ${message}`)
    : undefined;

  let filename;
  try {
    const firstPage = await openSearchPage(context, options.query, 0, {
      log,
      newPage: Boolean(options.connectCdp),
    });
    await timed(log, 'consent check', () => tryAcceptConsent(firstPage));

    for (let batchStart = 1; batchStart <= options.maxPages; batchStart += options.pageConcurrency) {
      if (runState.interrupted) {
        break;
      }

      const batchPages = [];
      for (let offset = 0; offset < options.pageConcurrency; offset += 1) {
        const currentPage = batchStart + offset;
        if (currentPage <= options.maxPages) {
          batchPages.push(currentPage);
        }
      }

      const batch = await Promise.all(batchPages.map(async (currentPage) => {
        const page = currentPage === 1
          ? firstPage
          : await openSearchPage(context, options.query, (currentPage - 1) * GOOGLE_RESULTS_PER_PAGE, {
            log,
            newPage: true,
          });

        try {
          const rawResults = await extractPageResults(page, currentPage, options, log);
          return {
            currentPage,
            rawResults,
            pageUrl: page.url(),
          };
        } finally {
          if (currentPage !== 1) {
            await page.close().catch(() => {});
          }
        }
      }));

      for (const pageResult of batch.sort((a, b) => a.currentPage - b.currentPage)) {
        if (!pageResult.rawResults) {
          state.stoppedReason = 'captcha_timeout';
          break;
        }

        state.totalRawResults += pageResult.rawResults.length;
        state.pagesCollected = pageResult.currentPage;

        if (pageResult.rawResults.length === 0) {
          state.zeroResultPages += 1;
        } else {
          state.zeroResultPages = 0;
        }

        appendResults(results, seen, pageResult.rawResults, pageResult.pageUrl, pageResult.currentPage);
      }

      filename = await timed(log, `parallel pages ${batchPages[0]}-${batchPages.at(-1)} save`, () => save(payload()));

      if (state.stoppedReason === 'captcha_timeout' || state.zeroResultPages >= 2) {
        if (state.stoppedReason !== 'captcha_timeout') {
          state.stoppedReason = 'no_next_page';
        }
        break;
      }
    }

    if (runState.interrupted) {
      state.stoppedReason = 'manual_stop';
    } else if (state.stoppedReason === 'error') {
      state.stoppedReason = 'max_pages';
    }

    filename = await save(payload());
  } catch (error) {
    state.stoppedReason = runState.interrupted || error.name === 'AbortError' ? 'manual_stop' : 'error';
    if (state.stoppedReason === 'error') {
      console.error(error.stack || error.message);
    } else {
      console.log('Manual stop requested. Saving progress...');
    }
    filename = await save(payload());
    process.exitCode = state.stoppedReason === 'manual_stop' ? 130 : 1;
  }

  return {
    filename,
    metadata: metadata(),
  };
}

async function extractPageResults(page, currentPage, options, log) {
  const hasCaptcha = await timed(log, `page ${currentPage} captcha check`, () => detectCaptcha(page));
  if (hasCaptcha) {
    const solved = await waitForManualCaptcha(page);
    if (!solved) {
      return null;
    }
  }

  return timed(log, `page ${currentPage} extract`, () => extractOrganicResults(page, {
    verbose: options.verbose,
    includeDebugFields: options.fields.some((field) => field === 'dataVed' || field === 'dataHveid'),
  }));
}

function appendResults(results, seen, rawResults, pageUrl, currentPage) {
  for (const [index, raw] of rawResults.entries()) {
    if (!raw.url || isGoogleInternalUrl(raw.url, pageUrl)) {
      continue;
    }

    let normalized;
    try {
      normalized = normalizeResultUrl(raw.url, pageUrl);
    } catch {
      continue;
    }

    if (seen.has(normalized.key)) {
      continue;
    }

    seen.add(normalized.key);
    results.push({
      page: currentPage,
      rankOnPage: index + 1,
      globalRank: results.length + 1,
      rank: results.length + 1,
      title: raw.title,
      url: normalized.url,
      source: raw.source,
      displayUrl: raw.displayUrl,
      snippet: raw.snippet,
      language: raw.language,
      resultPosition: raw.resultPosition,
      dataVed: raw.dataVed,
      dataHveid: raw.dataHveid,
      collectedAt: new Date().toISOString(),
    });
  }
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseDelayRange(value) {
  const [minText, maxText] = value.split(':');
  const min = Number.parseInt(minText, 10);
  const max = Number.parseInt(maxText, 10);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    throw new Error('--delay-ms must be formatted as min:max with max >= min');
  }
  return { min, max };
}

function parsePageConcurrency(value) {
  const parsed = parsePositiveInt(value, '--page-concurrency');
  if (parsed > 8) {
    throw new Error('--page-concurrency must be between 1 and 8');
  }
  return parsed;
}

function parseFields(value) {
  if (value === 'all') {
    return ALL_RESULT_FIELDS;
  }

  const fields = value.split(',').map((field) => field.trim()).filter(Boolean);
  const unknown = fields.filter((field) => !ALL_RESULT_FIELDS.includes(field));
  if (fields.length === 0 || unknown.length > 0) {
    throw new Error(`Unknown result field: ${unknown[0] || value}`);
  }
  return fields;
}

async function timed(log, label, fn) {
  if (!log) {
    return fn();
  }

  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    log(`${label}: ${Date.now() - startedAt}ms`);
  }
}

async function resolveQueries(options) {
  const queries = [...options.queries];

  if (options.queriesFile) {
    const filePath = path.resolve(process.cwd(), options.queriesFile);
    const contents = await readFile(filePath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const query = line.trim();
      if (query && !query.startsWith('#')) {
        queries.push(query);
      }
    }
  }

  if (queries.length === 0) {
    throw new Error('--query is required');
  }

  return queries;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
