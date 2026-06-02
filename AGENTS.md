# AGENTS.md

## Project

This repository is a portable collection of local scripts for LLM workflows, asset tooling, and research utilities. It is intended to be cloned into other projects and run from the host project's root with:

```bash
node scripts/run.js <command> [options]
```

The central dispatcher is `run.js`. New tools should usually be added as focused helper folders and registered in the dispatcher instead of creating separate standalone packages.

## Current Conventions

- Prefer plain Node.js JavaScript (`.js` or `.mjs`) unless there is a strong reason to add a build step.
- Keep scripts portable and runnable from the caller's current working directory.
- Resolve user-facing input and output paths relative to `process.cwd()`.
- Keep each helper focused on one responsibility.
- Avoid unnecessary dependencies, but add real dependencies when they materially simplify the tool.
- Update `README.md` when adding or changing public commands.

## Existing Commands

- `merge`: merge selected files and folders into an LLM-friendly Markdown file.
- `merge-git`: merge git changed files into an LLM-friendly Markdown file.
- `optimize`: batch-optimize raster images into responsive AVIF/WebP/JPEG variants.

## Agent Rules

- Do not run git mutation commands in this repo. This includes `git add`, `git commit`, `git push`, `git checkout`, `git reset`, rebases, merges, and branch mutations.
- Read-only git inspection is allowed when useful, such as `git status`, `git diff`, `git log`, and `git show`.
- Do not revert or overwrite user changes unless explicitly requested.
- Use `rg` / `rg --files` for search when available.
- Use `apply_patch` for manual file edits.
- Before editing files, explain the intended edits briefly.
- Verify changes with the narrowest practical command, and report any verification that could not be run.

## New Tool Guidance

When adding a script:

1. Put implementation files in a focused helper folder, such as `serp-helpers/`.
2. Register the command in `run.js`.
3. Add an npm script in `package.json` only when it is useful from inside this repo.
4. Document user-facing usage in `README.md`.
5. Keep generated output, local caches, browser profiles, and temporary run artifacts out of version control.
