#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readCandidates } from './input.mjs';
import { extractWithJina, shouldTryJina } from './jina-extract.mjs';
import { extractWithHttpReadability } from './local-extract.mjs';
import { readCachedMetadata, writeManifest, writeSourceResult } from './output.mjs';
import { extractRedditThread, isRedditThreadUrl } from './reddit-extract.mjs';

const DEFAULT_CONCURRENCY = 3;

export function parseArgs(argv) {
  const options = {
    urls: [],
    method: 'auto',
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: 20000,
    force: false,
    debugArtifacts: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--url') {
      options.urls.push(readValue(argv, index, arg));
      index += 1;
    } else if (arg === '--input') {
      options.input = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--urls-file') {
      options.urlsFile = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out') {
      options.out = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--max-urls') {
      options.maxUrls = parsePositiveInt(readValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === '--method') {
      options.method = parseMethod(readValue(argv, index, arg));
      index += 1;
    } else if (arg === '--jina-api-key-env') {
      options.jinaApiKeyEnv = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--concurrency') {
      options.concurrency = parsePositiveInt(readValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveInt(readValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--debug-artifacts') {
      options.debugArtifacts = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }

  if (!options.input && !options.urlsFile && options.urls.length === 0) {
    throw new Error('--url, --input, or --urls-file is required');
  }

  if (!options.out) {
    options.out = path.join('runs', 'site-corpus');
  }

  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/run.js extract-sources --url <url> --out <dir> [options]

Options:
  --url <url>             URL to fetch; repeat for multiple URLs
  --input <path>           SERP output directory or JSON file to read URLs from
  --urls-file <file>       Newline-separated URL file; blank lines and # comments ignored
  --out <dir>              Output corpus directory (default: runs/site-corpus)
  --max-urls <number>      Maximum deduped URLs to fetch
  --method <method>        Extraction method: auto, http, jina (default: auto)
  --jina-api-key-env <var> Read Jina API key from environment variable
  --concurrency <number>   Parallel fetches (default: ${DEFAULT_CONCURRENCY})
  --timeout-ms <number>    Per-request timeout (default: 20000)
  --force                  Refetch URLs even when metadata already exists
  --debug-artifacts        Keep raw artifacts in metadata where supported
  --verbose                Log each URL status
  --help, -h               Show this help
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

  await extractSources(options);
}

export async function extractSources(options) {
  const outDir = path.resolve(process.cwd(), options.out);
  await mkdir(outDir, { recursive: true });

  const allCandidates = await readCandidates(options);
  const candidates = options.maxUrls ? allCandidates.slice(0, options.maxUrls) : allCandidates;
  const startedAt = new Date().toISOString();
  const manifest = {
    startedAt,
    finishedAt: startedAt,
    method: options.method,
    totalCandidates: allCandidates.length,
    attempted: 0,
    cached: 0,
    ok: 0,
    weak: 0,
    manualRequired: 0,
    failed: 0,
    outputs: [],
  };

  let nextOutputIndex = 1;
  await runPool(candidates, options.concurrency, async (candidate, index) => {
    if (!options.force) {
      const cached = await readCachedMetadata(outDir, candidate.hash);
      if (cached) {
        manifest.cached += 1;
        manifest.outputs[index] = {
          url: candidate.normalizedUrl,
          status: 'cached',
          cachedStatus: cached.status,
          file: cached.sourceFile,
        };
        if (options.verbose) {
          console.log(`[cached] ${candidate.normalizedUrl}`);
        }
        return;
      }
    }

    manifest.attempted += 1;
    const result = await extractCandidate(candidate, options);
    const outputIndex = nextOutputIndex;
    if (result.status === 'ok' || result.status === 'weak') {
      nextOutputIndex += 1;
    }
    const written = await writeSourceResult(outDir, candidate, result, outputIndex);

    incrementStatus(manifest, result.status);
    manifest.outputs[index] = {
      url: candidate.normalizedUrl,
      status: result.status,
      reason: result.reason,
      method: result.method,
      file: written.sourceFile,
    };

    if (options.verbose) {
      console.log(`[${result.status}] ${candidate.normalizedUrl}${result.reason ? ` (${result.reason})` : ''}`);
    }
  });

  manifest.finishedAt = new Date().toISOString();
  await writeManifest(outDir, manifest);
  return manifest;
}

async function extractCandidate(candidate, options) {
  const attempts = [];

  try {
    if (options.method === 'jina') {
      const jinaResult = await extractWithJina(candidate.normalizedUrl, options);
      return { ...jinaResult, methodAttempts: [jinaResult.method] };
    }

    const result = await extractWithHttpReadability(candidate.normalizedUrl, options);
    attempts.push(result.method);

    if (
      isRedditThreadUrl(candidate.normalizedUrl)
      && (result.status === 'failed' || result.status === 'manual_required' || result.status === 'weak')
    ) {
      const redditResult = await extractRedditThread(candidate.normalizedUrl, options);
      attempts.push(redditResult.method);
      if (redditResult.status === 'ok' || !shouldTryJina(options)) {
        return { ...redditResult, methodAttempts: attempts };
      }

      const jinaResult = await extractWithJina(candidate.normalizedUrl, options);
      attempts.push(jinaResult.method);
      return { ...jinaResult, methodAttempts: attempts };
    }

    if (result.status === 'ok' || !shouldTryJina(options)) {
      return { ...result, methodAttempts: attempts };
    }

    const jinaResult = await extractWithJina(candidate.normalizedUrl, options);
    attempts.push(jinaResult.method);
    return { ...jinaResult, methodAttempts: attempts };
  } catch (error) {
    if (shouldTryJina(options) && !attempts.includes('jina')) {
      try {
        const jinaResult = await extractWithJina(candidate.normalizedUrl, options);
        return { ...jinaResult, methodAttempts: [...attempts, jinaResult.method] };
      } catch (jinaError) {
        return failedResult('jina', jinaError, [...attempts, 'jina']);
      }
    }
    return failedResult('http-readability', error, attempts.length ? attempts : ['http-readability']);
  }
}

function failedResult(method, error, attempts) {
  return {
    method,
    status: 'failed',
    reason: error.name === 'TimeoutError' ? 'timeout' : 'fetch_error',
    error: error.message,
    methodAttempts: attempts,
    markdown: '',
    text: '',
  };
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function incrementStatus(manifest, status) {
  if (status === 'ok') {
    manifest.ok += 1;
  } else if (status === 'weak') {
    manifest.weak += 1;
  } else if (status === 'manual_required') {
    manifest.manualRequired += 1;
  } else {
    manifest.failed += 1;
  }
}

function readValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${arg} requires a value`);
  }
  return value;
}

function parsePositiveInt(value, name) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function parseMethod(value) {
  if (!['auto', 'http', 'jina'].includes(value)) {
    throw new Error('--method must be one of: auto, http, jina');
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
