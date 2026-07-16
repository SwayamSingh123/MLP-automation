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
const FIXTURE_PATH_SMBL = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'smbl',
  'smblTestData.json'
);
const FIXTURE_PATH_KSLIVE = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'kslive',
  'ksLiveTestData.json'
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
    pixelEnabled: true,
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
  // SMBL (Sales & Marketing Business Leaders) — 7 edge cases mirroring MLP,
  // success URL is /pgp/learn-sales-and-marketing/thank-you/?id=<uuid>.
  smbl: {
    label: 'SMBL',
    fixturePath: FIXTURE_PATH_SMBL,
    specs: ['cypress/e2e/smbl/smblLeadForm.cy.js'],
    expectedTestCount: 7,
    pixelEnabled: true,
    isSmbl: true,
    deleteBases: {
      test: { email: SMBL_TEST_EMAIL_DELETE_BASE, phone: TEST_PHONE_DELETE_BASE },
      main: { email: SMBL_MAIN_EMAIL_DELETE_BASE, phone: MAIN_PHONE_DELETE_BASE },
    },
  },
  // KS Live — event registration on /kraftshala-live/. Simplified: a single
  // smoke registration on the 1st visible event card (name + email + phone +
  // WhatsApp Yes + OTP → success). Fixture only needs name/baseEmail/basePhone/
  // otp — no different email/phone required. No lead-delete API for events.
  kslive: {
    label: 'KSLIVE',
    fixturePath: FIXTURE_PATH_KSLIVE,
    specs: ['cypress/e2e/kslive/ksLiveRegistration.cy.js'],
    expectedTestCount: 1,
    pixelEnabled: true,
    isKslive: true,
    deleteBases: null,
  },
  // Broken Link Checker — crawls a configurable set of Kraftshala pages and
  // probes every <a>/<img>/<link>/<script> URL via cy.task. One test per page,
  // results flushed to cypress/reports/broken-links-results.json.
  // No lead inputs, no fixture write, no pixel capture.
  links: {
    label: 'LINKS',
    fixturePath: null,
    specs: ['cypress/e2e/links/brokenLinkChecker.cy.js'],
    expectedTestCount: 13, // all 13 pages by default; UI may restrict via linksPages
    pixelEnabled: false,
    isLinks: true,
    deleteBases: null,
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
const BROKEN_LINKS_RESULTS_FILE = path.join(
  __dirname,
  'cypress',
  'reports',
  'broken-links-results.json'
);
const LINKS_SELECTED_PAGES_FILE = path.join(
  __dirname,
  'cypress',
  'reports',
  'links-selected-pages.json'
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

// Pixel fires from post-success transition pages shouldn't count toward the
// page-under-test's pixel matrix — those pages fire their own PageView when
// the user lands on them, which would inflate the count and not match what
// Meta Pixel Helper shows for the original page.
function isPostSuccessSourceUrl(sourceUrl) {
  if (!sourceUrl) return false;
  return /\/screening-test\/|\/thank-you\//i.test(sourceUrl);
}

// Aggregate every Meta Pixel fire into a per-(pixelId, eventName) summary —
// pixel-monitor only captures during the FIRST test of a run, so the aggregate
// is across that single capture window. Excludes blank-id POST beacons and
// fires that originated from the post-success redirect pages (so the count
// matches what Meta Pixel Helper shows for the page under test).
function aggregatePixelEvents() {
  const data = readJsonFileSafe(PIXEL_DATA_FILE);
  const byKey = new Map();
  for (const entry of Array.isArray(data) ? data : []) {
    for (const call of entry.pixelCalls || []) {
      const pixelId = call.pixelId || '';
      const eventName = call.eventName || '';
      if (!pixelId && !eventName) continue;
      if (isPostSuccessSourceUrl(call.sourceUrl)) continue;
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

function readBrokenLinksResults() {
  return readJsonFileSafe(BROKEN_LINKS_RESULTS_FILE);
}
function attachBrokenLinksResults(parsed) {
  const pages = readBrokenLinksResults();
  const totals = {
    pagesCrawled: Array.isArray(pages) ? pages.length : 0,
    urlsChecked: 0,
    linksChecked: 0, imagesChecked: 0, cssChecked: 0, jsChecked: 0, mediaChecked: 0,
    working: 0, redirects: 0, forbidden: 0,
    broken: 0, brokenLinks: 0, brokenImages: 0, brokenAssets: 0, brokenMedia: 0,
    serverErrors: 0, unreachable: 0,
  };
  const flatBroken = [];
  for (const p of pages || []) {
    const c = (p && p.counts) || {};
    totals.urlsChecked   += Number(c.total)  || 0;
    totals.linksChecked  += Number(c.a)      || 0;
    totals.imagesChecked += Number(c.img)    || 0;
    totals.cssChecked    += Number(c.link)   || 0;
    totals.jsChecked     += Number(c.script) || 0;
    totals.mediaChecked  += Number(c.media)  || 0;
    totals.working       += Number(c.working)      || 0;
    totals.redirects     += Number(c.redirect)     || 0;
    totals.forbidden     += Number(c.forbidden)    || 0;
    totals.broken        += Number(c.broken)       || 0;
    totals.serverErrors  += Number(c.server_error) || 0;
    totals.unreachable   += Number(c.unreachable)  || 0;
    for (const b of (p.broken || [])) {
      flatBroken.push({ pageUrl: p.url, pageName: p.name, ...b });
      if (b.type === 'a') totals.brokenLinks++;
      else if (b.type === 'img') totals.brokenImages++;
      else if (b.type === 'media') totals.brokenMedia++;
      else if (b.type === 'link' || b.type === 'script') totals.brokenAssets++;
    }
  }
  parsed.brokenLinksResults = {
    pages: pages || [],
    totals,
    brokenItems: flatBroken,
  };
  return parsed;
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
  callback: 'callback-run.yml',
  seo:      'seo-run.yml',
  kslive:   'kslive-run.yml',
  links:    'links-run.yml',
  run_all:  'run-all.yml',
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
//   links                     → platform + pages (comma-separated page IDs)
function buildWorkflowInputs(mode, args) {
  const { platform, name, baseEmail, basePhone, differentEmail, differentPhone, requestId, linksPages } = args;
  if (mode === 'seo') return { platform, requestId };
  if (mode === 'callback') return { platform, name, baseEmail, basePhone, requestId };
  if (mode === 'links') return { platform, pages: linksPages || '', requestId };
  if (mode === 'run_all') return { platform, requestId };
  return { platform, name, baseEmail, basePhone, differentEmail, differentPhone, requestId };
}
const GITHUB_REF = process.env.GITHUB_REF || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Google Chat incoming webhook. When set, "Run All" posts a formatted report
// here when it finishes. Empty string means notifications are skipped.
const GCHAT_WEBHOOK_URL = process.env.GCHAT_WEBHOOK_URL || '';

// Optional shared-secret token for GET /trigger-run-all. When set, requests
// must include ?token=<value>. Leave unset in trusted local networks only —
// on Render (publicly reachable), set this so random visitors can't trigger
// a 20-minute Cypress run.
const RUN_ALL_TOKEN = process.env.RUN_ALL_TOKEN || '';

// Public URL the server is reachable at — used to build the "trigger next
// run" link embedded in Google Chat reports. Render sets RENDER_EXTERNAL_URL
// automatically; locally set PUBLIC_BASE_URL yourself (or leave blank to
// omit the link from Chat messages).
const PUBLIC_BASE_URL = String(
  process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || ''
).replace(/\/$/, '');

function buildTriggerUrl(platform) {
  if (!PUBLIC_BASE_URL) return '';
  const params = new URLSearchParams();
  if (RUN_ALL_TOKEN) params.set('token', RUN_ALL_TOKEN);
  if (platform) params.set('platform', platform);
  const q = params.toString();
  return PUBLIC_BASE_URL + '/trigger-run-all' + (q ? '?' + q : '');
}

// POST a JSON payload to the configured Google Chat webhook. Never throws —
// returns { ok, skipped?, error? } so callers can surface the status to the UI.
async function postToGoogleChat(payload) {
  if (!GCHAT_WEBHOOK_URL) {
    console.log('[gchat] GCHAT_WEBHOOK_URL not set — skipping notification');
    return { ok: false, skipped: true, error: 'GCHAT_WEBHOOK_URL not set on server' };
  }
  try {
    const resp = await fetch(GCHAT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const preview = body.replace(/\s+/g, ' ').slice(0, 200);
      return { ok: false, error: `Google Chat webhook returned ${resp.status}: ${preview}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Human-readable duration formatter — "42s" or "3m 15s".
function _formatDuration(sec) {
  const s = Number(sec) || 0;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Pluck the primary lead identifiers from a fixture blob. Works across MLP
// shape (existingEmail/existingPhone), KS Live shape (baseEmail/basePhone),
// and callback shape (email/phone). Returns { email, phone } — either may
// be empty string.
function _leadFromFixture(fx) {
  if (!fx) return { email: '', phone: '' };
  return {
    email: fx.existingEmail || fx.baseEmail || fx.email || '',
    phone: fx.existingPhone || fx.basePhone || fx.phone || '',
  };
}

// Build a plain-text Google Chat message from a "Run All" summary.
//
// Layout:
//   1. Header — platform, total duration, timestamp
//   2. Summary table — one row per mode with icon, pass/total, duration
//   3. Total line
//   4. FAILURES DETAIL — for each mode with any failed test:
//        • mode label + target URL + lead used (email/phone) if applicable
//        • list of failed test names
//   5. Run-again trigger URL
//
// Truncation: at most 6 failed tests per mode are listed (with a "… and N
// more" tail), and the entire message caps around Chat's ~4KB text limit.
function buildRunAllGchatMessage(summary) {
  const platform = String(summary.platform || 'test').toUpperCase();
  const durationStr = _formatDuration(summary.durationSec);
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const lines = [];
  lines.push('🤖 *Kraftshala Automation — Run All Report*');
  lines.push(`Platform: *${platform}*  ·  Duration: *${durationStr}*  ·  ${timestamp}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('*📊 SUMMARY*');
  lines.push('');

  let totalPass = 0;
  let totalFail = 0;
  const failureBlocks = []; // one block per mode with any fail

  for (const m of (summary.modes || [])) {
    const label = (m.label || m.mode || '').padEnd(10);

    if (m.error) {
      lines.push(`⚠️  ${label} spec did not run — ${m.error}`);
      continue;
    }

    const result = m.result || {};
    const totals = result.totals || {};
    const total = Number(totals.total) || 0;
    const pass = Number(totals.automationPassed) || 0;
    const fail = Number(totals.automationFailed) || 0;
    const modeDurationStr = _formatDuration(result.durationSec);
    totalPass += pass;
    totalFail += fail;

    let icon;
    if (fail > 0) icon = '❌';
    else if (total === 0) icon = '⚠️';
    else icon = '✅';

    lines.push(
      `${icon}  ${label} ${pass}/${total} passed  (${modeDurationStr})` +
      (fail > 0 ? `  ⚠ ${fail} failure(s)` : '')
    );

    if (fail > 0) {
      const failedTests = (result.tests || []).filter((t) => t.status === 'failed');
      failureBlocks.push({
        label: m.label || m.mode,
        baseUrl: m.baseUrl || result.selectedBaseUrl || '',
        lead: _leadFromFixture(m.fixtureData),
        failedTests,
      });
    }
  }

  lines.push('');
  const totalRun = totalPass + totalFail;
  const overallIcon = totalFail === 0 ? '✅' : '❌';
  lines.push(`${overallIcon}  *Total: ${totalPass}/${totalRun} tests passed*`);

  if (failureBlocks.length > 0) {
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('*❌ FAILURES DETAIL*');
    lines.push('');

    for (const block of failureBlocks) {
      lines.push(`▪ *${block.label}* — ${block.failedTests.length} failed`);
      if (block.baseUrl) {
        lines.push(`   URL: ${block.baseUrl}`);
      }
      if (block.lead.email || block.lead.phone) {
        lines.push(`   Lead: ${block.lead.email || '-'}  /  ${block.lead.phone || '-'}`);
      }
      lines.push('   Failed tests:');
      const shown = block.failedTests.slice(0, 6);
      for (const t of shown) {
        lines.push(`     • ${t.name}`);
      }
      if (block.failedTests.length > shown.length) {
        lines.push(`     … and ${block.failedTests.length - shown.length} more`);
      }
      lines.push('');
    }
  }

  const triggerUrl = buildTriggerUrl(summary.platform);
  if (triggerUrl) {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('▶ Run again: ' + triggerUrl);
  }

  return { text: lines.join('\n') };
}
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
  linksPages,
}) {
  const workflowFile = resolveWorkflowFile(mode);
  const dispatchUrl = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(GITHUB_REPO)}/actions/workflows/${encodeURIComponent(
    workflowFile
  )}/dispatches`;
  const inputs = buildWorkflowInputs(mode, {
    platform, name, baseEmail, basePhone, differentEmail, differentPhone, requestId, linksPages,
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

// Downloads the first artifact attached to a workflow run and returns it as
// an unzipped AdmZip. Workflows upload exactly one artifact containing
// `cypress/reports/*` (api-monitor-data.json, pixel-monitor-data.json,
// seo-results.json) plus screenshots/videos. Returns null if no artifacts
// were uploaded (e.g. run failed before the upload step).
async function fetchWorkflowArtifacts(runId) {
  const listUrl = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(GITHUB_REPO)}/actions/runs/${runId}/artifacts`;
  const listResp = await fetch(listUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mlp-form-server',
    },
  });
  if (!listResp.ok) throw new Error(`Failed to list run artifacts (${listResp.status})`);
  const listBody = await listResp.json();
  const artifacts = Array.isArray(listBody && listBody.artifacts) ? listBody.artifacts : [];
  if (artifacts.length === 0) return null;

  // First artifact only — our workflows upload exactly one `<mode>-artifacts-<requestId>`.
  const artifact = artifacts[0];
  const downloadResp = await fetch(artifact.archive_download_url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mlp-form-server',
    },
    redirect: 'follow',
  });
  if (!downloadResp.ok) throw new Error(`Failed to download artifact ${artifact.id} (${downloadResp.status})`);
  const zipBuffer = await downloadResp.buffer();
  return new AdmZip(zipBuffer);
}

// Reads a JSON file from inside an artifact zip by suffix-matching the entry
// path. actions/upload-artifact strips the common root, so the entry path
// inside the zip is typically `reports/<name>.json` (without `cypress/`).
function readJsonFromZip(zip, suffix) {
  if (!zip) return null;
  const entry = zip
    .getEntries()
    .find((e) => e.entryName.replace(/\\/g, '/').endsWith(suffix));
  if (!entry) return null;
  try {
    return JSON.parse(entry.getData().toString('utf8'));
  } catch (_err) {
    return null;
  }
}

// Mirror of the local-run attachMonitoringData + attachSeoResults — but reads
// the JSON from a downloaded artifact zip instead of the form-server's local
// disk. Result: GitHub Actions runs surface the same per-test API chips,
// pixel summary, and SEO checklist diff that local runs do.
function attachRemoteMonitoringData(parsed, zip) {
  if (!zip) return parsed;

  // Per-test API calls — keyed by test title.
  const apiData = readJsonFromZip(zip, 'reports/api-monitor-data.json');
  if (Array.isArray(apiData)) {
    const apiByTest = new Map();
    for (const entry of apiData) {
      if (entry && entry.testTitle) apiByTest.set(entry.testTitle, entry.apiCalls || []);
    }
    for (const t of parsed.tests || []) {
      t.apiCalls = apiByTest.get(t.name) || [];
    }
  }

  // Aggregated Meta Pixel events — same shape as the local aggregator.
  // Skips fires from /screening-test/ and /thank-you/ (post-success pages)
  // so the count matches what Meta Pixel Helper shows for the page under test.
  const pixelData = readJsonFromZip(zip, 'reports/pixel-monitor-data.json');
  if (Array.isArray(pixelData)) {
    const byKey = new Map();
    for (const entry of pixelData) {
      for (const call of (entry && entry.pixelCalls) || []) {
        const pixelId = call.pixelId || '';
        const eventName = call.eventName || '';
        if (!pixelId && !eventName) continue;
        if (isPostSuccessSourceUrl(call.sourceUrl)) continue;
        const key = pixelId + '|' + eventName;
        if (!byKey.has(key)) byKey.set(key, { pixelId, eventName, count: 0, sourceUrls: [] });
        const item = byKey.get(key);
        item.count += 1;
        if (call.sourceUrl && !item.sourceUrls.includes(call.sourceUrl)) {
          item.sourceUrls.push(call.sourceUrl);
        }
      }
    }
    parsed.pixelEvents = Array.from(byKey.values()).sort((a, b) => {
      if (a.pixelId !== b.pixelId) return a.pixelId.localeCompare(b.pixelId);
      return a.eventName.localeCompare(b.eventName);
    });
  }

  // SEO checklist — only present for the SEO mode artifact.
  const seoData = readJsonFromZip(zip, 'reports/seo-results.json');
  if (Array.isArray(seoData)) parsed.seoResults = seoData;

  // Broken Link Checker — only present for the links mode artifact. Compute
  // the same totals / brokenItems shape as the local attachBrokenLinksResults
  // so the dashboard's renderer can read either one transparently.
  const linksData = readJsonFromZip(zip, 'reports/broken-links-results.json');
  if (Array.isArray(linksData)) {
    const totals = {
      pagesCrawled: linksData.length,
      urlsChecked: 0,
      linksChecked: 0, imagesChecked: 0, cssChecked: 0, jsChecked: 0, mediaChecked: 0,
      working: 0, redirects: 0, forbidden: 0,
      broken: 0, brokenLinks: 0, brokenImages: 0, brokenAssets: 0, brokenMedia: 0,
      serverErrors: 0, unreachable: 0,
    };
    const flatBroken = [];
    for (const p of linksData) {
      const c = (p && p.counts) || {};
      totals.urlsChecked   += Number(c.total)  || 0;
      totals.linksChecked  += Number(c.a)      || 0;
      totals.imagesChecked += Number(c.img)    || 0;
      totals.cssChecked    += Number(c.link)   || 0;
      totals.jsChecked     += Number(c.script) || 0;
      totals.mediaChecked  += Number(c.media)  || 0;
      totals.working       += Number(c.working)      || 0;
      totals.redirects     += Number(c.redirect)     || 0;
      totals.forbidden     += Number(c.forbidden)    || 0;
      totals.broken        += Number(c.broken)       || 0;
      totals.serverErrors  += Number(c.server_error) || 0;
      totals.unreachable   += Number(c.unreachable)  || 0;
      for (const b of (p.broken || [])) {
        flatBroken.push({ pageUrl: p.url, pageName: p.name, ...b });
        if (b.type === 'a') totals.brokenLinks++;
        else if (b.type === 'img') totals.brokenImages++;
        else if (b.type === 'media') totals.brokenMedia++;
        else if (b.type === 'link' || b.type === 'script') totals.brokenAssets++;
      }
    }
    parsed.brokenLinksResults = {
      pages: linksData,
      totals,
      brokenItems: flatBroken,
    };
  }

  return parsed;
}

// Run one mode's Cypress spec locally and return the parsed dashboard result.
// Standalone helper — used only by /run-all-tests. Doesn't stream per-test
// SSE (Run All only reports at mode-boundary granularity, keeping the SSE
// stream compact) but does write stdout/stderr to the terminal so a person
// watching the server logs sees the same output the local runner would show.
async function runOneModeLocal({
  mode,
  modeConfig,
  fixtureData,
  selectedPlatform,
  selectedBaseUrl,
}) {
  const cypressCmd = process.env.MLP_CYPRESS_CMD || 'npx';
  const envParts = [`platform=${selectedPlatform}`];
  if (!modeConfig.pixelEnabled) envParts.push('disablePixel=true');
  const cypressArgs = [
    '--spec', modeConfig.specs.join(','),
    '--config', `baseUrl=${selectedBaseUrl}`,
    '--env', envParts.join(','),
  ];
  const finalArgs =
    cypressCmd === 'npx' ? ['cypress', 'run', ...cypressArgs] : ['run', ...cypressArgs];

  const modeStartTime = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cypressCmd, finalArgs, {
      cwd: __dirname,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`[RUN-ALL] Starting Cypress for ${mode}: ${cypressCmd} ${finalArgs.join(' ')}`);

    let output = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on('error', (err) => {
      console.error(`[RUN-ALL] Cypress spawn error for ${mode}:`, err.message);
      resolve({
        error: `Failed to spawn Cypress: ${err.message}`,
        totals: { total: 0, automationPassed: 0, automationFailed: 0 },
        tests: [],
        runMode: mode,
        runLabel: modeConfig.label,
        durationSec: Math.round((Date.now() - modeStartTime) / 1000),
      });
    });
    child.on('exit', (code) => {
      const durationSec = Math.round((Date.now() - modeStartTime) / 1000);
      console.log(`[RUN-ALL] Cypress for ${mode} exited with code ${code} (${durationSec}s)`);
      let parsed = attachMonitoringData(
        parseCypressOutputToDashboardData({
          output, code, fixtureData, selectedPlatform, selectedBaseUrl,
        })
      );
      if (modeConfig.isSeo) parsed = attachSeoResults(parsed);
      if (modeConfig.isLinks) parsed = attachBrokenLinksResults(parsed);
      parsed.runMode = mode;
      parsed.runLabel = modeConfig.label;
      parsed.expectedTestCount = modeConfig.expectedTestCount;
      parsed.pixelEnabled = modeConfig.pixelEnabled;
      parsed.durationSec = durationSec;
      parsed.selectedBaseUrl = selectedBaseUrl;
      parsed.selectedPlatform = selectedPlatform;
      resolve(parsed);
    });
  });
}

// Sequential "Run All" — walks every mode in a fixed order, runs each one
// locally, streams per-mode start/complete events over SSE, and (optionally)
// posts a formatted summary to Google Chat when finished.
//
// Fixtures: each mode reads its own fixture file (already on disk from the
// last manual run or from a checked-in default). This endpoint does NOT
// overwrite fixture files — that's a deliberate choice so leads set by
// manual mode carry over and Run All is unattended.
//
// Order rationale: MLP/ALM/SMBL/KSLive first (they each need their own
// fixture), then Callback (reads MLP fixture — safer if MLP just refreshed
// its file), then SEO and Links (no fixture dependencies).
// Shared orchestration used by BOTH endpoints — POST /run-all-tests (with
// SSE progress) and GET /trigger-run-all (fire-and-forget). onProgress is a
// callback invoked with (event, data) at each state transition; pass a no-op
// for endpoints that don't need progress reporting.
async function executeRunAll({ selectedPlatform, wantsGchat, onProgress }) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  const selectedBaseUrl =
    selectedPlatform === 'main' ? MAIN_PLATFORM_BASE_URL : TEST_PLATFORM_BASE_URL;

  const runOrder = ['mlp', 'alm', 'smbl', 'kslive', 'callback', 'seo', 'links'];
  const allResults = [];
  const startTime = Date.now();

  for (const mode of runOrder) {
    const modeConfig = MODES[mode];
    if (!modeConfig) continue;

    emit('mode_start', { mode, label: modeConfig.label });

    try {
      // Read fixture from disk (best-effort). Missing fixtures aren't fatal;
      // the spec itself will fail cleanly if it can't find its data.
      let fixtureData = null;
      if (modeConfig.fixturePath && fs.existsSync(modeConfig.fixturePath)) {
        try {
          fixtureData = JSON.parse(fs.readFileSync(modeConfig.fixturePath, 'utf8'));
        } catch (err) {
          console.warn(`[RUN-ALL] Could not parse fixture for ${mode}: ${err.message}`);
        }
      }

      // Best-effort lead deletion for lead-based modes so each Run All starts
      // from a clean state. Uses only the fields present on the fixture; if
      // the fixture doesn't have MLP shape (e.g. KS Live's flat shape), the
      // deletion silently no-ops for missing fields.
      if (modeConfig.deleteBases && fixtureData) {
        const deleteBases = modeConfig.deleteBases[selectedPlatform];
        if (deleteBases) {
          try {
            const emails = [
              fixtureData.existingEmail,
              fixtureData.newEmail,
              fixtureData.baseEmail,
              fixtureData.samePhoneDifferentEmail && fixtureData.samePhoneDifferentEmail.email,
            ];
            const phones = [
              fixtureData.existingPhone,
              fixtureData.newPhone,
              fixtureData.basePhone,
              fixtureData.sameEmailDifferentPhone && fixtureData.sameEmailDifferentPhone.phone,
            ];
            await deleteLeads(emails, phones, {
              emailDeleteBase: deleteBases.email,
              phoneDeleteBase: deleteBases.phone,
            });
          } catch (err) {
            console.warn(`[RUN-ALL] Lead deletion failed for ${mode}: ${err.message}`);
          }
        }
      }

      // Clear stale results files so the aggregators pick up only this run's data.
      if (modeConfig.isSeo && fs.existsSync(SEO_RESULTS_FILE)) {
        try { fs.writeFileSync(SEO_RESULTS_FILE, '[]'); } catch (_) {}
      }
      if (modeConfig.isLinks && fs.existsSync(BROKEN_LINKS_RESULTS_FILE)) {
        try { fs.writeFileSync(BROKEN_LINKS_RESULTS_FILE, '[]'); } catch (_) {}
      }

      // For links mode, ensure the selected-pages config file exists so all
      // 13 pages are crawled by default (Run All doesn't offer per-page
      // filtering — for filtered runs use the manual Links tab).
      if (modeConfig.isLinks) {
        try {
          if (!fs.existsSync(path.dirname(LINKS_SELECTED_PAGES_FILE))) {
            fs.mkdirSync(path.dirname(LINKS_SELECTED_PAGES_FILE), { recursive: true });
          }
          fs.writeFileSync(LINKS_SELECTED_PAGES_FILE, JSON.stringify({ pages: [] }, null, 2));
        } catch (_) {}
      }

      const result = await runOneModeLocal({
        mode, modeConfig, fixtureData, selectedPlatform, selectedBaseUrl,
      });

      // Store fixtureData + baseUrl alongside the result so the gchat
      // formatter can surface WHERE the failing test ran (URL) and WHICH
      // lead was used (email/phone). Kept out of the SSE payload — those
      // are internal debugging details, not UI-facing.
      allResults.push({
        mode,
        label: modeConfig.label,
        result,
        fixtureData,
        baseUrl: selectedBaseUrl,
      });
      emit('mode_complete', {
        mode,
        label: modeConfig.label,
        totals: result.totals || null,
        durationSec: result.durationSec || 0,
      });
    } catch (err) {
      const errMsg = String((err && err.message) || err);
      console.error(`[RUN-ALL] Error running ${mode}:`, errMsg);
      allResults.push({ mode, label: modeConfig.label, error: errMsg });
      emit('mode_error', { mode, label: modeConfig.label, error: errMsg });
    }
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const summary = { platform: selectedPlatform, durationSec, modes: allResults };

  emit('all_complete', summary);

  if (wantsGchat) {
    const gchatResult = await postToGoogleChat(buildRunAllGchatMessage(summary));
    if (gchatResult.ok) {
      emit('gchat_sent', {});
    } else {
      emit('gchat_error', {
        error: gchatResult.error || 'unknown',
        skipped: !!gchatResult.skipped,
      });
    }
  }

  emit('finished', {});
  return summary;
}

app.post('/run-all-tests', async (req, res) => {
  const { platform, sendToGchat } = req.body || {};
  const rawPlatform = String(platform || 'test').toLowerCase();
  const selectedPlatform = rawPlatform === 'main' ? 'main' : 'test';
  const wantsGchat = sendToGchat !== false;

  // Prefer GitHub Actions dispatch when creds are configured — same
  // rationale as GET /trigger-run-all (Render's 512MB tier can't spawn
  // Cypress locally). The workflow itself posts the gchat report; this
  // endpoint just fires the trigger, returns immediately, and the dashboard
  // shows a "Dispatched to GitHub Actions" status instead of live per-mode SSE.
  if (shouldUseGitHubActionsRunner()) {
    try {
      const requestId = createRequestId();
      console.log(
        `[RUN-ALL] Dispatching run-all.yml on GitHub Actions (platform=${selectedPlatform}, requestId=${requestId})`
      );
      const dispatchResult = await dispatchGitHubWorkflow({
        mode: 'run_all',
        platform: selectedPlatform,
        requestId,
      });
      const workflowRunsUrl = buildWorkflowRunsUrl(
        (dispatchResult && dispatchResult.workflowFile) || 'run-all.yml'
      );
      return res.json({
        ok: true,
        mode: 'run_all_github_actions',
        requestId,
        workflowRunsUrl,
        message:
          'Run All dispatched to GitHub Actions. Report will arrive in Google Chat in ~20-30 min.',
      });
    } catch (err) {
      console.error('[RUN-ALL] GitHub Actions dispatch failed:', err.message);
      return res.status(500).json({
        ok: false,
        message: 'Failed to dispatch to GitHub Actions: ' + err.message,
      });
    }
  }

  // Local fallback — Cypress spawn. Only works on machines with >1GB RAM.
  const requestId = createRequestId();
  const run = {
    emitter: new EventEmitter(),
    buffered: [],
    done: false,
    result: null,
  };
  localRuns.set(requestId, run);

  const emitSSE = (event, data) => {
    const payload = { event, data };
    run.buffered.push(payload);
    run.emitter.emit('sse', payload);
  };

  // Respond immediately so the browser can open the SSE stream.
  res.json({
    ok: true,
    mode: 'run_all',
    requestId,
    streamUrl: `/run-stream/${encodeURIComponent(requestId)}`,
    message: 'Run All started locally. Watch the SSE stream for progress.',
  });

  const summary = await executeRunAll({
    selectedPlatform,
    wantsGchat,
    onProgress: emitSSE,
  });

  run.done = true;
  run.result = summary;
  run.emitter.emit('done');
  setTimeout(() => localRuns.delete(requestId), 600_000);
});

// One-click trigger — clickable from Google Chat message, browser bookmark,
// cron job, curl script, anywhere. Fires Run All in the background and
// returns an HTML confirmation page immediately.
//
// Auth: if RUN_ALL_TOKEN env var is set, requests must include ?token=<value>.
// Leave unset only on trusted networks (Render deployments should always set it).
//
// Query params:
//   ?token=<value>       — required if RUN_ALL_TOKEN is set on the server
//   ?platform=test|main  — default: test
//   ?gchat=0             — set to disable Google Chat notification (default: on)
app.get('/trigger-run-all', async (req, res) => {
  // Token check
  if (RUN_ALL_TOKEN && String(req.query.token || '') !== RUN_ALL_TOKEN) {
    res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(
      '<!doctype html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px;">' +
      '<h1 style="color:#dc2626;">401 Unauthorized</h1>' +
      '<p>Missing or invalid <code>token</code> query parameter.</p>' +
      '<p>Set <code>RUN_ALL_TOKEN</code> on the server and pass <code>?token=&lt;value&gt;</code>.</p>' +
      '</body></html>'
    );
  }

  const rawPlatform = String(req.query.platform || 'test').toLowerCase();
  const selectedPlatform = rawPlatform === 'main' ? 'main' : 'test';
  const gchatParam = String(req.query.gchat || '').toLowerCase();
  const wantsGchat = gchatParam !== '0' && gchatParam !== 'false' && gchatParam !== 'off';

  const dashboardUrl = req.protocol + '://' + req.get('host');
  const nowIso = new Date().toISOString();

  // Prefer GitHub Actions dispatch when credentials are configured — this is
  // the Render-friendly path (Render's 512MB tier can't run Cypress locally,
  // but GitHub Actions runners have 7GB RAM and 4 cores). The workflow itself
  // posts the report to Google Chat, so this endpoint just fires the trigger
  // and returns immediately. Local spawn is used only when GH creds are absent
  // (e.g., running the form-server on your laptop for development).
  if (shouldUseGitHubActionsRunner()) {
    try {
      const requestId = createRequestId();
      console.log(
        `[TRIGGER] Dispatching run-all.yml on GitHub Actions (platform=${selectedPlatform}, requestId=${requestId})`
      );
      const dispatchResult = await dispatchGitHubWorkflow({
        mode: 'run_all',
        platform: selectedPlatform,
        requestId,
      });
      const workflowRunsUrl = buildWorkflowRunsUrl(
        (dispatchResult && dispatchResult.workflowFile) || 'run-all.yml'
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Run All dispatched</title></head>' +
        '<body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:20px;color:#0f172a;line-height:1.6;">' +
        '<h1 style="color:#059669;">🚀 Run All dispatched to GitHub Actions</h1>' +
        '<p>Automation is now running on the <strong>' + selectedPlatform.toUpperCase() + '</strong> platform in a GitHub Actions runner.</p>' +
        '<p>The report will arrive in Google Chat in about 20-30 minutes.</p>' +
        '<p style="margin-top:24px;">' +
        '<a href="' + workflowRunsUrl + '" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:600;">→ Watch workflow progress on GitHub Actions</a>' +
        '</p>' +
        '<p><a href="' + dashboardUrl + '" style="color:#2563eb;text-decoration:none;font-weight:600;">→ Open dashboard</a></p>' +
        '<hr style="margin-top:40px;border:0;border-top:1px solid #e5e7eb;">' +
        '<p style="color:#64748b;font-size:12px;">Triggered ' + nowIso + '  ·  Request id: <code>' + requestId + '</code></p>' +
        '</body></html>'
      );
      return;
    } catch (err) {
      console.error('[TRIGGER] GitHub Actions dispatch failed:', err.message);
      res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        '<!doctype html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px;">' +
        '<h1 style="color:#dc2626;">Dispatch failed</h1>' +
        '<p>' + String(err.message || err).replace(/</g, '&lt;') + '</p>' +
        '<p style="color:#64748b;font-size:12px;">Check GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO env vars.</p>' +
        '</body></html>'
      );
    }
  }

  // Local fallback — only when GH creds are NOT set. Runs Cypress on this
  // machine (won't work on Render Starter tier — 512MB RAM is not enough).
  console.log(
    `[TRIGGER] GH creds not set — running Run All locally (platform=${selectedPlatform}, gchat=${wantsGchat})`
  );

  executeRunAll({ selectedPlatform, wantsGchat, onProgress: null })
    .then(() => console.log('[TRIGGER] Local Run All completed'))
    .catch((err) => console.error('[TRIGGER] Local Run All failed:', err));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    '<!doctype html><html><head><meta charset="utf-8"><title>Run All started</title></head>' +
    '<body style="font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:20px;color:#0f172a;line-height:1.6;">' +
    '<h1 style="color:#059669;">🚀 Run All started (local)</h1>' +
    '<p>Running on the <strong>' + selectedPlatform.toUpperCase() + '</strong> platform.</p>' +
    '<p>' + (wantsGchat
      ? 'The report will arrive in Google Chat in about 15-25 minutes.'
      : 'Google Chat notification is disabled for this run (?gchat=0).') + '</p>' +
    '<p style="margin-top:30px;"><a href="' + dashboardUrl + '" style="color:#2563eb;text-decoration:none;font-weight:600;">→ Open dashboard</a></p>' +
    '<hr style="margin-top:40px;border:0;border-top:1px solid #e5e7eb;">' +
    '<p style="color:#64748b;font-size:12px;">Triggered ' + nowIso + '</p>' +
    '</body></html>'
  );
});

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
  const isSmblMode = modeConfig.isSmbl === true;
  const isKsliveMode = modeConfig.isKslive === true;
  const isLinksMode = modeConfig.isLinks === true;
  // linksPages (optional) — comma-separated page IDs to crawl. If omitted, the
  // spec crawls all pages. Pulled from req.body for the links mode only.
  const linksPagesInput =
    isLinksMode && req.body && req.body.pages
      ? String(req.body.pages).trim()
      : '';
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

  // Lead-input validation runs in MLP / ALM / SMBL / KS Live.
  // Callback / SEO / Links skip validation entirely.
  //
  // MLP / ALM / SMBL need the full 5-field set (base + different) because
  // their specs exercise edge cases like "base email + different phone".
  // KS Live now runs a single smoke registration, so it only needs
  // name + baseEmail + basePhone.
  if (!isSeoMode && !isCallbackMode && !isLinksMode) {
    if (!trimmedName || !trimmedBaseEmail || !trimmedBasePhone) {
      return res.status(400).json({
        ok: false,
        message: 'name, baseEmail, and basePhone are required.',
      });
    }

    if (!isKsliveMode) {
      if (!trimmedDifferentEmail || !trimmedDifferentPhone) {
        return res.status(400).json({
          ok: false,
          message:
            'differentEmail and differentPhone are required for MLP / ALM / SMBL edge-case tests.',
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
  }
  // Callback / SEO / Links: no input validation.

  const fixtureData =
    isSeoMode || isCallbackMode || isKsliveMode || isLinksMode
      ? null
      : buildFixtureFromForm({
          name: trimmedName,
          baseEmail: trimmedBaseEmail,
          basePhone: trimmedBasePhone,
          differentEmail: trimmedDifferentEmail,
          differentPhone: trimmedDifferentPhone,
        });

  if (isLinksMode) {
    // Broken Link Checker — no fixture, no leads. Write the selected page
    // IDs to a config file (read by cypress.config.js setupNodeEvents) so
    // the spec can pick them up via Cypress.env('linksPages') without us
    // having to squeeze a comma-separated list through --env (which breaks
    // on Windows because cmd.exe treats | as a pipe and Cypress treats ,
    // as the key=value separator).
    try {
      const reportsDir = path.dirname(BROKEN_LINKS_RESULTS_FILE);
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
      const pageIds = linksPagesInput
        ? linksPagesInput.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      fs.writeFileSync(
        LINKS_SELECTED_PAGES_FILE,
        JSON.stringify({ pages: pageIds }, null, 2)
      );
      // Clear stale broken-links-results.json so the dashboard doesn't render
      // a previous run's data while the new crawl is in progress.
      if (fs.existsSync(BROKEN_LINKS_RESULTS_FILE)) {
        fs.writeFileSync(BROKEN_LINKS_RESULTS_FILE, '[]');
      }
    } catch (_err) { /* noop */ }
  } else if (isKsliveMode) {
    // KS Live — event registration; no lead-delete API. Simplified single-
    // test flow means fixture only needs name/baseEmail/basePhone/otp.
    // Different email/phone fields are no longer required (spec doesn't use
    // them since edge-case tests were removed).
    try {
      const fixtureDir = path.dirname(modeConfig.fixturePath);
      if (!fs.existsSync(fixtureDir)) {
        fs.mkdirSync(fixtureDir, { recursive: true });
      }
      const ksLiveFixture = {
        name: trimmedName,
        baseEmail: trimmedBaseEmail,
        basePhone: trimmedBasePhone,
        otp: '159753',
      };
      fs.writeFileSync(modeConfig.fixturePath, JSON.stringify(ksLiveFixture, null, 2));
    } catch (err) {
      console.error('Error writing KS Live fixture file:', err);
      return res.status(500).json({
        ok: false,
        message: 'Failed to write KS Live fixture file',
      });
    }
  } else if (!isSeoMode && !isCallbackMode) {
    // MLP / ALM / SMBL — full lead-form fixture + lead deletion + per-mode fixture file.
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

      // Callback mode has no input fields on the dashboard — the local spec
      // reads name/email/phone straight from the MLP fixture. For the
      // GitHub Actions dispatch we need real values to send as inputs
      // (the workflow declares them as required), so we read the MLP
      // fixture file here and forward those values to the workflow.
      let dispatchName = trimmedName;
      let dispatchBaseEmail = trimmedBaseEmail;
      let dispatchBasePhone = trimmedBasePhone;
      if (isCallbackMode) {
        if (!fs.existsSync(FIXTURE_PATH_MLP)) {
          return res.status(400).json({
            ok: false,
            message:
              'Callback (GitHub Actions): cypress/fixtures/mlp/mlpTestData.json is missing. Fill the MLP form fields and run MLP at least once so the fixture has real values, then re-run Callback.',
          });
        }
        try {
          const mlpFixture = JSON.parse(fs.readFileSync(FIXTURE_PATH_MLP, 'utf8'));
          dispatchName = mlpFixture.name || dispatchName;
          dispatchBaseEmail = mlpFixture.existingEmail || dispatchBaseEmail;
          dispatchBasePhone = mlpFixture.existingPhone || dispatchBasePhone;
        } catch (err) {
          return res.status(500).json({
            ok: false,
            message: `Callback: could not read MLP fixture: ${err.message}`,
          });
        }
        if (!dispatchName || !dispatchBaseEmail || !dispatchBasePhone) {
          return res.status(400).json({
            ok: false,
            message:
              'Callback (GitHub Actions): MLP fixture is missing name / existingEmail / existingPhone. Fill the MLP form and run MLP first.',
          });
        }
      }

      const dispatchResult = await dispatchGitHubWorkflow({
        mode: selectedMode,
        platform: selectedPlatform,
        name: dispatchName,
        baseEmail: dispatchBaseEmail,
        basePhone: dispatchBasePhone,
        differentEmail: trimmedDifferentEmail,
        differentPhone: trimmedDifferentPhone,
        requestId,
        linksPages: linksPagesInput,
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
  // Links mode reads its selected-page list from
  // cypress/reports/links-selected-pages.json (written above and picked up by
  // setupNodeEvents in cypress.config.js). We don't push linksPages onto
  // --env here because comma-separated lists break Cypress's --env parser
  // and pipe-separated lists break Windows cmd.exe.
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
    if (isLinksMode) parsed = attachBrokenLinksResults(parsed);
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
    // Fetch logs + artifacts in parallel — artifacts contain the JSON files
    // (api-monitor / pixel-monitor / seo-results) that drive the rich UI.
    const [logText, artifactZip] = await Promise.all([
      fetchWorkflowRunLogs(run.id),
      fetchWorkflowArtifacts(run.id).catch((err) => {
        console.error('[RUN] Could not fetch artifacts for run', run.id, '—', err.message);
        return null;
      }),
    ]);
    const exitCode = run.conclusion === 'success' ? 0 : 1;
    const parsed = parseCypressOutputToDashboardData({
      output: logText,
      code: exitCode,
      fixtureData: job.fixtureData,
      selectedPlatform: job.selectedPlatform,
      selectedBaseUrl: job.selectedBaseUrl,
    });
    // Enrich with the same data the local-run flow attaches — per-test
    // apiCalls, aggregated pixelEvents, seoResults.
    attachRemoteMonitoringData(parsed, artifactZip);
    // Attach mode metadata so form.html's renderers route to the right view
    // (SEO panel vs. test list, runLabel pill, expectedTestCount, etc.).
    const jobMode = job.runMode;
    const jobModeConfig = jobMode && MODES[jobMode];
    if (jobModeConfig) {
      parsed.runMode = jobMode;
      parsed.runLabel = jobModeConfig.label;
      parsed.expectedTestCount = jobModeConfig.expectedTestCount;
      parsed.pixelEnabled = jobModeConfig.pixelEnabled;
    }
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

