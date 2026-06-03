#!/usr/bin/env node

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compactMarkdown } from './compact.mjs';

export function parseArgs(argv) {
  const options = {
    maxChars: 12000,
    keepImages: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--input') {
      options.input = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out') {
      options.out = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--max-chars') {
      options.maxChars = parseNonNegativeInt(readValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === '--keep-images') {
      options.keepImages = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }

  if (!options.input) {
    throw new Error('--input is required');
  }

  if (!options.out) {
    options.out = path.join(options.input, 'compact');
  }

  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/run.js compact-sources --input <corpus-dir> [options]

Options:
  --input <dir>          Corpus directory containing sources/*.md
  --out <dir>            Output directory (default: <input>/compact)
  --max-chars <number>   Maximum compacted body characters per source; 0 disables cap (default: 12000)
  --keep-images          Keep Markdown image lines
  --verbose              Log each compacted source
  --help, -h             Show this help
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

  await compactSources(options);
}

export async function compactSources(options) {
  const inputDir = path.resolve(process.cwd(), options.input);
  const outDir = path.resolve(process.cwd(), options.out);
  const sourceDir = path.join(inputDir, 'sources');
  const outSourceDir = path.join(outDir, 'sources');
  await mkdir(outSourceDir, { recursive: true });

  const files = (await readdir(sourceDir))
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));

  const manifest = {
    inputDir: path.relative(process.cwd(), inputDir) || '.',
    outputDir: path.relative(process.cwd(), outDir) || '.',
    maxChars: options.maxChars,
    keepImages: options.keepImages,
    totalSources: files.length,
    originalChars: 0,
    compactChars: 0,
    savedChars: 0,
    truncated: 0,
    blocked: 0,
    outputs: [],
    compactedAt: new Date().toISOString(),
  };

  for (const file of files) {
    const inputPath = path.join(sourceDir, file);
    const outputPath = path.join(outSourceDir, file);
    const original = await readFile(inputPath, 'utf8');
    const compacted = compactMarkdown(original, options);

    await writeAtomic(outputPath, compacted.markdown);
    manifest.originalChars += compacted.originalChars;
    manifest.compactChars += compacted.compactChars;
    if (compacted.truncated) {
      manifest.truncated += 1;
    }
    if (compacted.blocked) {
      manifest.blocked += 1;
    }
    manifest.outputs.push({
      input: path.relative(inputDir, inputPath),
      output: path.relative(outDir, outputPath),
      originalChars: compacted.originalChars,
      compactChars: compacted.compactChars,
      savedChars: Math.max(0, compacted.originalChars - compacted.compactChars),
      truncated: compacted.truncated,
      blocked: compacted.blocked,
      contentHash: compacted.contentHash,
    });

    if (options.verbose) {
      const saved = Math.max(0, compacted.originalChars - compacted.compactChars);
      console.log(`[compact] ${file} saved ${saved} chars${compacted.truncated ? ' (truncated)' : ''}`);
    }
  }

  manifest.savedChars = Math.max(0, manifest.originalChars - manifest.compactChars);
  await writeAtomic(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function readValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${arg} requires a value`);
  }
  return value;
}

function parseNonNegativeInt(value, name) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return number;
}

async function writeAtomic(filePath, contents) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, filePath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
