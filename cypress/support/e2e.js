// Order matters: leads.js adds the API trace in afterEach before testDetail.js sends it.
import './leads';
import './testDetail';
import './commands';
import './downloadCommands';

// Uncaught exceptions from the site's own code fail the test. Errors thrown by
// third-party scripts (analytics, chat widgets, pixels — cross-origin "Script
// error." or stacks with no frame from the site) are not the site's lead flow
// failing, so they are allowed — but every one is written into the report.
Cypress.on('uncaught:exception', (err) => {
  const siteHost = new URL(Cypress.config('baseUrl')).host;
  const stack = String(err.stack || '');
  const message = String(err.message || err);
  // Cypress wraps the app's message: keep the quoted '> …' line when present.
  const quoted = message.split('\n').find((l) => l.trim().startsWith('>'));
  const short = (quoted ? quoted.replace(/^\s*>\s*/, '') : message.split('\n')[0]).slice(0, 200);
  // "Script error." is a cross-origin script with its details hidden by the browser;
  // "ResizeObserver loop …" is a benign browser notice. Neither is the site's own code.
  const benign = /^Script error\.?$/i.test(short.trim()) || /ResizeObserver loop/i.test(message);
  if (stack.includes(siteHost) && !benign) return true;
  const detail = globalThis.testDetail && globalThis.testDetail();
  if (detail) {
    detail.notes = detail.notes || [];
    detail.notes.push(`Ignored ${benign ? 'cross-origin/benign browser' : 'third-party script'} error: ${short}`);
  }
  return false;
});
