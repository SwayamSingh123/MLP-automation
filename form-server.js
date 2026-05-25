const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || process.env.MLP_FORM_PORT || 4000;
const MAIN_PLATFORM_BASE_URL = 'https://program.kraftshala.com/';
const TEST_PLATFORM_BASE_URL = 'https://testprogram.kraftshala.com/';

const TEST_EMAIL_DELETE_BASE =
  process.env.MLP_EMAIL_DELETE_BASE_TEST ||
  process.env.MLP_EMAIL_DELETE_BASE ||
  'https://testservice.kraftshala.com/lead/remove-lead/mlp/';
const TEST_PHONE_DELETE_BASE =
  process.env.MLP_PHONE_DELETE_BASE_TEST ||
  process.env.MLP_PHONE_DELETE_BASE ||
  'https://testservice.kraftshala.com/otp-validation/removeNumber/';
const MAIN_EMAIL_DELETE_BASE =
  process.env.MLP_EMAIL_DELETE_BASE_MAIN ||
  'https://service.kraftshala.com/lead/remove-lead/mlp/';
const MAIN_PHONE_DELETE_BASE =
  process.env.MLP_PHONE_DELETE_BASE_MAIN ||
  'https://service.kraftshala.com/otp-validation/removeNumber/';

const FIXTURE_PATH_MLP = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'mlp',
  'mlpTestData.json'
);
const FIXTURE_PATH_ALM = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'alm',
  'almTestData.json'
);
const FIXTURE_PATH_CALLBACK = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'callback',
  'callbackTestData.json'
);
const FIXTURE_PATH_KSLIVE = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'kslive',
  'ksLiveTestData.json'
);
const FIXTURE_PATH_SMBL = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'smbl',
  'smblTestData.json'
);

// SMBL-specific lead-delete endpoints. Shares phone delete with MLP (otp-validation
// is page-agnostic). Email delete path uses `/pgp/` (same as ALM — both live on
// the PGP service). Update if SMBL has a distinct lead-delete URL.
const SMBL_TEST_EMAIL_DELETE_BASE =
  process.env.SMBL_EMAIL_DELETE_BASE_TEST ||
  'https://testservice.kraftshala.com/lead/remove-lead/pgp/';
const SMBL_MAIN_EMAIL_DELETE_BASE =
  process.env.SMBL_EMAIL_DELETE_BASE_MAIN ||
  'https://service.kraftshala.com/lead/remove-lead/pgp/';
// Backwards-compat alias for any code path still referencing the old name.
const FIXTURE_PATH = FIXTURE_PATH_MLP;

// ALM-specific lead-delete endpoints. Phone delete is shared with MLP (the
// otp-validation service is page-agnostic); email delete swaps `/mlp/` → `/pgp/`
// (the URL slug `pgp` is the actual product API path — page is internally ALM).
const ALM_TEST_EMAIL_DELETE_BASE =
  process.env.ALM_EMAIL_DELETE_BASE_TEST ||
  'https://testservice.kraftshala.com/lead/remove-lead/pgp/';
const ALM_MAIN_EMAIL_DELETE_BASE =
  process.env.ALM_EMAIL_DELETE_BASE_MAIN ||
  'https://service.kraftshala.com/lead/remove-lead/pgp/';

// Each "Run tests" click is one of two modes — picked from req.body.mode.
// MLP (default) runs the lead-form + brochure + syllabus bundle (9 tests).
// ALM runs the lead-form + prospectus bundle (8 tests) with pixel disabled.
const MODES = {
  mlp: {
    label: 'MLP',
    fixturePath: FIXTURE_PATH_MLP,
    specs: [
      'cypress/e2e/mlp/mlpLeadForm.cy.js',
      'cypress/e2e/mlp/downloadBrochure.cy.js',
      'cypress/e2e/mlp/downloadSyllabus.cy.js',
    ],
    expectedTestCount: 9,
    pixelEnabled: true,
    deleteBases: {
      test: { email: TEST_EMAIL_DELETE_BASE, phone: TEST_PHONE_DELETE_BASE },
      main: { email: MAIN_EMAIL_DELETE_BASE, phone: MAIN_PHONE_DELETE_BASE },
    },
  },
  alm: {
    label: 'ALM',
    fixturePath: FIXTURE_PATH_ALM,
    specs: [
      'cypress/e2e/alm/almLeadForm.cy.js',
      'cypress/e2e/alm/almDownloadProspectus.cy.js',
    ],
    expectedTestCount: 8,
    pixelEnabled: false,
    deleteBases: {
      test: { email: ALM_TEST_EMAIL_DELETE_BASE, phone: TEST_PHONE_DELETE_BASE },
      main: { email: ALM_MAIN_EMAIL_DELETE_BASE, phone: MAIN_PHONE_DELETE_BASE },
    },
  },
  // SEO checklist — no lead deletion, no fixture write, no pixel capture.
  // Each test in the spec is one page; results are written to
  // cypress/reports/seo-results.json and surfaced via parsed.seoResults.
  seo: {
    label: 'SEO',
    fixturePath: null, // no fixture write
    specs: ['cypress/e2e/seo/seoChecklist.cy.js'],
    expectedTestCount: 7, // 7 pages in seo-page-data.json
    pixelEnabled: false,
    isSeo: true,
    deleteBases: null, // no leads to clean
  },
  // Request CallBack — single test that reads name/email/phone directly from
  // the MLP fixture file (cypress/fixtures/mlp/mlpTestData.json). No inputs
  // required on the UI, no separate fixture write, no lead deletion.
  callback: {
    label: 'CALLBACK',
    fixturePath: null,
    specs: ['cypress/e2e/callback/requestCallback.cy.js'],
    expectedTestCount: 1,
    pixelEnabled: false,
    isCallback: true,
    deleteBases: null,
  },
  // KS Live — 4 tests (3 user-input scenarios + 1 MLP-fixture scenario), each
  // registers on both the 1st and 2nd KS Live event cards. No lead deletion
  // (KS Live registrations are event-bound, not on the MLP /lead/create endpoint).
  kslive: {
    label: 'KSLIVE',
    fixturePath: FIXTURE_PATH_KSLIVE,
    specs: ['cypress/e2e/kslive/ksLiveRegistration.cy.js'],
    expectedTestCount: 4,
    pixelEnabled: false,
    isKslive: true,
    deleteBases: null,
  },
  // SMBL (Sales & Marketing Business Leaders) — 7 edge cases mirroring MLP,
  // success URL is /pgp/learn-sales-and-marketing/thank-you/?id=<uuid>.
  smbl: {
    label: 'SMBL',
    fixturePath: FIXTURE_PATH_SMBL,
    specs: ['cypress/e2e/smbl/smblLeadForm.cy.js'],
    expectedTestCount: 7,
    pixelEnabled: false,
    isSmbl: true,
    deleteBases: {
      test: { email: SMBL_TEST_EMAIL_DELETE_BASE, phone: TEST_PHONE_DELETE_BASE },
      main: { email: SMBL_MAIN_EMAIL_DELETE_BASE, phone: MAIN_PHONE_DELETE_BASE },
    },
  },
};

function resolveMode(input) {
  const m = String(input || '').toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(MODES, m) ? m : 'mlp';
}
const API_DATA_FILE = path.join(
  __dirname,
  'cypress',
  'reports',
  'api-monitor-data.json'
);
const PIXEL_DATA_FILE = path.join(
  __dirname,
  'cypress',
  'reports',
  'pixel-monitor-data.json'
);
const SEO_RESULTS_FILE = path.join(
  __dirname,
  'cypress',
  'reports',
  'seo-results.json'
);

function readJsonFileSafe(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_err) {
    return [];
  }
}

// API monitor entries are written one-per-test by cypress/support/apiMonitor.js.
// Returns a Map keyed on the Cypress test title so we can attach per-test data
// to the parsed dashboard tests list (which is also keyed by test title).
function readApiCallsByTest() {
  const data = readJsonFileSafe(API_DATA_FILE);
  const byTitle = new Map();
  for (const entry of Array.isArray(data) ? data : []) {
    if (!entry || !entry.testTitle) continue;
    byTitle.set(entry.testTitle, entry.apiCalls || []);
  }
  return byTitle;
}

// Aggregate every Meta Pixel fire into a per-(pixelId, eventName) summary —
// pixel-monitor only captures during the FIRST test of a run, so the aggregate
// is across that single capture window. Excludes blank-id POST beacons.
function aggregatePixelEvents() {
  const data = readJsonFileSafe(PIXEL_DATA_FILE);
  const byKey = new Map();
  for (const entry of Array.isArray(data) ? data : []) {
    for (const call of entry.pixelCalls || []) {
      const pixelId = call.pixelId || '';
      const eventName = call.eventName || '';
      if (!pixelId && !eventName) continue;
      const key = pixelId + '|' + eventName;
      if (!byKey.has(key)) {
        byKey.set(key, { pixelId, eventName, count: 0, sourceUrls: [] });
      }
      const item = byKey.get(key);
      item.count += 1;
      if (call.sourceUrl && !item.sourceUrls.includes(call.sourceUrl)) {
        item.sourceUrls.push(call.sourceUrl);
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.pixelId !== b.pixelId) return a.pixelId.localeCompare(b.pixelId);
    return a.eventName.localeCompare(b.eventName);
  });
}

// Mutates `parsed` to attach `apiCalls` to each test entry (keyed by name)
// and a top-level `pixelEvents` array. Called once at the end of a Cypress
// run, before the SSE 'complete' event is emitted.
function attachMonitoringData(parsed) {
  const apiByTest = readApiCallsByTest();
  for (const t of parsed.tests || []) {
    t.apiCalls = apiByTest.get(t.name) || [];
  }
  parsed.pixelEvents = aggregatePixelEvents();
  return parsed;
}

// SEO checklist results — produced by cypress/e2e/seo/seoChecklist.cy.js via
// cy.writeFile at the end of the run. Attached to the SSE 'complete' payload
// only when the SEO mode was selected (otherwise field is omitted).
function readSeoResults() {
  return readJsonFileSafe(SEO_RESULTS_FILE);
}
function attachSeoResults(parsed) {
  parsed.seoResults = readSeoResults();
  return parsed;
}
const GITHUB_OWNER = process.env.GITHUB_OWNER || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_WORKFLOW_FILE = process.env.GITHUB_WORKFLOW_FILE || 'mlp-run.yml';

// Each MODES key maps to its own workflow file in .github/workflows/. When a
// Run button is clicked on the dashboard, the matching workflow gets dispatched
// (instead of always dispatching GITHUB_WORKFLOW_FILE for every mode).
const WORKFLOW_FILE_BY_MODE = {
  mlp:      'mlp-run.yml',
  alm:      'alm-run.yml',
  smbl:     'smbl-run.yml',
  kslive:   'kslive-run.yml',
  callback: 'callback-run.yml',
  seo:      'seo-run.yml',
};

function resolveWorkflowFile(mode) {
  return WORKFLOW_FILE_BY_MODE[mode] || GITHUB_WORKFLOW_FILE;
}

function buildWorkflowRunsUrl(workflowFile) {
  const file = workflowFile || GITHUB_WORKFLOW_FILE;
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${file}`;
}

// GitHub returns 422 if we send an `inputs` key the workflow doesn't declare,
// so each mode gets ONLY the inputs its workflow expects.
//   mlp / alm / smbl / kslive → full 5-field lead form set
//   callback                  → name + baseEmail + basePhone only
//   seo                       → platform only (no lead fields)
function buildWorkflowInputs(mode, args) {
  const { platform, name, baseEmail, basePhone, differentEmail, differentPhone, requestId } = args;
  if (mode === 'seo') return { platform, requestId };
  if (mode === 'callback') return { platform, name, baseEmail, basePhone, requestId };
  return { platform, name, baseEmail, basePhone, differentEmail, differentPhone, requestId };
}
const GITHUB_REF = process.env.GITHUB_REF || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const workflowRunsUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}`;
const githubRunJobs = new Map();
const localRuns = new Map();

app.use(express.json());

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'form.html'));
});

function uniqueNonEmpty(values) {
  return Array.from(
    new Set(
      values
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .filter((v) => v)
    )
  );
}

async function deleteLeads(emails, phones, deleteBases) {
  const emailList = uniqueNonEmpty(emails);
  const phoneList = uniqueNonEmpty(phones);
  const { emailDeleteBase, phoneDeleteBase } = deleteBases;

  for (const email of emailList) {
    const url = emailDeleteBase + encodeURIComponent(email);
    try {
      // API is expected to be called as GET with no body
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`Email delete failed for ${email}: ${resp.status}`);
      }
    } catch (err) {
      console.error(`Error deleting email ${email}:`, err.message);
    }
  }

  for (const phone of phoneList) {
    const url = phoneDeleteBase + encodeURIComponent(phone);
    try {
      // API is expected to be called as GET with no body
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`Phone delete failed for ${phone}: ${resp.status}`);
      }
    } catch (err) {
      console.error(`Error deleting phone ${phone}:`, err.message);
    }
  }
}

function buildFixtureFromForm(body) {
  const {
    name,
    baseEmail,
    basePhone,
    differentEmail,
    differentPhone,
  } = body;

  const fixture = {
    name: name || 'Test User',
    // Base pair: used for new lead + existing lead flows (same credentials).
    existingEmail: baseEmail,
    existingPhone: basePhone,
    newEmail: baseEmail,
    newPhone: basePhone,
    // Base email + different phone — app blocks OTP / no screening URL.
    sameEmailDifferentPhone: {
      email: baseEmail,
      phone: differentPhone,
    },
    // Base phone + different email — full success path with screening URL.
    samePhoneDifferentEmail: {
      email: differentEmail,
      phone: basePhone,
    },
    extraValidEmails: [],
    extraValidPhones: [],
    invalidEmails: [
      'plainaddress',
      'missingatsign.com',
      'missing-domain@',
      'user@domain',
      'user@.com',
    ],
    invalidPhones: ['', '12345', 'abcdefghij', '9999999999999', '123-456-7890'],
    otp: '159753',
  };

  return fixture;
}

function shouldUseGitHubActionsRunner() {
  return Boolean(GITHUB_OWNER && GITHUB_REPO && GITHUB_TOKEN);
}

function createRequestId() {
  return `mlp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function dispatchGitHubWorkflow({
  mode,
  platform,
  name,
  baseEmail,
  basePhone,
  differentEmail,
  differentPhone,
  requestId,
}) {
  const workflowFile = resolveWorkflowFile(mode);
  const dispatchUrl = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(GITHUB_REPO)}/actions/workflows/${encodeURIComponent(
    workflowFile
  )}/dispatches`;
  const inputs = buildWorkflowInputs(mode, {
    platform, name, baseEmail, basePhone, differentEmail, differentPhone, requestId,
  });
  console.log(`[RUN] Dispatching ${workflowFile} (mode=${mode}) for request ${requestId}`);
  const resp = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'mlp-form-server',
    },
    body: JSON.stringify({ ref: GITHUB_REF, inputs }),
  });
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error(`GitHub workflow dispatch failed (${resp.status}): ${bodyText || 'no response body'}`);
  }
  return { workflowFile };
}

// ── Shared helpers (used by both batch parser and real-time streaming) ────────

const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const stripTimestamp = (line) => line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, '');

function isUrlSuccessCase(name) {
  const n = String(name || '').toLowerCase();
  return (
    n.includes('new registration') ||
    n.includes('existing registration') ||
    n.includes('base phone number with different email')
  );
}

function registrationExpectationFromName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('base email with different phone')) return 'blocked_after_otp';
  if (n.includes('invalid email') || n.includes('invalid phone') || n.includes('submitting empty form'))
    return 'validation_only';
  if (isUrlSuccessCase(name)) return 'screening_url';
  return 'other';
}

function leadDetailsFromName(name, fixtureData) {
  const n = String(name || '').toLowerCase();
  if (n.includes('new registration')) return { email: fixtureData.newEmail, phone: fixtureData.newPhone };
  if (n.includes('existing registration')) return { email: fixtureData.existingEmail, phone: fixtureData.existingPhone };
  if (n.includes('base email with different phone number'))
    return { email: fixtureData.sameEmailDifferentPhone.email, phone: fixtureData.sameEmailDifferentPhone.phone };
  if (n.includes('base phone number with different email'))
    return { email: fixtureData.samePhoneDifferentEmail.email, phone: fixtureData.samePhoneDifferentEmail.phone };
  if (n.includes('invalid email')) return { email: fixtureData.invalidEmails[0], phone: fixtureData.existingPhone };
  if (n.includes('invalid phone')) return { email: fixtureData.existingEmail, phone: fixtureData.invalidPhones[1] };
  if (n.includes('submitting empty form')) return { email: '', phone: '' };
  return { email: '', phone: '' };
}

function buildTestContext(name, status, fixtureData) {
  const registrationExpectation = registrationExpectationFromName(name);
  const isRegistrationUrlCase = isUrlSuccessCase(name);
  const registrationStatus = isRegistrationUrlCase && status === 'passed' ? 'registered' : 'not_registered';
  const userRegistrationPass =
    registrationExpectation === 'screening_url' ? registrationStatus === 'registered' : status === 'passed';
  return {
    name,
    status,
    isRegistrationUrlCase,
    registrationExpectation,
    userRegistrationPass,
    registrationStatus,
    lead: leadDetailsFromName(name, fixtureData),
    leadRegisteredWithUrl: registrationStatus === 'registered',
  };
}

function buildTotals(testsWithContext, exitCode) {
  const automationPassed = testsWithContext.filter((t) => t.status === 'passed').length;
  const automationFailed = testsWithContext.filter((t) => t.status === 'failed').length;
  const total = testsWithContext.length;
  const urlIntentTests = testsWithContext.filter((t) => t.isRegistrationUrlCase);
  const registrationUrlAttempts = urlIntentTests.length;
  const registrationUrlSuccess = urlIntentTests.filter((t) => t.registrationStatus === 'registered').length;
  const userRegistrationSuccess = testsWithContext.filter((t) => t.userRegistrationPass).length;
  const userRegistrationAttempts = total;
  const allUserRegistrationOk = userRegistrationAttempts > 0 && userRegistrationSuccess === userRegistrationAttempts;
  return {
    total,
    automationPassed,
    automationFailed: automationFailed || (exitCode !== 0 && total === 0 ? 1 : 0),
    registrationUrlSuccess,
    registrationUrlAttempts,
    allRegistrationUrlsOk: registrationUrlAttempts > 0 && registrationUrlSuccess === registrationUrlAttempts,
    userRegistrationSuccess,
    userRegistrationAttempts,
    allUserRegistrationOk,
  };
}

// ── Batch parser (used for GitHub Actions log download) ───────────────────────

function parseCypressOutputToDashboardData({ output, code, fixtureData, selectedPlatform, selectedBaseUrl }) {
  const cleanedOutput = stripAnsi(output);
  const lines = cleanedOutput.split(/\r?\n/).map(stripTimestamp).filter(Boolean);
  const signalLines = lines.filter((line) => !/WARN|WARNING|DEPRECATION/i.test(line));

  const rawTests = [];
  // `inSummary` toggles on each per-spec "X passing" line and resets on the
  // next "Running:" line — necessary so multi-spec runs don't lose tests from
  // the second/third spec after the first spec's summary block.
  let inSummary = false;
  for (const line of signalLines) {
    if (/^\s*Running:\s+/i.test(line)) inSummary = false;
    if (/^\s*\d+\s+passing/i.test(line) || /^\s*\d+\s+failing/i.test(line)) {
      inSummary = true;
      continue;
    }
    if (inSummary) continue;
    const passMatch = line.match(/^\s*[✓✔√]\s+(.*?)(\s+\(|$)/);
    if (passMatch) { rawTests.push({ name: passMatch[1].trim(), status: 'passed' }); continue; }
    const failMatch = line.match(/^\s*\d+\)\s+(.*)$/);
    if (failMatch) rawTests.push({ name: failMatch[1].trim(), status: 'failed' });
  }

  const testsWithContext = rawTests.map((t) => buildTestContext(t.name, t.status, fixtureData));
  const totals = buildTotals(testsWithContext, code);

  // Fall back to summary counts when individual lines weren't parseable
  if (totals.total === 0) {
    const summaryPassed = Number((cleanedOutput.match(/(\d+)\s+passing/i) || [])[1] || 0);
    const summaryFailed = Number((cleanedOutput.match(/(\d+)\s+failing/i) || [])[1] || 0);
    totals.automationPassed = summaryPassed;
    totals.automationFailed = summaryFailed || (code === 0 ? 0 : 1);
    totals.total = summaryPassed + summaryFailed;
  }

  return {
    ok: code === 0,
    message: code === 0 ? `Tests complete: ${totals.userRegistrationSuccess}/${totals.userRegistrationAttempts} lead outcomes OK.` : `Cypress run failed (exit code ${code}).`,
    exitCode: code,
    platform: selectedPlatform,
    baseUrl: selectedBaseUrl,
    tests: testsWithContext,
    totals,
  };
}

async function findWorkflowRunByRequestId(requestId, workflowFile) {
  // Polls the workflow that was actually dispatched (per-mode) rather than the
  // GITHUB_WORKFLOW_FILE default — otherwise an ALM dispatch's run wouldn't be
  // found when looking at mlp-run.yml's run list.
  const file = workflowFile || GITHUB_WORKFLOW_FILE;
  const listUrl = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(
    GITHUB_REPO
  )}/actions/workflows/${encodeURIComponent(
    file
  )}/runs?event=workflow_dispatch&branch=${encodeURIComponent(GITHUB_REF)}&per_page=30`;
  const resp = await fetch(listUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mlp-form-server',
    },
  });
  if (!resp.ok) throw new Error(`Failed to list workflow runs (${resp.status})`);
  const body = await resp.json();
  const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
  return runs.find((r) => String(r.name || '').includes(requestId));
}

async function fetchWorkflowRunLogs(runId) {
  const logsUrl = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(GITHUB_REPO)}/actions/runs/${runId}/logs`;
  const resp = await fetch(logsUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mlp-form-server',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`Failed to download run logs (${resp.status})`);
  const zipBuffer = await resp.buffer();
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const runCypressEntry = entries.find((e) => /Run Cypress/i.test(e.entryName));
  if (!runCypressEntry) throw new Error('Run Cypress log entry not found in workflow logs');
  return runCypressEntry.getData().toString('utf8');
}

app.post('/prepare-tests', async (req, res) => {
  const { name, baseEmail, basePhone, differentEmail, differentPhone, platform, mode } =
    req.body || {};
  const selectedMode = resolveMode(mode);
  const modeConfig = MODES[selectedMode];
  console.log('[UI] /prepare-tests request received');
  console.log(
    `[UI] Inputs => mode=${selectedMode}, platform=${platform || 'test'}, baseEmail=${baseEmail || '-'}, basePhone=${basePhone || '-'}, differentEmail=${differentEmail || '-'}, differentPhone=${differentPhone || '-'}`
  );
  // The SEO mode supports the test platform AND the production platform
  // (per spec: "platform=production → www.kraftshala.com"). MLP/ALM still use
  // only test/main as before.
  const isSeoMode = modeConfig.isSeo === true;
  const isCallbackMode = modeConfig.isCallback === true;
  const isKsliveMode = modeConfig.isKslive === true;
  const isSmblMode = modeConfig.isSmbl === true;
  const rawPlatform = String(platform || 'test').toLowerCase();
  const selectedPlatform = isSeoMode
    ? (rawPlatform === 'production' ? 'production' : 'test')
    : (rawPlatform === 'main' ? 'main' : 'test');
  const selectedBaseUrl = isSeoMode
    ? (selectedPlatform === 'production'
        ? 'https://www.kraftshala.com/'
        : TEST_PLATFORM_BASE_URL)
    : (selectedPlatform === 'main' ? MAIN_PLATFORM_BASE_URL : TEST_PLATFORM_BASE_URL);

  // Lead-clean URLs only apply to MLP/ALM — SEO mode skips deletion entirely.
  const selectedDeleteBases = !isSeoMode && modeConfig.deleteBases
    ? {
        emailDeleteBase: modeConfig.deleteBases[selectedPlatform].email,
        phoneDeleteBase: modeConfig.deleteBases[selectedPlatform].phone,
      }
    : null;

  const trimmedName = name != null ? String(name).trim() : '';
  const trimmedBaseEmail = baseEmail != null ? String(baseEmail).trim() : '';
  const trimmedBasePhone = basePhone != null ? String(basePhone).trim() : '';
  const trimmedDifferentEmail = differentEmail != null ? String(differentEmail).trim() : '';
  const trimmedDifferentPhone = differentPhone != null ? String(differentPhone).trim() : '';

  // Lead-input validation runs in MLP / ALM. Callback only needs base name/email/phone.
  if (!isSeoMode && !isCallbackMode) {
    if (
      !trimmedName ||
      !trimmedBaseEmail ||
      !trimmedBasePhone ||
      !trimmedDifferentEmail ||
      !trimmedDifferentPhone
    ) {
      return res.status(400).json({
        ok: false,
        message:
          'name, baseEmail, basePhone, differentEmail, and differentPhone are required (no auto-generated values).',
      });
    }

    if (
      trimmedBaseEmail.toLowerCase() === trimmedDifferentEmail.toLowerCase() ||
      trimmedBasePhone === trimmedDifferentPhone
    ) {
      return res.status(400).json({
        ok: false,
        message:
          'differentEmail must differ from base email, and differentPhone must differ from base phone.',
      });
    }
  }
  // Callback mode: no input validation — values are read from the MLP fixture
  // by the spec itself, so the UI doesn't need to send anything.

  // KS Live uses a flat fixture shape (name + base/different email + base/different
  // phone + otp) — distinct from MLP/ALM's nested shape. Build it inline.
  const ksLiveFixture = isKsliveMode ? {
    name: trimmedName,
    baseEmail: trimmedBaseEmail,
    basePhone: trimmedBasePhone,
    differentEmail: trimmedDifferentEmail,
    differentPhone: trimmedDifferentPhone,
    otp: '159753',
  } : null;

  const fixtureData = isSeoMode || isCallbackMode || isKsliveMode ? null : buildFixtureFromForm({
    name: trimmedName,
    baseEmail: trimmedBaseEmail,
    basePhone: trimmedBasePhone,
    differentEmail: trimmedDifferentEmail,
    differentPhone: trimmedDifferentPhone,
  });

  if (!isSeoMode && !isCallbackMode && !isKsliveMode) {
    // MLP / ALM — full lead-form fixture + lead deletion + per-mode fixture file.
    try {
      console.log('[RUN] Deleting leads once before automation...');
      await deleteLeads(
        [
          fixtureData.existingEmail,
          fixtureData.newEmail,
          fixtureData.samePhoneDifferentEmail.email,
        ],
        [fixtureData.existingPhone, fixtureData.newPhone, fixtureData.sameEmailDifferentPhone.phone],
        selectedDeleteBases
      );
      console.log('[RUN] Lead deletion completed');
    } catch (err) {
      console.error('Error during lead deletion:', err);
    }

    try {
      const fixtureDir = path.dirname(modeConfig.fixturePath);
      if (!fs.existsSync(fixtureDir)) {
        fs.mkdirSync(fixtureDir, { recursive: true });
      }
      fs.writeFileSync(modeConfig.fixturePath, JSON.stringify(fixtureData, null, 2));
    } catch (err) {
      console.error('Error writing fixture file:', err);
      return res.status(500).json({
        ok: false,
        message: 'Failed to write fixture file',
      });
    }
  } else if (isCallbackMode) {
    // Callback mode reads directly from the MLP fixture — nothing to write.
  } else if (isKsliveMode) {
    // KS Live — write the flat fixture from user inputs.
    try {
      const fixtureDir = path.dirname(modeConfig.fixturePath);
      if (!fs.existsSync(fixtureDir)) {
        fs.mkdirSync(fixtureDir, { recursive: true });
      }
      fs.writeFileSync(modeConfig.fixturePath, JSON.stringify(ksLiveFixture, null, 2));
    } catch (err) {
      console.error('Error writing KS Live fixture:', err);
      return res.status(500).json({
        ok: false,
        message: 'Failed to write KS Live fixture file',
      });
    }
  } else {
    // SEO mode: clear any stale seo-results.json from a previous run so the UI
    // doesn't render leftover data before the new run finishes.
    try {
      if (fs.existsSync(SEO_RESULTS_FILE)) fs.writeFileSync(SEO_RESULTS_FILE, '[]');
    } catch (_err) { /* noop */ }
  }

  if (shouldUseGitHubActionsRunner()) {
    try {
      const requestId = createRequestId();
      const dispatchResult = await dispatchGitHubWorkflow({
        mode: selectedMode,
        platform: selectedPlatform,
        name: trimmedName,
        baseEmail: trimmedBaseEmail,
        basePhone: trimmedBasePhone,
        differentEmail: trimmedDifferentEmail,
        differentPhone: trimmedDifferentPhone,
        requestId,
      });
      const dispatchedWorkflowFile = dispatchResult && dispatchResult.workflowFile;
      githubRunJobs.set(requestId, {
        requestId,
        fixtureData,
        selectedPlatform,
        selectedBaseUrl,
        runMode: selectedMode,
        workflowFile: dispatchedWorkflowFile,
        status: 'queued',
        result: null,
        runId: null,
      });
      console.log(`[RUN] Workflow ${dispatchedWorkflowFile} dispatched to GitHub Actions (mode=${selectedMode})`);
      return res.json({
        ok: true,
        mode: 'github_actions',
        runMode: selectedMode,
        requestId,
        statusPollUrl: `/github-actions-status/${encodeURIComponent(requestId)}`,
        tests: [],
        totals: {
          total: 0,
          automationPassed: 0,
          automationFailed: 0,
          registrationUrlSuccess: 0,
          registrationUrlAttempts: 0,
          allRegistrationUrlsOk: false,
          userRegistrationSuccess: 0,
          userRegistrationAttempts: 0,
          allUserRegistrationOk: false,
        },
        message:
          'Automation has been queued on GitHub Actions. We will fetch and show final results here shortly.',
        workflowRunsUrl: buildWorkflowRunsUrl(dispatchedWorkflowFile),
      });
    } catch (err) {
      console.error('[RUN] Failed to dispatch GitHub workflow:', err.message);
      return res.status(500).json({
        ok: false,
        message: `Failed to trigger GitHub Actions: ${err.message}`,
      });
    }
  }

  // ── Local Cypress run with real-time SSE streaming ──────────────────────────
  const requestId = createRequestId();
  const run = { emitter: new EventEmitter(), buffered: [], done: false, result: null };
  localRuns.set(requestId, run);

  const emitSSE = (event, data) => {
    const payload = { event, data };
    run.buffered.push(payload);
    run.emitter.emit('sse', payload);
  };

  // Respond immediately so the browser can open the SSE stream
  res.json({
    ok: true,
    mode: 'local',
    runMode: selectedMode,
    runLabel: modeConfig.label,
    expectedTestCount: modeConfig.expectedTestCount,
    pixelEnabled: modeConfig.pixelEnabled,
    requestId,
    streamUrl: `/run-stream/${encodeURIComponent(requestId)}`,
    tests: [],
    totals: { total: 0, automationPassed: 0, automationFailed: 0, registrationUrlSuccess: 0, registrationUrlAttempts: 0, allRegistrationUrlsOk: false, userRegistrationSuccess: 0, userRegistrationAttempts: 0, allUserRegistrationOk: false },
    message: 'Cypress is starting...',
  });

  const cypressCmd = process.env.MLP_CYPRESS_CMD || 'npx';
  // Mode-driven spec list. ALM passes disablePixel=true via --env so the pixel
  // monitor short-circuits (per user spec: no pixel checks for ALM).
  const envParts = [`platform=${selectedPlatform}`];
  if (!modeConfig.pixelEnabled) envParts.push('disablePixel=true');
  const cypressArgs = [
    '--spec', modeConfig.specs.join(','),
    '--config', `baseUrl=${selectedBaseUrl}`,
    '--env', envParts.join(','),
  ];
  const finalCypressArgs = cypressCmd === 'npx' ? ['cypress', 'run', ...cypressArgs] : ['run', ...cypressArgs];

  const child = spawn(cypressCmd, finalCypressArgs, {
    cwd: __dirname,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(`[RUN] Starting Cypress (streaming): ${cypressCmd} ${finalCypressArgs.join(' ')}`);

  let output = '';
  let summaryReached = false;
  const seenTestNames = new Set();

  // Attach the just-finished test's apiCalls to its SSE payload. The Cypress
  // reporter prints `✓ name` *after* the test's afterEach hook completes, and
  // apiMonitor.js flushes via cy.task in afterEach — so by the time this line
  // appears in stdout, the corresponding entry is already in api-monitor-data.json.
  const decorateWithApi = (ctx) => {
    const apiByTest = readApiCallsByTest();
    ctx.apiCalls = apiByTest.get(ctx.name) || [];
    return ctx;
  };

  const processLine = (raw) => {
    const line = stripTimestamp(stripAnsi(raw));
    // Cypress prints `Running:  <spec>` once per spec — reset the per-spec
    // summary flag here so test results from later specs aren't dropped after
    // the first spec's "X passing" summary line.
    if (/^\s*Running:\s+/i.test(line)) summaryReached = false;
    if (/^\s*\d+\s+passing/i.test(line) || /^\s*\d+\s+failing/i.test(line)) summaryReached = true;
    if (summaryReached) return;

    const passMatch = line.match(/^\s*[✓✔√]\s+(.*?)(\s+\(|$)/);
    if (passMatch) {
      const name = passMatch[1].trim();
      if (name && !seenTestNames.has(name)) {
        seenTestNames.add(name);
        emitSSE('test_result', decorateWithApi(buildTestContext(name, 'passed', fixtureData)));
      }
      return;
    }
    const failMatch = line.match(/^\s*\d+\)\s+(.+)$/);
    if (failMatch) {
      const name = failMatch[1].trim();
      if (name && !seenTestNames.has(name)) {
        seenTestNames.add(name);
        emitSSE('test_result', decorateWithApi(buildTestContext(name, 'failed', fixtureData)));
      }
    }
  };

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
    text.split(/\r?\n/).forEach(processLine);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stderr.write(text);
  });

  child.on('error', (err) => {
    console.error('[RUN] Cypress spawn failed:', err);
    const errResult = {
      ok: false, message: `Failed to start Cypress: ${err.message}`, exitCode: null,
      platform: selectedPlatform, baseUrl: selectedBaseUrl, tests: [],
      totals: { total: 0, automationPassed: 0, automationFailed: 0, registrationUrlSuccess: 0, registrationUrlAttempts: 0, allRegistrationUrlsOk: false, userRegistrationSuccess: 0, userRegistrationAttempts: 0, allUserRegistrationOk: false },
    };
    run.done = true; run.result = errResult;
    emitSSE('complete', errResult);
    run.emitter.emit('done');
    setTimeout(() => localRuns.delete(requestId), 600_000);
  });

  child.on('exit', (code) => {
    console.log(`Cypress run finished with code ${code}`);
    let parsed = attachMonitoringData(
      parseCypressOutputToDashboardData({ output, code, fixtureData, selectedPlatform, selectedBaseUrl })
    );
    if (isSeoMode) parsed = attachSeoResults(parsed);
    parsed.runMode = selectedMode;
    parsed.runLabel = modeConfig.label;
    parsed.expectedTestCount = modeConfig.expectedTestCount;
    parsed.pixelEnabled = modeConfig.pixelEnabled;
    console.log('Lead URL-verification summary:');
    for (const t of parsed.tests || []) {
      const reg = t.registrationStatus === 'registered' ? 'URL_FOUND' : 'URL_NOT_FOUND';
      console.log(`- ${t.name} | ${t.lead?.email || '-'} | ${t.lead?.phone || '-'} | ${reg} | ${t.status === 'passed' ? 'AUTO_PASS' : 'AUTO_FAIL'}`);
    }
    run.done = true; run.result = parsed;
    emitSSE('complete', parsed);
    run.emitter.emit('done');
    setTimeout(() => localRuns.delete(requestId), 600_000);
  });
});

app.get('/github-actions-status/:requestId', async (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ ok: false, message: 'requestId is required' });
  }
  if (!shouldUseGitHubActionsRunner()) {
    return res.status(400).json({ ok: false, message: 'GitHub Actions mode is not configured' });
  }
  const job = githubRunJobs.get(requestId);
  if (!job) {
    return res.status(404).json({ ok: false, message: 'Unknown request id' });
  }
  // Poll the workflow that was actually dispatched for this job — falls back
  // to the default if the job pre-dates the per-mode dispatch refactor.
  const jobWorkflowFile = job.workflowFile || GITHUB_WORKFLOW_FILE;
  const jobWorkflowRunsUrl = buildWorkflowRunsUrl(jobWorkflowFile);
  try {
    const run = await findWorkflowRunByRequestId(requestId, jobWorkflowFile);
    if (!run) {
      return res.json({
        ok: true,
        mode: 'github_actions',
        state: 'queued',
        message: 'Workflow is still being queued on GitHub Actions...',
        workflowRunsUrl: jobWorkflowRunsUrl,
      });
    }
    job.runId = run.id;
    job.status = run.status;
    const workflowRunUrl = run.html_url || jobWorkflowRunsUrl;
    if (run.status !== 'completed') {
      const steps = await fetchWorkflowJobSteps(run.id).catch(() => []);
      return res.json({
        ok: true,
        mode: 'github_actions',
        state: 'running',
        message: 'Workflow is running on GitHub Actions...',
        workflowRunUrl,
        steps,
      });
    }
    if (job.result) {
      return res.json({ ...job.result, mode: 'github_actions', state: 'completed', workflowRunUrl });
    }
    const logText = await fetchWorkflowRunLogs(run.id);
    const exitCode = run.conclusion === 'success' ? 0 : 1;
    const parsed = parseCypressOutputToDashboardData({
      output: logText,
      code: exitCode,
      fixtureData: job.fixtureData,
      selectedPlatform: job.selectedPlatform,
      selectedBaseUrl: job.selectedBaseUrl,
    });
    job.result = parsed;
    return res.json({
      ...parsed,
      mode: 'github_actions',
      state: 'completed',
      workflowRunUrl,
    });
  } catch (err) {
    console.error('[RUN] Failed reading GitHub workflow status:', err.message);
    return res.status(500).json({
      ok: false,
      mode: 'github_actions',
      message: `Failed to read workflow status: ${err.message}`,
      workflowRunsUrl: jobWorkflowRunsUrl,
    });
  }
});

// ── SSE stream for local Cypress runs ────────────────────────────────────────

app.get('/run-stream/:requestId', (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  const run = localRuns.get(requestId);
  if (!run) {
    res.status(404).json({ ok: false, message: 'Run not found or has expired' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/render proxy buffering
  res.flushHeaders();

  const send = ({ event, data }) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Replay buffered events for late-connecting clients
  for (const payload of run.buffered) send(payload);

  if (run.done) { res.end(); return; }

  run.emitter.on('sse', send);
  run.emitter.once('done', () => { run.emitter.off('sse', send); res.end(); });
  req.on('close', () => run.emitter.off('sse', send));
});

// ── GitHub Jobs step fetcher (production progress tracking) ───────────────────

async function fetchWorkflowJobSteps(runId) {
  const url = `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/actions/runs/${runId}/jobs`;
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mlp-form-server',
    },
  });
  if (!resp.ok) return [];
  const body = await resp.json();
  const job = Array.isArray(body?.jobs) ? body.jobs[0] : null;
  if (!job) return [];
  return (job.steps || []).map((s) => ({
    name: s.name,
    status: s.status,       // queued | in_progress | completed
    conclusion: s.conclusion, // success | failure | null
  }));
}

app.listen(PORT, () => {
  console.log(`MLP form server running at http://localhost:${PORT}`);
});

