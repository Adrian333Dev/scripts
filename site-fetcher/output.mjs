import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sourceSlug } from './normalize.mjs';

export async function readCachedMetadata(outDir, hash) {
  const metadataPath = path.join(outDir, 'metadata', `${hash}.json`);
  try {
    return JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    return undefined;
  }
}

export async function writeSourceResult(outDir, candidate, result, index) {
  await mkdir(path.join(outDir, 'sources'), { recursive: true });
  await mkdir(path.join(outDir, 'metadata'), { recursive: true });
  await mkdir(path.join(outDir, 'failed'), { recursive: true });

  const metadata = createMetadata(candidate, result);
  if (result.html) {
    await mkdir(path.join(outDir, 'artifacts'), { recursive: true });
    const artifactPath = path.join(outDir, 'artifacts', `${candidate.hash}.html`);
    await writeAtomic(artifactPath, result.html);
    metadata.artifacts = {
      rawHtml: path.relative(outDir, artifactPath),
    };
  }

  const metadataPath = path.join(outDir, 'metadata', `${candidate.hash}.json`);

  if (result.status === 'failed' || result.status === 'manual_required') {
    await writeAtomic(path.join(outDir, 'failed', `${candidate.hash}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
    await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    return { metadata, sourceFile: undefined };
  }

  const filename = `${String(index).padStart(3, '0')}-${sourceSlug(result.title || candidate.title, candidate.normalizedUrl)}.md`;
  const sourcePath = path.join(outDir, 'sources', filename);
  const markdown = renderSourceMarkdown(candidate, result, metadata);

  metadata.sourceFile = path.relative(outDir, sourcePath);
  await writeAtomic(sourcePath, markdown);
  await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { metadata, sourceFile: metadata.sourceFile };
}

export async function writeManifest(outDir, manifest) {
  await mkdir(outDir, { recursive: true });
  await writeAtomic(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function createMetadata(candidate, result) {
  const markdown = result.markdown || '';
  return {
    url: candidate.originalUrl,
    normalizedUrl: candidate.normalizedUrl,
    hash: candidate.hash,
    title: result.title || candidate.title || '',
    source: candidate.source || new URL(candidate.normalizedUrl).hostname.replace(/^www\./, ''),
    status: result.status,
    reason: result.reason,
    method: result.method,
    methodAttempts: result.methodAttempts || [result.method],
    httpStatus: result.httpStatus,
    contentType: result.contentType,
    textLength: result.textLength || 0,
    contentHash: markdown ? createHash('sha256').update(markdown).digest('hex') : undefined,
    error: result.error,
    extractedAt: new Date().toISOString(),
    occurrences: candidate.occurrences,
  };
}

function renderSourceMarkdown(candidate, result, metadata) {
  const title = metadata.title || candidate.normalizedUrl;
  return `---\n${frontmatter(metadata)}---\n\n# ${escapeHeading(title)}\n\nSource: ${candidate.normalizedUrl}\n\n## Extracted Content\n\n${result.markdown || result.text || ''}\n`;
}

function frontmatter(metadata) {
  const fields = {
    url: metadata.url,
    normalized_url: metadata.normalizedUrl,
    title: metadata.title,
    source: metadata.source,
    method: metadata.method,
    status: metadata.status,
    reason: metadata.reason,
    extracted_at: metadata.extractedAt,
    text_length: metadata.textLength,
  };

  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')
    .concat('\n');
}

function escapeHeading(value) {
  return String(value).replace(/\s+/g, ' ').trim() || 'Untitled Source';
}

async function writeAtomic(filePath, contents) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, filePath);
}
