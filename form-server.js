const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
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

const FIXTURE_PATH = path.join(
  __dirname,
  'cypress',
  'fixtures',
  'mlpTestData.json'
);
const GITHUB_OWNER = process.env.GITHUB_OWNER || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_WORKFLOW_FILE = process.env.GITHUB_WORKFLOW_FILE || 'mlp-run.yml';
const GITHUB_REF = process.env.GITHUB_REF || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const workflowRunsUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}`;
const githubRunJobs = new Map();

app.use(express.json());

app.get('/', (req, res) => {
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
  platform,
  name,
  baseEmail,
  basePhone,
  differentEmail,
  differentPhone,
  requestId,
}) {
  const dispatchUrl = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(GITHUB_REPO)}/actions/workflows/${encodeURIComponent(
    GITHUB_WORKFLOW_FILE
  )}/dispatches`;
  const resp = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'mlp-form-server',
    },
    body: JSON.stringify({
      ref: GITHUB_REF,
      inputs: {
        platform,
        name,
        baseEmail,
        basePhone,
        differentEmail,
        differentPhone,
        requestId,
      },
    }),
  });
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error(`GitHub workflow dispatch failed (${resp.status}): ${bodyText || 'no response body'}`);
  }
}

function parseCypressOutputToDashboardData({ output, code, fixtureData, selectedPlatform, selectedBaseUrl }) {
  const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
  const cleanedOutput = stripAnsi(output);
  const lines = cleanedOutput.split(/\r?\n/).filter(Boolean);
  const signalLines = lines.filter((line) => !/WARN|WARNING|DEPRECATION/i.test(line));
  const tests = [];
  for (const line of signalLines) {
    if (/^\s*\d+\s+passing/i.test(line)) break;
    const passMatch = line.match(/^\s*[✓✔√]\s+(.*?)(\s+\(|$)/);
    if (passMatch) {
      tests.push({ name: passMatch[1].trim(), status: 'passed' });
      continue;
    }
    const failMatch = line.match(/^\s*\d+\)\s+(.*)$/);
    if (failMatch) tests.push({ name: failMatch[1].trim(), status: 'failed' });
  }

  const leadDetailsFromName = (name) => {
    const n = String(name || '').toLowerCase();
    if (n.includes('new registration')) return { email: fixtureData.newEmail, phone: fixtureData.newPhone };
    if (n.includes('existing registration')) return { email: fixtureData.existingEmail, phone: fixtureData.existingPhone };
    if (n.includes('base email with different phone number')) return { email: fixtureData.sameEmailDifferentPhone.email, phone: fixtureData.sameEmailDifferentPhone.phone };
    if (n.includes('base phone number with different email')) return { email: fixtureData.samePhoneDifferentEmail.email, phone: fixtureData.samePhoneDifferentEmail.phone };
    if (n.includes('invalid email')) return { email: fixtureData.invalidEmails[0], phone: fixtureData.existingPhone };
    if (n.includes('invalid phone')) return { email: fixtureData.existingEmail, phone: fixtureData.invalidPhones[1] };
    if (n.includes('submitting empty form')) return { email: '', phone: '' };
    return { email: '', phone: '' };
  };
  const isUrlSuccessCase = (name) => {
    const n = String(name || '').toLowerCase();
    return n.includes('new registration') || n.includes('existing registration') || n.includes('base phone number with different email');
  };
  const registrationExpectationFromName = (name) => {
    const n = String(name || '').toLowerCase();
    if (n.includes('base email with different phone')) return 'blocked_after_otp';
    if (n.includes('invalid email') || n.includes('invalid phone') || n.includes('submitting empty form')) return 'validation_only';
    if (isUrlSuccessCase(name)) return 'screening_url';
    return 'other';
  };

  const testsWithContext = tests.map((t) => {
    const registrationStatus = isUrlSuccessCase(t.name) && t.status === 'passed' ? 'registered' : 'not_registered';
    const registrationExpectation = registrationExpectationFromName(t.name);
    const userRegistrationPass =
      registrationExpectation === 'screening_url' ? registrationStatus === 'registered' : t.status === 'passed';
    return {
      ...t,
      isRegistrationUrlCase: isUrlSuccessCase(t.name),
      registrationExpectation,
      userRegistrationPass,
      registrationStatus,
      lead: leadDetailsFromName(t.name),
      leadRegisteredWithUrl: registrationStatus === 'registered',
    };
  });

  const parsedPassed = testsWithContext.filter((t) => t.status === 'passed').length;
  const parsedFailed = testsWithContext.filter((t) => t.status === 'failed').length;
  const summaryPassed = Number((cleanedOutput.match(/(\d+)\s+passing/i) || [])[1] || 0);
  const summaryFailed = Number((cleanedOutput.match(/(\d+)\s+failing/i) || [])[1] || 0);
  const automationPassed = parsedPassed || summaryPassed;
  const automationFailed = parsedFailed || summaryFailed || (code === 0 ? 0 : 1);
  const total = testsWithContext.length || summaryPassed + summaryFailed || automationPassed + automationFailed;
  const urlIntentTests = testsWithContext.filter((t) => t.isRegistrationUrlCase);
  const registrationUrlAttempts = urlIntentTests.length;
  const registrationUrlSuccess = urlIntentTests.filter((t) => t.registrationStatus === 'registered').length;
  const userRegistrationSuccess = testsWithContext.filter((t) => t.userRegistrationPass).length;
  const userRegistrationAttempts = testsWithContext.length;
  const allUserRegistrationOk = userRegistrationAttempts > 0 && userRegistrationSuccess === userRegistrationAttempts;

  return {
    ok: code === 0,
    message:
      code === 0
        ? `Lead outcomes (expected registration / block / validation): ${userRegistrationSuccess}/${userRegistrationAttempts}. Screening URL (3 registration flows): ${registrationUrlSuccess}/${registrationUrlAttempts}. Cypress: ${automationPassed}/${total}.`
        : `Cypress run failed (exit code ${code}).`,
    exitCode: code,
    platform: selectedPlatform,
    baseUrl: selectedBaseUrl,
    tests: testsWithContext,
    totals: {
      total,
      automationPassed,
      automationFailed,
      registrationUrlSuccess,
      registrationUrlAttempts,
      allRegistrationUrlsOk: registrationUrlAttempts > 0 && registrationUrlSuccess === registrationUrlAttempts,
      userRegistrationSuccess,
      userRegistrationAttempts,
      allUserRegistrationOk,
    },
  };
}

async function findWorkflowRunByRequestId(requestId) {
  const listUrl = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(
    GITHUB_REPO
  )}/actions/workflows/${encodeURIComponent(
    GITHUB_WORKFLOW_FILE
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
  const { name, baseEmail, basePhone, differentEmail, differentPhone, platform } =
    req.body || {};
  console.log('[UI] /prepare-tests request received');
  console.log(
    `[UI] Inputs => platform=${platform || 'test'}, baseEmail=${baseEmail || '-'}, basePhone=${basePhone || '-'}, differentEmail=${differentEmail || '-'}, differentPhone=${differentPhone || '-'}`
  );
  const selectedPlatform =
    String(platform || 'test').toLowerCase() === 'main' ? 'main' : 'test';
  const selectedBaseUrl =
    selectedPlatform === 'main'
      ? MAIN_PLATFORM_BASE_URL
      : TEST_PLATFORM_BASE_URL;
  const selectedDeleteBases =
    selectedPlatform === 'main'
      ? {
          emailDeleteBase: MAIN_EMAIL_DELETE_BASE,
          phoneDeleteBase: MAIN_PHONE_DELETE_BASE,
        }
      : {
          emailDeleteBase: TEST_EMAIL_DELETE_BASE,
          phoneDeleteBase: TEST_PHONE_DELETE_BASE,
        };

  const trimmedName = name != null ? String(name).trim() : '';
  const trimmedBaseEmail = baseEmail != null ? String(baseEmail).trim() : '';
  const trimmedBasePhone = basePhone != null ? String(basePhone).trim() : '';
  const trimmedDifferentEmail = differentEmail != null ? String(differentEmail).trim() : '';
  const trimmedDifferentPhone = differentPhone != null ? String(differentPhone).trim() : '';

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

  const fixtureData = buildFixtureFromForm({
    name: trimmedName,
    baseEmail: trimmedBaseEmail,
    basePhone: trimmedBasePhone,
    differentEmail: trimmedDifferentEmail,
    differentPhone: trimmedDifferentPhone,
  });

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
    fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixtureData, null, 2));
  } catch (err) {
    console.error('Error writing fixture file:', err);
    return res.status(500).json({
      ok: false,
      message: 'Failed to write fixture file',
    });
  }

  if (shouldUseGitHubActionsRunner()) {
    try {
      const requestId = createRequestId();
      await dispatchGitHubWorkflow({
        platform: selectedPlatform,
        name: trimmedName,
        baseEmail: trimmedBaseEmail,
        basePhone: trimmedBasePhone,
        differentEmail: trimmedDifferentEmail,
        differentPhone: trimmedDifferentPhone,
        requestId,
      });
      githubRunJobs.set(requestId, {
        requestId,
        fixtureData,
        selectedPlatform,
        selectedBaseUrl,
        status: 'queued',
        result: null,
        runId: null,
      });
      console.log('[RUN] Workflow dispatched to GitHub Actions');
      return res.json({
        ok: true,
        mode: 'github_actions',
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
        workflowRunsUrl,
      });
    } catch (err) {
      console.error('[RUN] Failed to dispatch GitHub workflow:', err.message);
      return res.status(500).json({
        ok: false,
        message: `Failed to trigger GitHub Actions: ${err.message}`,
      });
    }
  }

  const cypressCmd = process.env.MLP_CYPRESS_CMD || 'npx';
  const cypressArgs = [
    '--spec',
    'cypress/e2e/mlpLeadForm.cy.js',
    '--config',
    `baseUrl=${selectedBaseUrl}`,
    '--env',
    `platform=${selectedPlatform}`,
  ];
  const finalCypressArgs =
    cypressCmd === 'npx'
      ? ['cypress', 'run', ...cypressArgs]
      : ['run', ...cypressArgs];

  const child = spawn(cypressCmd, finalCypressArgs, {
    cwd: __dirname,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(
    `[RUN] Starting Cypress: ${cypressCmd} ${finalCypressArgs.join(' ')}`
  );

  let output = '';
  let responseSent = false;

  child.on('error', (err) => {
    console.error('[RUN] Cypress spawn failed:', err);
    if (responseSent) {
      return;
    }
    responseSent = true;
    return res.status(500).json({
      ok: false,
      message: `Failed to start Cypress: ${err.message}`,
      exitCode: null,
      platform: selectedPlatform,
      baseUrl: selectedBaseUrl,
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
    });
  });

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

  child.on('exit', (code) => {
    if (responseSent) {
      return;
    }
    responseSent = true;
    console.log(`Cypress run finished with code ${code}`);

    const parsed = parseCypressOutputToDashboardData({
      output,
      code,
      fixtureData,
      selectedPlatform,
      selectedBaseUrl,
    });
    console.log('Lead URL-verification summary:');
    for (const t of parsed.tests || []) {
      const email = t.lead?.email || '-';
      const phone = t.lead?.phone || '-';
      const reg = t.registrationStatus === 'registered' ? 'URL_FOUND' : 'URL_NOT_FOUND';
      const auto = t.status === 'passed' ? 'AUTO_PASS' : 'AUTO_FAIL';
      console.log(`- ${t.name} | ${email} | ${phone} | ${reg} | ${auto}`);
    }
    res.json(parsed);
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
  try {
    const run = await findWorkflowRunByRequestId(requestId);
    if (!run) {
      return res.json({
        ok: true,
        mode: 'github_actions',
        state: 'queued',
        message: 'Workflow is still being queued on GitHub Actions...',
        workflowRunsUrl,
      });
    }
    job.runId = run.id;
    job.status = run.status;
    const workflowRunUrl = run.html_url || workflowRunsUrl;
    if (run.status !== 'completed') {
      return res.json({
        ok: true,
        mode: 'github_actions',
        state: 'running',
        message: 'Workflow is running on GitHub Actions...',
        workflowRunUrl,
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
      workflowRunsUrl,
    });
  }
});

app.listen(PORT, () => {
  console.log(`MLP form server running at http://localhost:${PORT}`);
});

