/**
 * Turns Cypress's own after:run results into the report model.
 * Statuses come straight from Cypress — nothing is parsed out of logs.
 *
 *   passed            -> PASS
 *   failed            -> FAIL
 *   pending / skipped -> SKIPPED (it.skip, this.skip(), or skipped after a hook failure)
 */
const path = require('path');
const { SUITES, suiteForSpec } = require('../shared/suites');
const { maskText } = require('../shared/mask');

const STATE = { passed: 'passed', failed: 'failed', pending: 'skipped', skipped: 'skipped' };

function detailKey(specRelative, titlePath) {
  return `${String(specRelative).replace(/\\/g, '/')}::${titlePath.join(' > ')}`;
}

function normalise(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Cypress names failure screenshots "<describe> -- <test> (failed).png". */
function screenshotsFor(run, titlePath) {
  const testName = normalise(titlePath[titlePath.length - 1]);
  return (run.screenshots || [])
    .map((s) => s.path)
    .filter((p) => p && normalise(path.basename(p)).includes(testName));
}

/** The error message without its stack trace. */
function errorMessage(displayError) {
  const text = String(displayError || 'Failed without an error message');
  return text.split(/\n\s+at /)[0].trim();
}

function emptyTotals() {
  return { tests: 0, passed: 0, failed: 0, skipped: 0 };
}

function collectResults({ runResults, details, platformId, platform, startedAt, endedAt, maskLeads = false }) {
  const mask = maskLeads ? maskText : (s) => s;
  const suites = new Map();

  for (const run of runResults.runs) {
    const specRel = String(run.spec.relative).replace(/\\/g, '/');
    const suiteDef = suiteForSpec(specRel) || { id: 'other', name: 'Other specs' };
    if (!suites.has(suiteDef.id)) {
      suites.set(suiteDef.id, {
        id: suiteDef.id,
        name: suiteDef.name,
        durationMs: 0,
        totals: emptyTotals(),
        tests: [],
      });
    }
    const suite = suites.get(suiteDef.id);
    suite.durationMs += (run.stats && run.stats.duration) || 0;

    const tests = run.tests || [];
    // A spec that crashed before running any test still has to show up as a failure.
    if (run.error && tests.length === 0) {
      suite.tests.push({
        title: `${path.basename(specRel)} failed to run`,
        spec: specRel,
        state: 'failed',
        durationMs: 0,
        error: mask(run.error),
        screenshots: [],
        detail: null,
      });
      continue;
    }

    for (const t of tests) {
      const titlePath = Array.isArray(t.title) ? t.title : [String(t.title)];
      const state = STATE[t.state] || 'failed';
      suite.tests.push({
        title: titlePath[titlePath.length - 1],
        group: titlePath.slice(0, -1).join(' › '),
        spec: specRel,
        state,
        durationMs: t.duration || 0,
        error: state === 'failed' ? mask(errorMessage(t.displayError)) : null,
        screenshots: state === 'failed' ? screenshotsFor(run, titlePath) : [],
        detail: details[detailKey(specRel, titlePath)] || null,
      });
    }
  }

  const order = SUITES.map((s) => s.id);
  const suiteList = [...suites.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const totals = emptyTotals();
  for (const suite of suiteList) {
    for (const test of suite.tests) {
      suite.totals.tests += 1;
      suite.totals[test.state] += 1;
    }
    for (const k of Object.keys(totals)) totals[k] += suite.totals[k];
    suite.status = suite.totals.failed > 0 ? 'failed' : suite.totals.passed > 0 ? 'passed' : 'skipped';
  }

  return {
    platform: platformId,
    platformLabel: platform.label,
    site: platform.site,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: runResults.totalDuration || endedAt - startedAt,
    maskLeads,
    totals,
    suites: suiteList,
  };
}

module.exports = { collectResults, detailKey };
