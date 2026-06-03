import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeSourceUrl } from './normalize.mjs';

export async function readCandidates(options) {
  const candidates = [];

  if (Array.isArray(options.urls)) {
    candidates.push(...options.urls.map((url, index) => ({ url, inputIndex: index + 1 })));
  }

  if (options.urlsFile) {
    candidates.push(...await readUrlsFile(path.resolve(process.cwd(), options.urlsFile)));
  }

  if (options.input) {
    candidates.push(...await readSerpInput(path.resolve(process.cwd(), options.input)));
  }

  return dedupeCandidates(candidates);
}

async function readUrlsFile(filePath) {
  const contents = await readFile(filePath, 'utf8');
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((url, index) => ({ url, inputIndex: index + 1 }));
}

async function readSerpInput(inputPath) {
  const stats = await stat(inputPath);
  const files = stats.isDirectory()
    ? await findJsonFiles(inputPath)
    : [inputPath];

  const candidates = [];
  for (const file of files) {
    const payload = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(payload.results)) {
      continue;
    }

    for (const result of payload.results) {
      if (!result.url) {
        continue;
      }
      candidates.push({
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        source: result.source,
        displayUrl: result.displayUrl,
        rank: result.rank,
        query: payload.query,
      });
    }
  }

  return candidates;
}

async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'manifest.json') {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function dedupeCandidates(candidates) {
  const seen = new Map();
  for (const candidate of candidates) {
    let normalized;
    try {
      normalized = normalizeSourceUrl(candidate.url);
    } catch {
      continue;
    }

    if (!seen.has(normalized.key)) {
      seen.set(normalized.key, {
        ...candidate,
        originalUrl: candidate.url,
        normalizedUrl: normalized.url,
        cacheKey: normalized.key,
        hash: normalized.hash,
        occurrences: [],
      });
    }

    seen.get(normalized.key).occurrences.push({
      query: candidate.query,
      rank: candidate.rank,
      title: candidate.title,
      snippet: candidate.snippet,
    });
  }

  return [...seen.values()];
}
