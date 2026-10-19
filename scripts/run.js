/**
 * Runs the suite locally the same way CI does.
 *
 *   node scripts/run.js [--platform test|main] [--suite all|mlp,alm,...]
 *   node scripts/run.js --open [--platform test|main]   interactive Cypress app
 *
 * Writes cypress/reports/results-<platform>.json and the dashboard at
 * cypress/reports/site/<platform>/index.html. Exits non-zero if any test fails.
 */
const { spawnSync } = require('child_process');
const { PLATFORMS, specsFor } = require('../shared/suites');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const platform = arg('platform', 'test');
const suite = arg('suite', 'all');
if (!PLATFORMS[platform]) {
  console.error(`Unknown platform "${platform}". Use: ${Object.keys(PLATFORMS).join(', ')}`);
  process.exit(1);
}

// Set by VS Code's terminal; it stops the Cypress binary from starting.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.includes('--open')
  ? ['cypress', 'open', '--e2e', '--browser', 'electron', '--env', `platform=${platform}`]
  : ['cypress', 'run', '--browser', 'electron', '--env', `platform=${platform}`, '--spec', specsFor(suite)];

const result = spawnSync(
  'npx',
  args,
  { stdio: 'inherit', env, shell: process.platform === 'win32' }
);
process.exit(result.status === null ? 1 : result.status);
