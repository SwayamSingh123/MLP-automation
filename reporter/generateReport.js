/**
 * The dashboard for one platform. Pure function: model -> HTML string.
 * Re-render from saved JSON without re-running the browser:
 *   node reporter/buildSite.js cypress/reports/site test
 */
const { esc, fmtDuration, fmtTime, badge, shell } = require('./theme');

const MARK = { true: ['ok', '✓'], false: ['bad', '✕'], null: ['skip', '–'] };

function mark(ok) {
  const [cls, icon] = MARK[ok === true ? 'true' : ok === false ? 'false' : 'null'];
  return `<span class="mark ${cls}" aria-hidden="true">${icon}</span>`;
}

function kpis(totals, durationMs) {
  const rate = totals.tests ? Math.round((totals.passed / totals.tests) * 100) : 0;
  const tile = (cls, value, label) => `<div class="kpi ${cls}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  return `<section class="kpis" aria-label="Totals">
    ${tile('gold', totals.tests, 'Total tests')}
    ${tile('ok', totals.passed, 'Passed')}
    ${tile('bad', totals.failed, 'Failed')}
    ${tile('skip', totals.skipped, 'Skipped')}
    ${tile('', `${rate}%`, 'Pass rate')}
    ${tile('', fmtDuration(durationMs), 'Execution time')}
  </section>`;
}

function verdict(totals) {
  if (!totals.tests) return '<div class="verdict skip">No results yet for this platform.</div>';
  if (totals.failed) {
    return `<div class="verdict bad">${totals.failed} test${totals.failed === 1 ? '' : 's'} failed — details below.</div>`;
  }
  if (totals.skipped) return `<div class="verdict skip">No failures. ${totals.skipped} test(s) were skipped.</div>`;
  return '<div class="verdict ok">Every test passed.</div>';
}

function suiteTable(suites) {
  const rows = suites
    .map(
      (s) => `<tr>
        <td><a href="#suite-${esc(s.id)}"><b>${esc(s.name)}</b></a></td>
        <td>${badge(s.status)}</td>
        <td class="num">${s.totals.tests}</td>
        <td class="num">${s.totals.passed}</td>
        <td class="num">${s.totals.failed}</td>
        <td class="num">${s.totals.skipped}</td>
        <td class="num">${fmtDuration(s.durationMs)}</td>
        <td>${esc(fmtTime(s.ranAt))}</td>
      </tr>`
    )
    .join('');
  return `<section class="card"><h2 style="margin-bottom:12px">Test suites</h2><div class="scroll"><table>
    <thead><tr><th>Suite</th><th>Status</th><th class="num">Tests</th><th class="num">Passed</th>
    <th class="num">Failed</th><th class="num">Skipped</th><th class="num">Duration</th><th>Last run</th></tr></thead>
    <tbody>${rows}</tbody></table></div></section>`;
}

// ── Detail renderers ───────────────────────────────────────────────────────

function leadDetail(d, state) {
  const lead = d.lead || {};
  const cleanup = (d.cleanup || []).length
    ? `<ul class="checks">${d.cleanup
        .map(
          (c) => `<li>${mark(c.ok)}<span><b>${esc(c.target)}</b> <span class="mono">${esc(c.identifier)}</span>
            — HTTP ${esc(c.status || 'n/a')} · ${esc(c.message)}</span></li>`
        )
        .join('')}</ul>`
    : `<span class="muted">${esc(d.cleanupNote || 'Not required for this test.')}</span>`;
  const api = (d.api || []).length
    ? `<ul class="checks">${d.api
        .map(
          (a) => `<li>${mark(a.ok)}<span><b>${esc(a.label)}</b> — ${
            a.status ? `HTTP ${esc(a.status)}` : 'not called'
          }${a.message ? ` · ${esc(a.message)}` : ''}</span></li>`
        )
        .join('')}</ul>`
    : '<span class="muted">No API verification for this test.</span>';
  const submission = d.submission
    ? `${mark(d.submission.ok)} ${esc(d.submission.outcome)}`
    : state === 'failed'
      ? `${mark(false)} Did not complete — see the failure reason below.`
      : '<span class="muted">Not run.</span>';

  return `<dl class="kv">
    <dt>Form</dt><dd>${esc(d.form)}</dd>
    <dt>Page</dt><dd class="mono">${esc(d.page)}</dd>
    <dt>Lead</dt><dd>${esc(lead.name || '—')} · <span class="mono">${esc(lead.email || '—')}</span> · <span class="mono">${esc(
      lead.phone || '—'
    )}</span></dd>
    <dt>Expected outcome</dt><dd>${esc(d.expectation)}</dd>
    <dt>Cleanup</dt><dd>${cleanup}</dd>
    <dt>Submission result</dt><dd>${submission}</dd>
    <dt>API verification</dt><dd>${api}</dd>
    ${(d.notes || []).length ? `<dt>Notes</dt><dd>${d.notes.map(esc).join('<br>')}</dd>` : ''}
  </dl>`;
}

const SEO_STATE = { pass: 'passed', fail: 'failed', skipped: 'skipped', warning: 'skipped' };

function seoDetail(d) {
  const rows = (d.checks || [])
    .map((c) => {
      const label = c.status === 'warning' ? '<span class="badge skip"><b>!</b>WARNING</span>' : badge(SEO_STATE[c.status] || 'failed');
      return `<tr><td>${label}</td><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.details)}</span></td></tr>`;
    })
    .join('');
  return `<div class="scroll"><table><thead><tr><th>Status</th><th>Check</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function linksDetail(d) {
  const c = d.counts || {};
  const head = `<dl class="kv">
    <dt>Page</dt><dd class="mono">${esc(d.url)} — HTTP ${esc(d.pageStatus || 'n/a')}${d.pageError ? ` (${esc(d.pageError)})` : ''}</dd>
    <dt>URLs checked</dt><dd>${esc(c.total || 0)} (links ${esc(c.a || 0)}, images ${esc(c.img || 0)}, css/link ${esc(
      c.link || 0
    )}, scripts ${esc(c.script || 0)}, media ${esc(c.media || 0)})</dd>
    <dt>Results</dt><dd>${esc(c.working || 0)} working · ${esc(c.redirect || 0)} redirects · ${esc(
      c.forbidden || 0
    )} blocked for bots (not counted as broken) · <b>${esc((d.broken || []).length)} broken</b></dd>
  </dl>`;
  if (!(d.broken || []).length) return head;
  const rows = d.broken
    .slice(0, 100)
    .map(
      (b) => `<tr><td class="num">${esc(b.status || '—')}</td><td>${esc(b.type)}</td>
        <td class="mono" style="word-break:break-all">${esc(b.url)}</td><td>${esc(b.text || b.error || '')}</td></tr>`
    )
    .join('');
  return `${head}<div class="scroll"><table><thead><tr><th class="num">HTTP</th><th>Type</th><th>URL</th><th>Text / error</th></tr></thead>
    <tbody>${rows}</tbody></table></div>${d.broken.length > 100 ? `<p class="muted">…and ${d.broken.length - 100} more.</p>` : ''}`;
}

function testRow(t) {
  const d = t.detail;
  const body = [];
  if (d && d.kind === 'lead') body.push(leadDetail(d, t.state));
  if (d && d.kind === 'seo') body.push(seoDetail(d));
  if (d && d.kind === 'links') body.push(linksDetail(d));
  if (d && d.kind !== 'lead' && (d.notes || []).length) {
    body.push(`<div><h3>Notes</h3>${d.notes.map(esc).join('<br>')}</div>`);
  }
  if (t.state === 'skipped' && d && d.skipReason) {
    body.push(`<div><h3>Why it was skipped</h3>${esc(d.skipReason)}</div>`);
  }
  if (t.error) body.push(`<div><h3>Failure reason</h3><pre class="err">${esc(t.error.slice(0, 2500))}</pre></div>`);
  if ((t.screenshots || []).length) {
    body.push(
      `<div><h3>Screenshots</h3><div class="shots">${t.screenshots
        .map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener"><img src="${esc(s)}" alt="Screenshot at failure" loading="lazy"></a>`)
        .join('')}</div></div>`
    );
  }
  if (!body.length) body.push('<p class="muted" style="margin:12px 0 0">No further details recorded.</p>');

  return `<details class="test"${t.state === 'failed' ? ' open' : ''}>
    <summary>${badge(t.state)}<span class="t-title">${esc(t.title)}${
      t.group ? `<span class="t-group">${esc(t.group)}</span>` : ''
    }</span><span class="t-dur">${fmtDuration(t.durationMs)}</span></summary>
    <div class="t-body">${body.join('')}</div>
  </details>`;
}

function suiteSection(s) {
  return `<section class="card" id="suite-${esc(s.id)}">
    <div class="suite-head"><h2>${esc(s.name)}</h2>
      <span>${badge(s.status)} <small>${s.totals.passed} passed · ${s.totals.failed} failed · ${s.totals.skipped} skipped · ${fmtDuration(
        s.durationMs
      )} · ${esc(fmtTime(s.ranAt))}</small></span></div>
    ${s.tests.map(testRow).join('')}
  </section>`;
}

function generateReport({ platformId, platform, suites, totals, durationMs, lastRun }) {
  const other = platformId === 'test' ? 'main' : 'test';
  return shell(
    `QA Report — ${platform.label}`,
    `<header><div class="wrap">
      <a class="brandmark" href="../"><i></i>KRAFTSHALA</a>
      <h1>QA Automation — ${esc(platform.label)}</h1>
      <p>${esc(platform.site.replace(/^https?:\/\//, ''))} · Last run ${esc(fmtTime(lastRun))}</p>
      <nav><a href="../">All reports</a><a href="../${other}/">${other === 'main' ? 'Main' : 'Test'} platform report</a></nav>
    </div></header>
    <main>
      ${kpis(totals, durationMs)}
      ${verdict(totals)}
      ${suites.length ? suiteTable(suites) : ''}
      ${suites.map(suiteSection).join('')}
    </main>
    <footer>Statuses come directly from Cypress — passed, failed, or skipped (not run).
    Each suite shows its most recent run.</footer>`
  );
}

module.exports = { generateReport };
