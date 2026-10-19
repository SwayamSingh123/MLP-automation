/**
 * Builds the published site from a run's results.
 *
 *   <site>/index.html                 landing page (both platforms)
 *   <site>/<platform>/index.html      dashboard for the latest run
 *   <site>/<platform>/results.json    that run's results (screenshot paths relative)
 *   <site>/<platform>/meta.json       headline numbers for the landing page
 *   <site>/<platform>/screenshots/    that run's failure screenshots
 *
 * Every run REPLACES its platform's report: running only MLP shows only MLP;
 * running every suite shows every suite. Nothing from an earlier run is kept.
 *
 * CLI: node reporter/buildSite.js <siteDir> <platform> [resultsJson]
 *      (without resultsJson it re-renders the platform's saved results.json)
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

/** Copies the run's failure screenshots next to the report; returns results with relative paths. */
function publishScreenshots(platformDir, results) {
  const shotRoot = path.join(platformDir, 'screenshots');
  let n = 0;
  return {
    ...results,
    suites: results.suites.map((suite) => ({
      ...suite,
      tests: suite.tests.map((test) => {
        const screenshots = [];
        for (const src of test.screenshots || []) {
          if (/^screenshots\//.test(src)) {
            screenshots.push(src); // already published (re-render)
            continue;
          }
          if (!fs.existsSync(src)) continue;
          const dir = path.join(shotRoot, suite.id);
          fs.mkdirSync(dir, { recursive: true });
          const file = `${++n}-${path.basename(src).replace(/[^\w.-]+/g, '_')}`;
          fs.copyFileSync(src, path.join(dir, file));
          screenshots.push(`screenshots/${suite.id}/${file}`);
        }
        return { ...test, screenshots };
      }),
    })),
  };
}

/** "All suites", or the names of the suites this run covered. */
function runScope(results) {
  const ran = new Set(results.suites.map((s) => s.id));
  const all = SUITES.every((s) => ran.has(s.id));
  return {
    all,
    label: all ? 'All suites' : results.suites.map((s) => s.name).join(' · ') || 'No tests',
  };
}

function buildSite({ siteDir, platformId, results }) {
  const platformDir = path.join(siteDir, platformId);

  let run;
  if (results) {
    // A new run replaces everything this platform showed before.
    fs.rmSync(platformDir, { recursive: true, force: true });
    fs.mkdirSync(platformDir, { recursive: true });
    run = publishScreenshots(platformDir, results);
    fs.writeFileSync(path.join(platformDir, 'results.json'), JSON.stringify(run, null, 2));
  } else {
    run = readJson(path.join(platformDir, 'results.json'));
    if (!run) throw new Error(`No saved results in ${platformDir} — run the tests first.`);
  }

  const scope = runScope(run);
  const platform = PLATFORMS[platformId];
  fs.writeFileSync(
    path.join(platformDir, 'index.html'),
    generateReport({
      platformId,
      platform,
      suites: run.suites,
      totals: run.totals,
      durationMs: run.durationMs,
      lastRun: run.endedAt,
      scope,
    }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(platformDir, 'meta.json'),
    JSON.stringify(
      {
        platform: platformId,
        scope,
        totals: run.totals,
        durationMs: run.durationMs,
        lastRun: run.endedAt,
        suites: run.suites.map((s) => ({ id: s.id, name: s.name, status: s.status, totals: s.totals })),
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
