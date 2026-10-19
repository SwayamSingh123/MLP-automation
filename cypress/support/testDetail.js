// Per-test details for the report (lead, cleanup, submission, API checks, SEO
// rows, link results). Kept on globalThis because Cypress bundles support files
// and specs separately — a module-level variable would exist twice.
//
// Specs and commands write through `testDetail()`; afterEach sends it to Node,
// where it is masked and merged with Cypress's own pass/fail/skip results.

const KEY = '__testDetail';

globalThis.testDetail = () => globalThis[KEY];

/** Merge fields into the current test's detail (runs in command order). */
Cypress.Commands.add('recordDetail', (patch) => {
  Object.assign(globalThis[KEY], patch);
});

/** Skip the current test, recording why so the report can say so. */
globalThis.skipTest = (ctx, reason) => {
  globalThis[KEY].skipReason = reason;
  ctx.skip();
};

beforeEach(() => {
  globalThis[KEY] = {};
});

afterEach(function () {
  const detail = globalThis[KEY];
  if (!detail || !Object.keys(detail).length) return;
  const key = `${Cypress.spec.relative.replace(/\\/g, '/')}::${this.currentTest.titlePath().join(' > ')}`;
  cy.task('recordTestDetail', { key, detail }, { log: false });
});
