#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const COMMANDS = {
  'merge': {
    script: 'llm-helpers/merge-to-md.js',
    args: [],
    description: 'Merge files/folders into a single Markdown file for LLM context',
  },
  'merge-git': {
    script: 'llm-helpers/merge-to-md.js',
    args: ['--git'],
    description: 'Merge git changed files (added/modified) into a Markdown file',
  },
  'optimize': {
    script: 'img-helpers/optimize.mjs',
    args: [],
    description: 'Batch-optimize raster images to AVIF + WebP with responsive widths',
  },
  'collect-serp': {
    script: 'serp-helpers/collect-google.mjs',
    args: [],
    description: 'Collect organic Google results for one query with headed Playwright',
  },
};

const scriptDir = path.resolve(__dirname);
const cwd = process.cwd();

function printHelp() {
  console.log('Usage: node scripts/run.js <command> [options]\n');
  console.log('Commands:');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(16)} ${cmd.description}`);
  }
  console.log('\nRun node scripts/run.js <command> --help for command-specific options.');
}

const [, , command, ...rest] = process.argv;

if (!command || command === '--help') {
  printHelp();
  process.exit(0);
}

const cmd = COMMANDS[command];
if (!cmd) {
  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

const scriptPath = path.join(scriptDir, cmd.script);
const result = spawnSync('node', [scriptPath, ...cmd.args, ...rest], {
  stdio: 'inherit',
  cwd,
});
process.exit(result.status ?? 1);
