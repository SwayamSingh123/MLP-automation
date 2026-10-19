/**
 * After a CI run: writes the GitHub job summary and, if GCHAT_WEBHOOK_URL is
 * set, posts a short message to Google Chat linking to the published report.
 *
 *   node scripts/summarize.js cypress/reports/results-<platform>.json
 */
const fs = require('fs');

const results = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { REPORT_URL = '', RUN_URL = '', GCHAT_WEBHOOK_URL = '', GITHUB_STEP_SUMMARY = '' } = process.env;

const t = results.totals;
const minutes = Math.round(results.durationMs / 6000) / 10;
const icon = (s) => (s === 'failed' ? '❌' : s === 'passed' ? '✅' : '⏭️');
const suiteLines = results.suites.map(
  (s) => `${icon(s.status)} ${s.name} — ${s.totals.passed} passed, ${s.totals.failed} failed, ${s.totals.skipped} skipped`
);
const failedTests = results.suites.flatMap((s) =>
  s.tests.filter((x) => x.state === 'failed').map((x) => `• ${s.name}: ${x.title}`)
);

const markdown = [
  `## QA report — ${results.platformLabel}`,
  `**${t.passed} passed · ${t.failed} failed · ${t.skipped} skipped** of ${t.tests} tests in ${minutes} min`,
  '',
  ...suiteLines.map((l) => `- ${l}`),
  '',
  failedTests.length ? `### Failed tests\n${failedTests.join('\n')}\n` : '',
  REPORT_URL ? `Report: ${REPORT_URL}` : '',
].join('\n');

if (GITHUB_STEP_SUMMARY) fs.appendFileSync(GITHUB_STEP_SUMMARY, `${markdown}\n`);
console.log(markdown);

if (GCHAT_WEBHOOK_URL) {
  const text = [
    `*QA report — ${results.platformLabel}*`,
    `${t.failed ? '❌' : '✅'} ${t.passed} passed · ${t.failed} failed · ${t.skipped} skipped (${minutes} min)`,
    '',
    ...suiteLines,
    failedTests.length ? `\n*Failed*\n${failedTests.slice(0, 20).join('\n')}` : '',
    '',
    REPORT_URL ? `Report: ${REPORT_URL}` : '',
    RUN_URL ? `Run log: ${RUN_URL}` : '',
  ].join('\n');
  fetch(GCHAT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text }),
  })
    .then((res) => {
      console.log(`Google Chat: HTTP ${res.status}`);
      if (!res.ok) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(`Google Chat post failed: ${err.message}`);
      process.exitCode = 1;
    });
}
