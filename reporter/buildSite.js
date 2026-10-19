/**
 * Builds the published site from a run's results.
 *
 *   <site>/index.html                       landing page (both platforms)
 *   <site>/<platform>/index.html            dashboard
 *   <site>/<platform>/meta.json             headline numbers
 *   <site>/<platform>/suites/<suite>.json   latest result per suite
 *   <site>/<platform>/screenshots/<suite>/  failure screenshots
 *
 * Each suite keeps its own latest result, so running one suite refreshes that
 * suite only and the dashboard still shows the others from their last run.
 *
 * CLI: node reporter/buildSite.js <siteDir> <platform> [resultsJson]
 */
const fs = require('fs');
const path = require('path');
const { SUITES, PLATFORMS } = require('../shared/suites');
const { generateReport } = require('./generateReport');
const { buildIndex } = require('./buildIndex');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function specOrder(suiteId, spec) {
  const def = SUITES.find((s) => s.id === suiteId);
  const i = def ? def.specs.indexOf(spec) : -1;
  return i === -1 ? 99 : i;
}

function writeSuite(platformDir, suite, run) {
  // Screenshots are named per run so files referenced by kept tests survive.
  const shotDir = path.join(platformDir, 'screenshots', suite.id);
  const stamp = run.endedAt.replace(/\D/g, '').slice(0, 14);
  let n = 0;
  const tests = suite.tests.map((test) => {
    const screenshots = [];
    for (const src of test.screenshots || []) {
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(shotDir, { recursive: true });
      const file = `${stamp}-${++n}-${path.basename(src).replace(/[^\w.-]+/g, '_')}`;
      fs.copyFileSync(src, path.join(shotDir, file));
      screenshots.push(`screenshots/${suite.id}/${file}`);
    }
    return { ...test, screenshots };
  });
  // A run of some of a suite's specs (e.g. only downloadSyllabus) replaces those
  // specs' tests and keeps the latest results of the suite's other specs.
  const previous = readJson(path.join(platformDir, 'suites', `${suite.id}.json`));
  const ranSpecs = new Set(tests.map((t) => t.spec));
  const kept = previous ? previous.tests.filter((t) => !ranSpecs.has(t.spec)) : [];
  const merged = [...kept, ...tests].sort(
    (a, b) => specOrder(suite.id, a.spec) - specOrder(suite.id, b.spec)
  );
  const totals = { tests: 0, passed: 0, failed: 0, skipped: 0 };
  for (const t of merged) {
    totals.tests += 1;
    totals[t.state] += 1;
  }
  const stored = {
    ...suite,
    tests: merged,
    totals,
    status: totals.failed ? 'failed' : totals.passed ? 'passed' : 'skipped',
    durationMs: merged.reduce((ms, t) => ms + (t.durationMs || 0), 0),
    run,
  };
  // Drop screenshot files no test refers to any more.
  const referenced = new Set(merged.flatMap((t) => t.screenshots || []).map((s) => path.basename(s)));
  if (fs.existsSync(shotDir)) {
    for (const f of fs.readdirSync(shotDir)) if (!referenced.has(f)) fs.rmSync(path.join(shotDir, f));
  }
  fs.mkdirSync(path.join(platformDir, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(platformDir, 'suites', `${suite.id}.json`), JSON.stringify(stored, null, 2));
}

function loadSuites(platformDir) {
  const order = SUITES.map((s) => s.id);
  const dir = path.join(platformDir, 'suites');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f)))
    .filter(Boolean)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

function buildSite({ siteDir, platformId, results }) {
  const platformDir = path.join(siteDir, platformId);
  fs.mkdirSync(platformDir, { recursive: true });

  if (results) {
    const run = { startedAt: results.startedAt, endedAt: results.endedAt };
    for (const suite of results.suites) writeSuite(platformDir, suite, run);
  }

  const suites = loadSuites(platformDir);
  const totals = { tests: 0, passed: 0, failed: 0, skipped: 0 };
  let durationMs = 0;
  let lastRun = '';
  for (const s of suites) {
    for (const k of Object.keys(totals)) totals[k] += s.totals[k];
    durationMs += s.durationMs || 0;
    if (s.ranAt > lastRun) lastRun = s.ranAt;
  }

  const platform = PLATFORMS[platformId];
  const model = { platformId, platform, suites, totals, durationMs, lastRun, latestRun: results || null };
  fs.writeFileSync(path.join(platformDir, 'index.html'), generateReport(model), 'utf8');
  fs.writeFileSync(
    path.join(platformDir, 'meta.json'),
    JSON.stringify(
      {
        platform: platformId,
        totals,
        durationMs,
        lastRun,
        suites: suites.map((s) => ({ id: s.id, name: s.name, status: s.status, totals: s.totals, ranAt: s.ranAt })),
      },
      null,
      2
    )
  );

  fs.writeFileSync(path.join(siteDir, 'index.html'), buildIndex(siteDir), 'utf8');
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
  return path.join(platformDir, 'index.html');
}

if (require.main === module) {
  const [siteDir, platformId, resultsFile] = process.argv.slice(2);
  if (!siteDir || !PLATFORMS[platformId]) {
    console.error('Usage: node reporter/buildSite.js <siteDir> <test|main> [resultsJson]');
    process.exit(1);
  }
  const results = resultsFile ? readJson(resultsFile) : null;
  if (resultsFile && !results) {
    console.error(`Could not read results from ${resultsFile}`);
    process.exit(1);
  }
  console.log(`Report written to ${buildSite({ siteDir, platformId, results })}`);
}

module.exports = { buildSite };
