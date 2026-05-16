#!/usr/bin/env node
/**
 * optimize.mjs — Batch image optimizer using sharp.
 *
 * Reduces shipped image bytes for raster assets while preserving high visual
 * quality. Emits a manifest.json for downstream <picture>/srcset consumers.
 *
 * Usage:
 *   node scripts/run.js optimize <input...> [options]
 *
 * See scripts/README.md for the full flag documentation.
 */

import { promises as fsp } from 'node:fs';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import sharp from 'sharp';

// ============================================================================
// Constants
// ============================================================================

const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const SUPPORTED_FORMATS = new Set(['avif', 'webp', 'jpeg']);
const DEFAULT_WIDTHS = [480, 768, 1024, 1440, 1920];
const DEFAULT_FORMATS = ['avif'];
const DEFAULT_QUALITY = Object.freeze({ avif: 60, webp: 85, jpeg: 82 });

const cwd = process.cwd();

// ============================================================================
// CLI parsing
// ============================================================================

function failArgs(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function usage() {
  return [
    'Usage: node scripts/run.js optimize <input...> [options]',
    '',
    'Options:',
    '  --out <dir>        Output directory (default: smart per input shape)',
    '  --widths <list>    Comma-separated widths (default: 480,768,1024,1440,1920)',
    '  --formats <list>   Comma-separated formats: avif,webp,jpeg (default: avif)',
    '  --quality <list>   Per-format quality (default: avif=60,webp=85,jpeg=82)',
    '  --only <glob>      Process only matching files (comma-separated patterns)',
    '  --except <glob>    Exclude matching files (comma-separated patterns)',
    '  --force            Regenerate even if cache is fresh',
    '  --dry-run          Print the plan and exit without writing',
    '  --help             Show this help',
  ].join('\n');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    out: null,
    widths: [...DEFAULT_WIDTHS],
    formats: [...DEFAULT_FORMATS],
    quality: { ...DEFAULT_QUALITY },
    only: [],
    except: [],
    force: false,
    dryRun: false,
    inputs: [],
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (a === '--out' && args[i + 1]) {
      opts.out = args[++i];
    } else if (a === '--widths' && args[i + 1]) {
      const list = args[++i].split(',').map((s) => parseInt(s.trim(), 10));
      if (list.length === 0 || list.some((n) => !Number.isFinite(n) || n <= 0)) {
        failArgs('--widths must be a comma-separated list of positive integers');
      }
      opts.widths = list;
    } else if (a === '--formats' && args[i + 1]) {
      const list = args[++i]
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const bad = list.filter((f) => !SUPPORTED_FORMATS.has(f));
      if (list.length === 0 || bad.length) {
        failArgs(`--formats must be from {avif,webp,jpeg}; bad: ${bad.join(', ') || '(empty)'}`);
      }
      opts.formats = list;
    } else if (a === '--quality' && args[i + 1]) {
      for (const pair of args[++i].split(',').map((s) => s.trim()).filter(Boolean)) {
        const [fmtRaw, qRaw] = pair.split('=').map((s) => (s ?? '').trim());
        const fmt = (fmtRaw || '').toLowerCase();
        const q = parseInt(qRaw, 10);
        if (!SUPPORTED_FORMATS.has(fmt) || !Number.isFinite(q) || q < 1 || q > 100) {
          failArgs(`invalid --quality entry "${pair}" (expected e.g. avif=60,webp=85)`);
        }
        opts.quality[fmt] = q;
      }
    } else if (a === '--only' && args[i + 1]) {
      opts.only.push(...args[++i].split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--except' && args[i + 1]) {
      opts.except.push(...args[++i].split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--force') {
      opts.force = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a.startsWith('--')) {
      failArgs(`unknown flag: ${a}`);
    } else {
      opts.inputs.push(a);
    }
  }

  if (opts.inputs.length === 0) {
    failArgs('no input paths provided.\n' + usage());
  }

  opts.widths = [...new Set(opts.widths)].sort((a, b) => a - b);
  opts.formats = [...new Set(opts.formats)];

  return opts;
}

// ============================================================================
// Glob matching (mirrors merge-to-md.js semantics: * = non-slash, ** = any)
// ============================================================================

function matchesGlob(relPath, pattern) {
  const p = pattern.trim();
  if (!p) return false;
  if (!p.includes('*')) {
    return relPath === p || relPath.endsWith('/' + p) || path.basename(relPath) === p;
  }
  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '{{STAR}}');
  const reStr = escaped.replace(/\{\{GLOBSTAR\}\}/g, '.*').replace(/\{\{STAR\}\}/g, '[^/]*');
  return new RegExp('^' + reStr + '$').test(relPath);
}

function passesFilters(rel, only, except) {
  if (only.length && !only.some((p) => matchesGlob(rel, p))) return false;
  if (except.length && except.some((p) => matchesGlob(rel, p))) return false;
  return true;
}

// ============================================================================
// File discovery
// ============================================================================

function listFilesRecursiveSync(dirAbs, skipDirAbs) {
  const out = [];
  const stack = [dirAbs];
  const skipPrefix = skipDirAbs ? skipDirAbs + path.sep : null;
  while (stack.length) {
    const cur = stack.pop();
    if (skipPrefix && (cur === skipDirAbs || cur.startsWith(skipPrefix))) continue;
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

function isRaster(filePath) {
  return RASTER_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function collectSources(inputs, only, except, outDirAbs) {
  const seen = new Set();
  const out = [];
  for (const inp of inputs) {
    const abs = path.resolve(cwd, inp);
    if (!fs.existsSync(abs)) {
      failArgs(`input not found: ${inp}`);
    }
    const st = fs.statSync(abs);
    if (st.isFile()) {
      const rel = path.relative(cwd, abs);
      if (isRaster(rel) && passesFilters(rel, only, except) && !seen.has(rel)) {
        // Don't pick up files that live inside our output dir
        if (!abs.startsWith(outDirAbs + path.sep) && abs !== outDirAbs) {
          seen.add(rel);
          out.push(rel);
        }
      }
    } else if (st.isDirectory()) {
      const files = listFilesRecursiveSync(abs, outDirAbs);
      for (const f of files) {
        const rel = path.relative(cwd, f);
        if (isRaster(rel) && passesFilters(rel, only, except) && !seen.has(rel)) {
          seen.add(rel);
          out.push(rel);
        }
      }
    }
  }
  out.sort();
  return out;
}

// ============================================================================
// Output dir resolution
// ============================================================================

function resolveOutDir(opts) {
  if (opts.out) return path.resolve(cwd, opts.out);
  if (opts.inputs.length === 1 && opts.only.length === 0) {
    const abs = path.resolve(cwd, opts.inputs[0]);
    if (fs.existsSync(abs)) {
      const st = fs.statSync(abs);
      const base = st.isDirectory() ? abs : path.dirname(abs);
      return path.join(base, 'optimized');
    }
  }
  return path.resolve(cwd, 'temp/optimized');
}

// ============================================================================
// Collision check
// ============================================================================

function checkCollisions(sources) {
  const byFolder = new Map();
  for (const s of sources) {
    const folder = path.basename(s, path.extname(s));
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(s);
  }
  const collisions = [...byFolder.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length) {
    console.error('error: multiple sources resolve to the same output folder:');
    for (const [folder, list] of collisions) {
      console.error(`  ${folder}/ <- ${list.join(', ')}`);
    }
    console.error('Run separately with --out per group, or rename the sources.');
    process.exit(2);
  }
}

// ============================================================================
// Config hash (cache invalidation key)
// ============================================================================

function configHash(opts) {
  const stable = {
    widths: [...opts.widths].sort((a, b) => a - b),
    formats: [...opts.formats].sort(),
    quality: Object.fromEntries(
      Object.entries(opts.quality).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 8);
}

// ============================================================================
// Cache I/O
// ============================================================================

function loadCache(outDir) {
  const p = path.join(outDir, '.optimize-cache.json');
  if (!fs.existsSync(p)) return { configHash: null, entries: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { configHash: null, entries: {} };
  }
}

function saveCache(outDir, cache) {
  fs.writeFileSync(
    path.join(outDir, '.optimize-cache.json'),
    JSON.stringify(cache, null, 2),
  );
}

// ============================================================================
// Concurrency semaphore
// ============================================================================

function makeSemaphore(max) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < max && queue.length) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve()
        .then(fn)
        .then(
          (v) => { active--; resolve(v); drain(); },
          (e) => { active--; reject(e); drain(); },
        );
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drain();
  });
}

// ============================================================================
// Sharp encoding
// ============================================================================

function buildPipeline(buffer, width, format, quality) {
  let pipeline = sharp(buffer, { failOn: 'truncated' }).resize({
    width,
    withoutEnlargement: true,
    kernel: 'lanczos3',
    fit: 'inside',
  });
  if (format === 'avif') {
    pipeline = pipeline.avif({
      quality: quality.avif,
      effort: 6,
      chromaSubsampling: '4:4:4',
    });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({
      quality: quality.webp,
      effort: 5,
      smartSubsample: true,
      alphaQuality: 100,
    });
  } else if (format === 'jpeg') {
    pipeline = pipeline.jpeg({
      quality: quality.jpeg,
      progressive: true,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    });
  }
  return pipeline;
}

function fileExt(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function pctDelta(after, before) {
  if (before === 0) return '0%';
  return `${((after / before - 1) * 100).toFixed(1)}%`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();
  const outDir = resolveOutDir(opts);
  const sources = collectSources(opts.inputs, opts.only, opts.except, outDir);

  if (sources.length === 0) {
    console.log('No raster images found.');
    process.exit(0);
  }

  checkCollisions(sources);

  if (!opts.dryRun) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const probe = path.join(outDir, '.write-probe');
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
    } catch (err) {
      failArgs(`output dir not writable (${outDir}): ${err.message}`);
    }
  }

  sharp.concurrency(1);
  const sem = makeSemaphore(Math.max(2, os.cpus().length));

  const cfgHash = configHash(opts);
  const cache = loadCache(outDir);
  const cacheValid = cache.configHash === cfgHash;
  const newCache = { configHash: cfgHash, entries: {} };

  const manifest = {
    $config: {
      widths: opts.widths,
      formats: opts.formats,
      quality: opts.quality,
      generatedAt: new Date().toISOString(),
    },
  };

  // Stats for the final report
  let scannedBytes = 0;
  let skippedCount = 0;
  let reencodedCount = 0;
  let reencodedSourceBytes = 0;
  let variantsWritten = 0;
  let variantsBytes = 0;
  let totalSavingFrom = 0;
  let totalSavingTo = 0;
  let warnings = 0;
  let errors = 0;
  let largestSaving = null;

  for (const rel of sources) {
    const absPath = path.resolve(cwd, rel);
    let srcStat;
    try {
      srcStat = fs.statSync(absPath);
    } catch (err) {
      console.error(`  error  ${rel}    stat failed: ${err.message}`);
      errors++;
      continue;
    }
    scannedBytes += srcStat.size;

    const cacheEntry = cache.entries?.[rel];
    const cacheFresh =
      cacheValid &&
      cacheEntry &&
      cacheEntry.mtime === srcStat.mtimeMs &&
      cacheEntry.size === srcStat.size &&
      !opts.force;

    const outputsAllPresent =
      cacheFresh &&
      (cacheEntry.outputs || []).every((p) => fs.existsSync(path.join(outDir, p)));

    if (cacheFresh && outputsAllPresent && cacheEntry.manifestEntry) {
      manifest[rel] = cacheEntry.manifestEntry;
      newCache.entries[rel] = cacheEntry;
      skippedCount++;
      console.log(`  skip   ${rel}    cached`);
      continue;
    }

    // Need to (re)encode — read source once
    let buffer, meta;
    try {
      buffer = await fsp.readFile(absPath);
      meta = await sharp(buffer).metadata();
    } catch (err) {
      console.error(`  error  ${rel}    ${err.message}`);
      errors++;
      continue;
    }

    const validWidths = opts.widths.filter((w) => w <= meta.width);

    // Plan the variants
    const planned = [];
    let plannedSkippedJpeg = 0;
    for (const w of validWidths) {
      for (const fmt of opts.formats) {
        if (fmt === 'jpeg' && meta.hasAlpha) {
          plannedSkippedJpeg++;
          continue;
        }
        planned.push({ width: w, format: fmt });
      }
    }

    if (opts.dryRun) {
      if (plannedSkippedJpeg > 0) {
        console.log(`  warn   ${rel}    alpha + jpeg -> ${plannedSkippedJpeg} jpeg variant(s) would be skipped`);
        warnings += plannedSkippedJpeg;
      }
      console.log(
        `  plan   ${rel}    ${planned.length} variants planned` +
          (validWidths.length === 0 ? ' (source narrower than smallest --widths)' : ''),
      );
      reencodedCount++;
      reencodedSourceBytes += srcStat.size;
      continue;
    }

    // Real encode
    const folder = path.basename(rel, path.extname(rel));
    const folderAbs = path.join(outDir, folder);
    try {
      fs.mkdirSync(folderAbs, { recursive: true });
    } catch (err) {
      console.error(`  error  ${rel}    mkdir ${folder}: ${err.message}`);
      errors++;
      continue;
    }

    if (plannedSkippedJpeg > 0) {
      console.log(`  warn   ${rel}    alpha + jpeg requested -> ${plannedSkippedJpeg} jpeg variant(s) skipped`);
      warnings += plannedSkippedJpeg;
    }

    const localVariants = {};
    let bytesForSource = 0;
    let sourceFailed = false;

    const results = await Promise.all(
      planned.map(({ width, format }) =>
        sem(async () => {
          const outRel = path.join(folder, `${folder}-${width}.${fileExt(format)}`);
          const outAbs = path.join(outDir, outRel);
          try {
            // Encode to buffer first so we can measure size before deciding to write.
            // Skip writing if the variant isn't actually smaller than the source —
            // there's no point shipping bytes that lose to the original.
            const { data, info } = await buildPipeline(buffer, width, format, opts.quality)
              .toBuffer({ resolveWithObject: true });
            if (data.length >= srcStat.size) {
              return { ok: true, skipped: true, width, format };
            }
            await fsp.writeFile(outAbs, data);
            return { ok: true, width, format, outRel, info, bytes: data.length };
          } catch (err) {
            return { ok: false, width, format, err: err.message };
          }
        }),
      ),
    );

    let skippedNotBetter = 0;
    for (const r of results) {
      if (!r.ok) {
        console.error(`  error  ${rel}    encode failed (${r.format} ${r.width}w): ${r.err}`);
        errors++;
        sourceFailed = true;
        continue;
      }
      if (r.skipped) {
        skippedNotBetter++;
        continue;
      }
      const expectedW = Math.min(r.width, meta.width);
      if (r.info.width !== expectedW) {
        console.log(`  warn   ${rel}    ${r.format} ${r.width}w: expected ${expectedW}w got ${r.info.width}w`);
        warnings++;
      }
      localVariants[r.format] = localVariants[r.format] || [];
      localVariants[r.format].push({ width: r.width, path: r.outRel, bytes: r.bytes });
      variantsWritten++;
      variantsBytes += r.bytes;
      bytesForSource += r.bytes;
    }

    for (const arr of Object.values(localVariants)) {
      arr.sort((a, b) => a.width - b.width);
    }

    if (sourceFailed) continue;

    const variantCount = Object.values(localVariants).reduce((n, arr) => n + arr.length, 0);

    if (variantCount === 0) {
      // Nothing kept — either alpha+jpeg-only, or every variant lost to the source.
      const reason = skippedNotBetter > 0
        ? `no variants beat the source (${skippedNotBetter} encoded but not smaller)`
        : 'no variants produced (see warnings above)';
      console.log(`  skip   ${rel}    ${reason}`);
      continue;
    }

    const manifestEntry = {
      source: rel,
      width: meta.width,
      height: meta.height,
      aspectRatio:
        meta.width && meta.height ? +(meta.width / meta.height).toFixed(4) : null,
      hasAlpha: !!meta.hasAlpha,
      variants: localVariants,
    };
    manifest[rel] = manifestEntry;

    newCache.entries[rel] = {
      mtime: srcStat.mtimeMs,
      size: srcStat.size,
      outputs: Object.values(localVariants).flatMap((arr) => arr.map((v) => v.path)),
      manifestEntry,
    };

    reencodedCount++;
    reencodedSourceBytes += srcStat.size;
    totalSavingFrom += srcStat.size;
    totalSavingTo += bytesForSource;

    const savingDelta = srcStat.size - bytesForSource;
    const largestDelta = largestSaving ? largestSaving.fromBytes - largestSaving.toBytes : -Infinity;
    if (savingDelta > largestDelta) {
      largestSaving = {
        source: rel,
        fromBytes: srcStat.size,
        toBytes: bytesForSource,
        variantCount,
      };
    }

    const skipNote = skippedNotBetter > 0 ? ` (${skippedNotBetter} skipped: not smaller than source)` : '';
    console.log(
      `  ok     ${rel}    ${variantCount} variants    ${fmtBytes(srcStat.size)} -> ${fmtBytes(bytesForSource)}  (${pctDelta(bytesForSource, srcStat.size)})${skipNote}`,
    );
  }

  if (!opts.dryRun) {
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    saveCache(outDir, newCache);
  }

  // Report
  console.log('');
  console.log(`Image Optimization Report${opts.dryRun ? ' (DRY RUN)' : ''}`);
  console.log('-------------------------');
  console.log(`Sources scanned:        ${sources.length} files (${fmtBytes(scannedBytes)})`);
  console.log(`${opts.dryRun ? 'Would skip ' : 'Skipped    '}(cache):     ${skippedCount} files`);
  console.log(
    `${opts.dryRun ? 'Would re-encode' : 'Re-encoded     '}:    ${reencodedCount} files (${fmtBytes(reencodedSourceBytes)})`,
  );
  if (!opts.dryRun) {
    console.log(`Variants written:       ${variantsWritten} files (${fmtBytes(variantsBytes)})`);
    if (totalSavingFrom > 0) {
      console.log(
        `Total saving:           ${fmtBytes(totalSavingFrom)} -> ${fmtBytes(totalSavingTo)}  (${pctDelta(totalSavingTo, totalSavingFrom)})`,
      );
    }
    if (largestSaving) {
      console.log(
        `Largest single saving:  ${largestSaving.source}  (${fmtBytes(largestSaving.fromBytes)} -> ${fmtBytes(largestSaving.toBytes)} across ${largestSaving.variantCount} variants)`,
      );
    }
  }
  console.log(`Warnings: ${warnings}`);
  console.log(`Errors:   ${errors}`);
  console.log(`Output:   ${path.relative(cwd, outDir) || outDir}`);

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('fatal:', err.stack || err.message);
  process.exit(1);
});
