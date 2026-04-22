#!/usr/bin/env node
/**
 * merge-to-md.js — Merge files and folders into a single Markdown file with an LLM-friendly File Index.
 *
 * Output: A .md file with:
 *   1. File Index table at top (Path | Start | End) — each file's line range in the output
 *   2. Fenced code blocks below (```lang path/content)
 *
 * LLMs read the index to find file locations and jump to specific line ranges without reading
 * the whole file. Paths are relative to repo root.
 *
 * =============================================================================
 * USAGE
 * =============================================================================
 *
 *   node path/to/merge-to-md.js [options] <path1> [path2] ...
 *
 * Paths can be files or folders. Folders are traversed recursively. Results are deduplicated and sorted.
 * By default excludes: .git, node_modules, temp, tmp, .tmp, .temp, vendor, .venv, __pycache__
 *
 * =============================================================================
 * OPTIONS
 * =============================================================================
 *
 *   --out <dir>      Output directory (default: temp/llm-context from repo root)
 *   --name <name>    Output basename without .md (overrides smart default)
 *   --except <list>  Comma-separated patterns to EXCLUDE (see Filtering below)
 *   --include <list> Comma-separated patterns to INCLUDE (only these; if omitted, all are included)
 *   --assets <mode>  How to handle binary/asset files: ignore (default) | mention
 *   --git            Use git changed files (added/modified) as input; ignores path args
 *
 * =============================================================================
 * OUTPUT NAME (when --name not provided)
 * =============================================================================
 *
 *   --git:           git-changed
 *   Single path:     derived from path (e.g. apps/web/src/inngest → apps-web-src-inngest)
 *   Multiple paths:  merged
 *
 * =============================================================================
 * FILTERING (--include, --except)
 * =============================================================================
 *
 * Order: collect paths → apply --include (if any) → apply --except
 *
 * Patterns:
 *   - Exact path:  "apps/web/foo.ts" matches that file
 *   - Basename:   "foo.ts" matches any file named foo.ts
 *   - Glob:       "*" = any chars except /,  "**" = any chars including /
 *
 * Common patterns:
 *   *.test.ts        Exclude any file ending in .test.ts
 *   *.spec.ts        Exclude spec files
 *   **\/*.ts        Include only .ts files (use with --include)
 *
 * =============================================================================
 * EXAMPLES
 * =============================================================================
 *
 * --- Single folder (output: apps-web-src-inngest.md) ---
 *   node merge-to-md.js apps/web/src/inngest
 *
 * --- Single file (output: apps-web-src-config-app-config.md) ---
 *   node merge-to-md.js apps/web/src/config/app-config.ts
 *
 * --- Multiple files (output: merged.md) ---
 *   node merge-to-md.js packages/contracts/src/index.ts apps/web/src/config/app-config.ts
 *
 * --- Multiple folders (output: merged.md) ---
 *   node merge-to-md.js apps/web/src/inngest apps/web/src/server
 *
 * --- Mixed files and folders (output: merged.md) ---
 *   node merge-to-md.js foo.ts bar/ apps/web/src
 *
 * --- Exclude test files ---
 *   node merge-to-md.js --except "*.test.ts,*.spec.ts" apps/web/src
 *
 * --- Exclude a specific file by basename ---
 *   node merge-to-md.js --except "README.md" apps/web/src/inngest
 *
 * --- Include only TypeScript files ---
 *   node merge-to-md.js --include "**\/*.ts,**\/*.tsx" apps/web/src
 *
 * --- Custom output location and name ---
 *   node merge-to-md.js --out docs/context --name assistant-code apps/web/src/features/assistant
 *
 * --- Git changed files ---
 *   node merge-to-md.js --git
 *
 * --- Git changed, exclude tests, custom output ---
 *   node merge-to-md.js --git --except "*.test.ts" --out temp --name changed
 *
 * --- Combine: folder + exclude + custom name ---
 *   node merge-to-md.js --except "*.test.ts" --name inngest-clean apps/web/src/inngest
 *
 * --- Exclude asset files by default (gif, png, mp4, etc.); use --assets mention to list them ---
 *   node merge-to-md.js apps/web/src
 *   node merge-to-md.js --assets mention apps/web/src
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/** Path segments to exclude by default (e.g. .git, node_modules, temp folders). */
/** Binary/asset extensions: never paste content; ignore by default or mention existence. */
const ASSET_EXTENSIONS = new Set([
  // images
  ".gif", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".bmp", ".tiff", ".tif",
  // audio
  ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac",
  // video
  ".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v",
  // fonts
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  // other binary
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
]);

/** OS metadata files: always excluded (no extension or binary, never useful in merged output). */
const EXCLUDED_BASENAMES = new Set([
  ".DS_Store",   // macOS
  "Thumbs.db",   // Windows
  "desktop.ini", // Windows
]);

function isAssetFile(relPath) {
  return ASSET_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

function isExcludedBasename(relPath) {
  return EXCLUDED_BASENAMES.has(path.basename(relPath));
}

const DEFAULT_EXCLUDE_SEGMENTS = [
  ".git",
  "node_modules",
  "temp",
  "tmp",
  ".tmp",
  ".temp",
  "vendor", // common dependency dirs
  ".venv",
  ".turbo",
  "dist",
  "__pycache__",
];

/** Check if path should be excluded by default (ignored segments). */
function isDefaultExcluded(relPath) {
  const segments = relPath.split(/[/\\]/).filter(Boolean);
  return segments.some((seg) => DEFAULT_EXCLUDE_SEGMENTS.includes(seg));
}

/**
 * Get the path relative to the given input root. Used so we only apply default
 * excludes to segments *within* the input (e.g. node_modules inside the repo),
 * not to the path leading to it (e.g. "temp" in gamedev/temp/my-repo).
 */
function pathWithinRoot(filePath, inputRoot) {
  const normalized = path.normalize(filePath).replace(/\\/g, "/");
  const root = path.normalize(inputRoot).replace(/\\/g, "/");
  if (!root) return normalized;
  if (normalized === root) return "";
  const prefix = root.endsWith("/") ? root : root + "/";
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return normalized; // not under this root
}

/** File extension to Markdown fenced code block language. */
const EXT_TO_LANG = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".md": "markdown",
  ".mdx": "mdx",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".sql": "sql",
  ".py": "python",
  ".sh": "shell",
  ".yaml": "yaml",
  ".yml": "yaml",
};

const cwd = process.cwd();

/** Minimal glob matcher: * = any chars except /, ** = any chars including /. */
function matchesGlob(relPath, pattern) {
  let p = pattern.trim();
  if (!p) return false;
  // Exact path: match full path or basename (e.g. "bar.ts" matches any */bar.ts)
  if (!p.includes("*")) {
    return (
      relPath === p || relPath.endsWith("/" + p) || path.basename(relPath) === p
    );
  }
  // Convert to regex: ** matches anything, * matches non-slash
  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "{{STAR}}");
  const reStr = escaped
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
    .replace(/\{\{STAR\}\}/g, "[^/]*");
  const re = new RegExp("^" + reStr + "$");
  return re.test(relPath);
}

/** Check if path is excluded by any pattern in the list. */
function isExcluded(relPath, patterns) {
  if (!patterns.length) return false;
  return patterns.some((p) => matchesGlob(relPath, p));
}

/** Check if path is included by any pattern (when include list is non-empty). */
function isIncluded(relPath, patterns) {
  if (!patterns.length) return true;
  return patterns.some((p) => matchesGlob(relPath, p));
}

/** Recursively collect all file paths under dir (relative to cwd). */
function listFilesRecursive(dir, base = "") {
  const results = [];
  const dirPath = path.join(dir, base);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return results;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const rel = base ? path.join(base, e.name) : e.name;
    if (e.isDirectory()) {
      results.push(...listFilesRecursive(dir, rel));
    } else if (e.isFile()) {
      results.push(rel);
    }
  }
  return results;
}

/** Collect all file paths from args: mix of files and folders. */
function collectPaths(pathArgs) {
  const seen = new Set();
  const collected = [];

  for (const arg of pathArgs) {
    const resolved = path.resolve(cwd, arg);
    if (!fs.existsSync(resolved)) {
      console.warn("Warning: skipping missing path:", arg);
      continue;
    }
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      const rel = path.relative(cwd, resolved);
      if (!seen.has(rel)) {
        seen.add(rel);
        collected.push(rel);
      }
    } else if (stat.isDirectory()) {
      const dirRel = path.relative(cwd, resolved);
      const files = listFilesRecursive(resolved, "");
      for (const f of files) {
        const fullRel = dirRel ? path.join(dirRel, f) : f;
        if (!seen.has(fullRel)) {
          seen.add(fullRel);
          collected.push(fullRel);
        }
      }
    } else {
      console.warn("Warning: skipping non-file non-dir:", arg);
    }
  }

  return collected.sort();
}

/** Get paths of files that are added or modified in git (not deleted). */
function getGitChangedFiles() {
  const out = execSync("git status --porcelain", { encoding: "utf8", cwd });
  const paths = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    let filePath = line.slice(3).trim();
    if (status[0] === "D" || status[1] === "D") continue;
    if (filePath.includes(" -> ")) {
      filePath = filePath.split(" -> ").pop().trim();
    }
    paths.push(filePath);
  }
  return paths;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let outDir = path.resolve(cwd, "temp/llm-context");
  let outName = null;
  const exceptList = [];
  const includeList = [];
  let useGit = false;
  const pathArgs = [];

  let assetsMode = "ignore"; // ignore | mention

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outDir = path.resolve(cwd, args[i + 1]);
      i++;
    } else if (args[i] === "--assets" && args[i + 1]) {
      const m = (args[i + 1] || "").toLowerCase();
      if (m === "ignore" || m === "mention") assetsMode = m;
      i++;
    } else if (args[i] === "--name" && args[i + 1]) {
      outName = args[i + 1];
      i++;
    } else if (args[i] === "--except" && args[i + 1]) {
      exceptList.push(
        ...args[i + 1]
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      );
      i++;
    } else if (args[i] === "--include" && args[i + 1]) {
      includeList.push(
        ...args[i + 1]
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      );
      i++;
    } else if (args[i] === "--git") {
      useGit = true;
    } else if (!args[i].startsWith("--")) {
      pathArgs.push(args[i]);
    }
  }

  return { outDir, outName, exceptList, includeList, assetsMode, useGit, pathArgs };
}

function main() {
  const { outDir, outName, exceptList, includeList, assetsMode, useGit, pathArgs } =
    parseArgs();

  let filePaths;
  let inputPathsForName;

  let inputRoots = []; // paths relative to cwd; used to scope default excludes

  if (useGit) {
    filePaths = getGitChangedFiles();
    inputPathsForName = null; // used for git-changed default
  } else {
    if (pathArgs.length === 0) {
      console.error(
        "Usage: node merge-to-md.js [options] <path1> [path2] ...\n" +
          "  Use --git for git changed files, or provide file/folder paths."
      );
      process.exit(1);
    }
    filePaths = collectPaths(pathArgs);
    inputPathsForName = pathArgs;
    // Compute input roots so we only apply default excludes to paths *within* them
    for (const arg of pathArgs) {
      const resolved = path.resolve(cwd, arg);
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        const rel = path.relative(cwd, resolved);
        inputRoots.push(stat.isDirectory() ? rel : path.dirname(rel));
      }
    }
  }

  // Apply filters: default excludes → include (if any) → except
  // When input roots exist, only exclude based on segments *within* those roots
  filePaths = filePaths.filter((rel) => {
    let pathToCheck = rel;
    if (inputRoots.length > 0) {
      const within = inputRoots
        .map((root) => pathWithinRoot(rel, root))
        .find((p) => p !== rel); // p !== rel means file is under that root
      if (within !== undefined) pathToCheck = within;
    }
    return !isDefaultExcluded(pathToCheck);
  });
  filePaths = filePaths.filter((rel) => isIncluded(rel, includeList));
  filePaths = filePaths.filter((rel) => !isExcluded(rel, exceptList));

  // Keep only files (git status can include directories)
  filePaths = filePaths.filter((rel) => {
    const fullPath = path.resolve(cwd, rel);
    if (!fs.existsSync(fullPath)) return false;
    return fs.statSync(fullPath).isFile();
  });

  // Always exclude OS metadata files (.DS_Store, Thumbs.db, desktop.ini)
  filePaths = filePaths.filter((rel) => !isExcludedBasename(rel));

  // By default, exclude binary/asset files (gif, png, mp4, etc.)
  if (assetsMode === "ignore") {
    filePaths = filePaths.filter((rel) => !isAssetFile(rel));
  }

  if (filePaths.length === 0) {
    console.log("No files to merge after filtering.");
    process.exit(0);
  }

  // Build blocks and compute line ranges
  const blocks = [];
  const entries = []; // { relPath, startLine, endLine }

  for (const relPath of filePaths) {
    const fullPath = path.resolve(cwd, relPath);
    const ext = path.extname(relPath);
    const lang = EXT_TO_LANG[ext] ?? "";
    const opening = lang ? lang + " " + relPath : relPath;

    let content;
    if (isAssetFile(relPath)) {
      content = `(asset file: ${relPath})`;
    } else {
      content = fs.readFileSync(fullPath, "utf8");
    }
    const block = "```" + opening + "\n" + content + "\n```\n";
    blocks.push(block);
  }

  // TOC format: header + blank + table header + separator + N rows, then "\n\n" before body
  const tocHeader =
    "# File Index\n\n| Path | Start | End |\n|------|-------|-----|";

  // TOC line count + blank line between TOC and first block
  const tocLineCount = tocHeader.split(/\n/).length + blocks.length + 1;
  let currentLine = tocLineCount + 1;

  for (let i = 0; i < blocks.length; i++) {
    const blockLines = blocks[i].split(/\n/).length;
    const startLine = currentLine;
    const endLine = currentLine + blockLines - 1;
    entries.push({
      relPath: filePaths[i],
      startLine,
      endLine,
    });
    currentLine += blockLines;
  }

  const tocRows = entries
    .map((e) => `| ${e.relPath} | ${e.startLine} | ${e.endLine} |`)
    .join("\n");
  const toc = tocHeader + "\n" + tocRows;
  const body = blocks.join("\n");
  const output = toc + "\n\n" + body;

  // Resolve output name
  let resolvedName;
  if (outName) {
    resolvedName = outName;
  } else if (useGit) {
    resolvedName = "git-changed";
  } else if (inputPathsForName.length === 1) {
    const first = path.normalize(inputPathsForName[0]).replace(/[/\\]/g, "-");
    resolvedName = first.replace(/^\.+-*|-+$/g, "").replace(/-+/g, "-") || "merged";
  } else {
    resolvedName = "merged";
  }

  const outPath = path.join(outDir, resolvedName + ".md");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, output, "utf8");

  console.log(
    "Wrote",
    filePaths.length,
    "files to",
    path.relative(cwd, outPath)
  );
}

main();
