import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_RESULT_FIELDS = [
  'title',
  'url',
  'source',
  'displayUrl',
  'snippet',
  'rank',
];

export const ALL_RESULT_FIELDS = [
  ...DEFAULT_RESULT_FIELDS,
  'page',
  'rankOnPage',
  'globalRank',
  'language',
  'resultPosition',
  'dataVed',
  'dataHveid',
  'collectedAt',
];

export async function writeQueryOutput(outDir, payload, { index, fields = ALL_RESULT_FIELDS } = {}) {
  await mkdir(outDir, { recursive: true });
  const filename = queryOutputFilename(index, payload.query);
  const filteredPayload = {
    ...payload,
    results: payload.results.map((result) => filterResultFields(result, fields)),
  };
  await writeAtomic(path.join(outDir, filename), `${JSON.stringify(filteredPayload, null, 2)}\n`);
  return filename;
}

export async function writeManifest(outDir, manifest) {
  await mkdir(outDir, { recursive: true });
  await writeAtomic(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function filterResultFields(result, fields) {
  const output = {};
  for (const field of fields) {
    if (result[field] !== undefined) {
      output[field] = result[field];
    }
  }
  return output;
}

export function queryOutputFilename(index, query) {
  const number = String(index).padStart(3, '0');
  const slug = slugifyQuery(query, 58);
  const hash = createHash('sha1').update(query).digest('hex').slice(0, 8);
  return `${number}-${slug}-${hash}.json`;
}

export function slugifyQuery(query, maxLength = 80) {
  const baseSlug = query
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = baseSlug.length > maxLength ? baseSlug.slice(0, maxLength) : baseSlug;
  const lastDash = truncated.lastIndexOf('-');
  const slug = baseSlug.length > maxLength && lastDash > 20
    ? truncated.slice(0, lastDash)
    : truncated.replace(/-+$/g, '');
  return slug || 'google-serp-run';
}

async function writeAtomic(filePath, contents) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, filePath);
}
