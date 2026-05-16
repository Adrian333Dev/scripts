# Image Optimization Script Design

**Date:** 2026-05-16
**Scope:** Add a portable batch image optimizer to the scripts repo. Reduces shipped image bytes for raster assets while preserving high visual quality, and emits a machine-readable manifest for downstream `<picture>` / `srcset` consumers.

---

## Problem

Modern web projects ship oversized raster assets. Hand-optimizing each image is slow and inconsistent. The scripts repo needs a one-command tool that:

- Optimizes any folder of raster images deterministically
- Produces multiple widths in modern formats (AVIF, WebP) for responsive consumption
- Preserves visual quality — especially on UI/text-heavy screenshots
- Skips work that's already done
- Outputs a manifest so SSR layers can wire variants without hardcoding filenames

The original project-specific requirements (`temp/img-opt-requirements.md`) hardcoded the input path, width ladder, and output structure. This design generalizes those into a portable script with sensible defaults and a small CLI surface.

---

## Solution

A single-file Node.js script at `scripts/img-helpers/optimize.mjs`, registered in `run.js` as `optimize`. Uses `sharp` (libvips bindings) as the encoder — the de facto best-in-class library; well-maintained, prebuilt binaries, wraps mozjpeg + libaom + libwebp.

```bash
node scripts/run.js optimize src/assets/scenes
```

Zero flags = sensible defaults work for the common case. Flags exist only for the high-impact knobs.

---

## Architecture & File Layout

```
scripts/
├── run.js                          ← add 'optimize' command
├── package.json                    ← add sharp as a dependency
├── .gitignore                      ← add node_modules/
├── README.md                       ← document optimize + sharp install
├── llm-helpers/
│   └── merge-to-md.js              (unchanged)
└── img-helpers/
    └── optimize.mjs                ← NEW
```

**Single-file rationale.** `merge-to-md.js` is one ~500 LOC file; this matches the existing pattern. v1 target is ~400 LOC. If it grows past ~600 LOC, we decompose later.

**Why `.mjs`.** Native ESM, lets us use top-level await for parallel encoding without flipping the whole repo to ESM.

**`run.js` registration:**

```js
'optimize': {
  script: 'img-helpers/optimize.mjs',
  args: [],
  description: 'Batch-optimize raster images to AVIF + WebP with responsive widths',
},
```

---

## Dependency Model

`sharp` is added to `scripts/package.json` as a real dependency. After cloning, the user runs `pnpm install` (or `npm install`) once inside `scripts/`.

This breaks the "zero install" promise the repo had previously, but the alternatives (requiring host project to install sharp, or shelling out to a CLI) are worse: cleaner contract, less coupling to host project's package manager, and `merge` etc. still work without `node_modules` because they don't `require()` anything beyond stdlib.

**Changes:**
- `scripts/package.json` — add `sharp` to `dependencies`. The plan installs via `pnpm add sharp` inside `scripts/`, which pins the current stable caret range.
- `scripts/.gitignore` — add `node_modules/`
- `scripts/README.md` — document the install step in the Setup section

---

## CLI Surface

**Invocation:** `node scripts/run.js optimize <input...> [options]`

Positional args are paths (files or folders, recursed). Mirrors `merge` ergonomic.

### Default behavior (no flags)

- Walk input paths, find `.png .jpg .jpeg .webp` files (skip `.svg`, `.gif`, anything else)
- Encode each to AVIF + WebP at widths `480, 768, 1024, 1440, 1920` (never upscale)
- Output to `<first-input>/optimized/` (single input that's a dir) or `temp/optimized/` (multi-input / file input / `--only` filter)
- Write `manifest.json` next to outputs
- Skip files whose source mtime + size + encoding config haven't changed
- Run encodes in parallel: JS semaphore = `os.cpus().length`, `sharp.concurrency(1)` per op
- Always print a report at the end (no `--report` flag needed)

### Flags

| Flag | Default | Purpose |
|---|---|---|
| `--out <dir>` | smart default | Output directory |
| `--widths <list>` | `480,768,1024,1440,1920` | Comma-separated widths |
| `--formats <list>` | `avif,webp` | Comma-separated formats (`avif`, `webp`, `jpeg`) |
| `--quality <list>` | `avif=60,webp=85,jpeg=82` | Per-format quality overrides |
| `--only <glob>` | — | Process only matching files |
| `--except <glob>` | — | Exclude matching files (matches `merge` semantics) |
| `--force` | off | Regenerate even if cache is fresh |
| `--dry-run` | off | Print the plan and exit without writing |

**Glob semantics** match `merge-to-md.js`: `*` = any chars except `/`, `**` = any chars including `/`.

**Not in v1:** `--watch`, `--config`, `--preset`, `--report` (always on), `--verbose`. YAGNI.

### Example invocations

```bash
# Default — drop-in optimize a folder
node scripts/run.js optimize src/assets/scenes

# Custom widths and output
node scripts/run.js optimize --widths 640,1280,1920 --out public/img src/assets/scenes

# Subset re-run
node scripts/run.js optimize --only "**/hero-*.png" --force src/assets

# Quality bump (e.g. for screenshot-heavy folder)
node scripts/run.js optimize --quality avif=68,webp=90 src/assets/screenshots

# Add JPEG fallback alongside AVIF + WebP
node scripts/run.js optimize --formats avif,webp,jpeg src/assets/scenes
```

---

## Encoding Strategy

This is the heart of the "preserve high quality" goal. All choices are libvips/sharp best practice — not invented from scratch.

### Per-variant pipeline (one source × one width × one format)

```js
let pipeline = sharp(sourceBuffer, { failOn: 'truncated' })
  .resize({
    width,
    withoutEnlargement: true,        // never upscale
    kernel: 'lanczos3',              // best-quality downscale filter
    fit: 'inside',
  });

if (format === 'avif') {
  pipeline = pipeline.avif({
    quality: 60,                     // visually transparent for photos and UI
    effort: 6,                       // 0-9; 6 = strong compression, reasonable time
    chromaSubsampling: '4:4:4',      // crisp colored-text edges
  });
} else if (format === 'webp') {
  pipeline = pipeline.webp({
    quality: 85,
    effort: 5,                       // 0-6
    smartSubsample: true,            // adaptive: 4:4:4 in detail, 4:2:0 in smooth regions
    alphaQuality: 100,               // never compress alpha (clean UI edges)
  });
} else if (format === 'jpeg') {
  pipeline = pipeline.jpeg({
    quality: 82,
    progressive: true,
    mozjpeg: true,                   // ~10-15% smaller at same perceived quality
    chromaSubsampling: '4:4:4',
  });
}
```

### Non-obvious quality-preserving choices

| Setting | Sharp default | Our choice | Why |
|---|---|---|---|
| `chromaSubsampling` (AVIF, JPEG) | `4:2:0` | `4:4:4` | 4:2:0 halves color resolution — fine for nature photos, terrible for red text on a button. Cost: ~5-15% larger output. |
| `smartSubsample` (WebP) | `false` | `true` | Adaptive subsampling: full chroma on text/edges, halved on smooth gradients. Best of both. |
| `mozjpeg` (JPEG) | `false` | `true` | mozjpeg encoder is ~10-15% smaller at the same perceived quality. No downside for static assets. |
| `alphaQuality` (WebP) | `100` | keep `100` | Lossy alpha causes visible halos on cutout UI elements. The alpha channel is small. |
| `effort` (AVIF / WebP) | AVIF 4, WebP 4 | AVIF 6, WebP 5 | Higher effort = smaller output for same quality. 2-3× encode time, but this runs offline. |
| `kernel` (resize) | `lanczos3` | keep `lanczos3` | Highest-quality downscale filter in libvips. (Explicit for clarity in code.) |
| `failOn` (input) | `'warning'` | `'truncated'` | Throws on corrupt input rather than producing garbage. |

### Per-source pipeline shape

```js
for (const source of sources) {
  const buffer = await fs.readFile(source.path);
  const meta = await sharp(buffer).metadata();
  const validWidths = widths.filter(w => w <= meta.width); // never upscale
  await Promise.all(
    validWidths.flatMap(w =>
      formats.map(fmt => semaphore(() => encodeOne(buffer, w, fmt, meta, outDir)))
    )
  );
}
```

Outer loop sequential (one source's buffer at a time → bounded memory). Inner variants parallel via a small JS semaphore = `os.cpus().length`. `sharp.concurrency(1)` is set globally so each sharp op uses one thread; combined with the semaphore this gives one sharp op per core with no thread thrash. Canonical sharp pattern.

### What we explicitly do *not* do

- No image-type auto-detection (photo vs UI vs text). Heuristic classification is fragile; one conservative preset + `--quality` override beats clever-but-wrong.
- No nested `--quality-photo` / `--quality-ui` flags.
- No per-image config files.
- No `--lossless` flag (user can pass `--quality avif=85,webp=95` for near-lossless if needed).

---

## Output Structure

```
<out-dir>/
├── <basename>/
│   ├── <basename>-480.avif
│   ├── <basename>-480.webp
│   ├── <basename>-768.avif
│   └── ...
├── manifest.json              ← consumed by SSR / <picture> components
└── .optimize-cache.json       ← internal; user should .gitignore
```

### Naming rules

- Per-source folder = source's basename without extension. E.g. `hero.png` → `<out>/hero/hero-480.avif`.
- **On collision** (two `hero.png` files in different input subfolders): error early with a clear message — *"Multiple sources resolve to output folder 'hero'. Run separately with --out per group or rename."* Keeps the common case clean; surfaces ambiguity loudly.
- Manifest key = source path relative to cwd (always unique, even when folder names collide).

### Default `--out` resolution

| Input shape | Default `--out` |
|---|---|
| Single input that's a directory | `<input>/optimized/` |
| Single input that's a file | `<dir-of-file>/optimized/` |
| Multiple inputs or `--only` filter active | `temp/optimized/` |

User-supplied `--out` always wins.

### Manifest shape

```json
{
  "$config": {
    "widths": [480, 768, 1024, 1440, 1920],
    "formats": ["avif", "webp"],
    "quality": { "avif": 60, "webp": 85 },
    "generatedAt": "2026-05-16T14:32:00Z"
  },
  "src/assets/scenes/hero.png": {
    "source": "src/assets/scenes/hero.png",
    "width": 1920,
    "height": 1080,
    "aspectRatio": 1.7778,
    "hasAlpha": false,
    "variants": {
      "avif": [
        { "width": 480, "path": "hero/hero-480.avif", "bytes": 12450 },
        { "width": 768, "path": "hero/hero-768.avif", "bytes": 28100 }
      ],
      "webp": [
        { "width": 480, "path": "hero/hero-480.webp", "bytes": 18200 }
      ]
    }
  }
}
```

- Variant `path` is **relative to the manifest file** — consumers do `path.join(manifestDir, variant.path)` regardless of where the dir is mounted.
- `aspectRatio` lets SSR components set `width`/`height` attrs for CLS prevention without re-reading metadata.
- `hasAlpha` lets consumers pick fallback formats appropriately (e.g. skip JPEG variants when alpha matters).
- `$config` is both useful context for consumers and the source-of-truth for the cache config hash.

---

## Cache Strategy (skip-unchanged)

`.optimize-cache.json` per output dir:

```json
{
  "configHash": "a3f2c1b8",
  "entries": {
    "src/assets/scenes/hero.png": {
      "mtime": 1747400000000,
      "size": 524288,
      "outputs": ["hero/hero-480.avif", "hero/hero-480.webp"]
    }
  }
}
```

- A source is skipped when **all three** match: `mtime`, `size`, and the global `configHash`.
- `configHash` is SHA-256 of `JSON.stringify({widths, formats, quality})` truncated to 8 chars. Changing `--quality avif=68` invalidates everything; rerunning with the same flags re-uses the cache.
- `--force` ignores the cache.
- `--dry-run` reads the cache and prints what *would* happen (which sources are skipped, which would re-encode).

---

## Safety Guards & Errors

### Warnings (not blockers)

| Condition | Action |
|---|---|
| Any encoded variant exceeds the source file's byte size | `warn` — source is already well-compressed or quality is too high; keep output (the variant is still served, but the user should reconsider the source or quality) |
| Source has alpha + `jpeg` requested | `warn` + **skip the JPEG variant for that source** (don't silently composite onto white) |
| Generated dimensions don't match the requested width (libvips edge case) | `warn` |
| Width > source width | silently skip that variant (this is "never upscale" — expected, not a warning) |

### Errors (exit non-zero)

| Condition | Exit code |
|---|---|
| Sharp encode failure on a source | `error` log, **continue with remaining sources**, exit `1` at end |
| Missing input path | fail fast, exit `2` |
| Invalid `--widths` / `--formats` / `--quality` | fail fast, exit `2` |
| Output dir not writable | fail fast, exit `2` |

One bad image doesn't block the other 99 — but the exit code reflects that something went wrong, so CI catches it.

### Per-source log line (ASCII markers — no emoji)

```
  ok     hero.png             10 variants   4.2 MB -> 320 KB  (-92%)
  skip   footer-bg.jpg        cached
  warn   logo.png             alpha + jpeg requested -> jpeg variant skipped
  error  broken.png           sharp: input has corrupt header
```

### Final report

```
Image Optimization Report
-------------------------
Sources scanned:        12 files (24.3 MB)
Skipped (cache):         8 files
Re-encoded:              4 files (8.1 MB)
Variants written:       40 files (1.2 MB)
Total saving:           6.9 MB -> 1.2 MB  (-82.6%)
Largest single saving:  hero.png  (4.2 MB -> 320 KB across 10 variants)
Warnings: 1
Errors:   0
```

For `--dry-run`, lines become `Would skip…` / `Would re-encode…` / `Variants planned: 40`. No files written.

---

## Out of Scope

- **SVG optimization.** Different tooling (svgo); separate job.
- **GIF optimization.** Different tooling; separate job.
- **`--watch` mode.** Run on demand or via CI step.
- **Auto-detection of image type.** One preset + override flag.
- **Wiring the manifest into a `ResponsiveImage` React component.** v1 only produces the manifest; consumers are out of scope for this spec.
- **Updating `src/project/config/scenarios.ts` or any project-specific config.** The script is portable; it doesn't touch host project source.
- **`temp/img-opt-requirements.md` clean-up.** That's a host-project decision, not a scripts-repo task.

---

## Acceptance Criteria

Done means:

- `node scripts/run.js optimize <dir>` produces AVIF + WebP variants for all raster images in `<dir>`.
- Originals are never modified.
- No upscaled variants are generated.
- `manifest.json` is written with the documented shape.
- A report shows source bytes vs generated variant bytes.
- Re-running with no changes skips all work and prints a "skipped (cache)" report.
- `--force` regenerates everything.
- `--dry-run` prints the plan without writing.
- Exit codes match the documented behavior (`0` success, `1` partial encode failure, `2` setup error).
- README documents install (`pnpm install` inside `scripts/`) and the `optimize` command.
