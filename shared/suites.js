/**
 * Single source of truth for the two platforms and the test suites.
 * Used by cypress.config.js, the reporter, the CLI runner and CI.
 */

const PLATFORMS = {
  test: {
    label: 'Test platform',
    site: 'https://testprogram.kraftshala.com',
    api: 'https://testservice.kraftshala.com',
    live: false,
  },
  main: {
    label: 'Main platform (live)',
    // program.kraftshala.com 301-redirects here; using the final host avoids a
    // cross-origin hop in the middle of cy.visit.
    site: 'https://www.kraftshala.com',
    api: 'https://service.kraftshala.com',
    live: true,
  },
};

// Order here is the run order and the order in the report.
const SUITES = [
  {
    id: 'mlp',
    name: 'MLP — Marketing Launchpad',
    specs: [
      'cypress/e2e/mlp/mlpLeadForm.cy.js',
      'cypress/e2e/mlp/downloadBrochure.cy.js',
      'cypress/e2e/mlp/downloadSyllabus.cy.js',
    ],
  },
  {
    id: 'alm',
    name: 'ALM — AI-Led Marketing',
    specs: ['cypress/e2e/alm/almLeadForm.cy.js', 'cypress/e2e/alm/almDownloadProspectus.cy.js'],
  },
  { id: 'basl', name: 'BASL — Sales & Marketing', specs: ['cypress/e2e/smbl/smblLeadForm.cy.js'] },
  { id: 'kslive', name: 'KS Live — Event registration', specs: ['cypress/e2e/kslive/ksLiveRegistration.cy.js'] },
  { id: 'callback', name: 'Request a Callback', specs: ['cypress/e2e/callback/requestCallback.cy.js'] },
  { id: 'seo', name: 'SEO checklist', specs: ['cypress/e2e/seo/seoChecklist.cy.js'] },
  { id: 'links', name: 'Broken link checker', specs: ['cypress/e2e/links/brokenLinkChecker.cy.js'] },
];

function suiteById(id) {
  return SUITES.find((s) => s.id === id) || null;
}

/** Suite that owns a spec path (absolute or relative, any slash style). */
function suiteForSpec(specPath) {
  const p = String(specPath || '').replace(/\\/g, '/');
  return SUITES.find((s) => s.specs.some((spec) => p.endsWith(spec))) || null;
}

/** Comma-separated spec list for `cypress run --spec`; 'all' or '' means every suite. */
function specsFor(suiteIds) {
  const ids = String(suiteIds || 'all')
    .split(/[,+\s]+/)
    .filter(Boolean);
  const selected = ids.includes('all') ? SUITES : ids.map((id) => {
    const suite = suiteById(id);
    if (!suite) throw new Error(`Unknown suite "${id}". Use: all, ${SUITES.map((s) => s.id).join(', ')}`);
    return suite;
  });
  return selected.flatMap((s) => s.specs).join(',');
}

module.exports = { PLATFORMS, SUITES, suiteById, suiteForSpec, specsFor };
