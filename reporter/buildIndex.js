/** Landing page listing both platforms with their headline numbers. */
const fs = require('fs');
const path = require('path');
const { PLATFORMS } = require('../shared/suites');
const { esc, fmtDuration, fmtTime, badge, shell } = require('./theme');

function readMeta(siteDir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(siteDir, id, 'meta.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function card(id, platform, meta) {
  const host = platform.site.replace(/^https?:\/\//, '');
  if (!meta || !meta.totals.tests) {
    return `<div class="card"><h2>${esc(platform.label)}</h2><p class="muted mono">${esc(host)}</p>
      <p class="muted">No report yet — start a run for this platform.</p></div>`;
  }
  const t = meta.totals;
  const status = t.failed ? 'failed' : t.passed ? 'passed' : 'skipped';
  const suites = meta.suites
    .map((s) => `<li>${badge(s.status)} <span>${esc(s.name)} <span class="muted">— ${s.totals.passed}/${s.totals.tests} passed</span></span></li>`)
    .join('');
  return `<a class="card" href="${esc(id)}/" style="text-decoration:none;display:block">
    <div class="suite-head"><h2>${esc(platform.label)}</h2>${badge(status)}</div>
    <p class="muted mono" style="margin:-6px 0 12px">${esc(host)}</p>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi gold"><b>${t.tests}</b><span>Total</span></div>
      <div class="kpi ok"><b>${t.passed}</b><span>Passed</span></div>
      <div class="kpi bad"><b>${t.failed}</b><span>Failed</span></div>
      <div class="kpi skip"><b>${t.skipped}</b><span>Skipped</span></div>
    </div>
    <ul class="checks" style="margin-top:14px">${suites}</ul>
    <p class="muted" style="margin:12px 0 0">Latest run: ${esc(meta.scope ? meta.scope.label : '')} · ${esc(fmtTime(meta.lastRun))} · ${fmtDuration(meta.durationMs)}</p>
  </a>`;
}

function buildIndex(siteDir) {
  const cards = Object.entries(PLATFORMS)
    .map(([id, p]) => card(id, p, readMeta(siteDir, id)))
    .join('');
  return shell(
    'QA Reports — Kraftshala',
    `<header><div class="wrap"><span class="brandmark"><i></i>KRAFTSHALA</span>
      <h1>QA Automation Reports</h1>
      <p>Lead forms, downloads, KS Live, callback, SEO and broken links — latest run per platform</p>
    </div></header>
    <main>${cards}</main>`
  );
}

module.exports = { buildIndex };
