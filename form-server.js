const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { spawn } = require('child_process');

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

    const stripAnsi = (value) =>
      String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
    const cleanedOutput = stripAnsi(output);
    const lines = cleanedOutput.split(/\r?\n/).filter(Boolean);
    // Drop noisy warning / deprecation lines so UI shows mostly test results
    const signalLines = lines.filter(
      (line) => !/WARN|WARNING|DEPRECATION/i.test(line)
    );
    // Only parse lines from the test-list section (before "N passing" summary).
    // After that line Cypress prints error details which would cause duplicates.
    const tests = [];
    for (const line of signalLines) {
      if (/^\s*\d+\s+passing/i.test(line)) {
        break;
      }

      const passMatch = line.match(/^\s*[✓✔√]\s+(.*?)(\s+\(|$)/);
      if (passMatch) {
        tests.push({ name: passMatch[1].trim(), status: 'passed' });
        continue;
      }

      const failMatch = line.match(/^\s*\d+\)\s+(.*)$/);
      if (failMatch) {
        tests.push({ name: failMatch[1].trim(), status: 'failed' });
        continue;
      }
    }

    const leadDetailsFromName = (name) => {
      const n = String(name || '').toLowerCase();
      if (n.includes('new registration')) {
        return { email: fixtureData.newEmail, phone: fixtureData.newPhone };
      }
      if (n.includes('existing registration')) {
        return { email: fixtureData.existingEmail, phone: fixtureData.existingPhone };
      }
      if (n.includes('base email with different phone number')) {
        return {
          email: fixtureData.sameEmailDifferentPhone.email,
          phone: fixtureData.sameEmailDifferentPhone.phone,
        };
      }
      if (n.includes('base phone number with different email')) {
        return {
          email: fixtureData.samePhoneDifferentEmail.email,
          phone: fixtureData.samePhoneDifferentEmail.phone,
        };
      }
      if (n.includes('invalid email')) {
        return {
          email: fixtureData.invalidEmails[0],
          phone: fixtureData.existingPhone,
        };
      }
      if (n.includes('invalid phone')) {
        return {
          email: fixtureData.existingEmail,
          phone: fixtureData.invalidPhones[1],
        };
      }
      if (n.includes('submitting empty form')) {
        return { email: '', phone: '' };
      }
      return { email: '', phone: '' };
    };

    const expectsScreeningUrl = (name) => {
      const n = String(name || '').toLowerCase();
      if (n.includes('base email with different phone')) {
        return false;
      }
      if (n.includes('invalid email') || n.includes('invalid phone')) {
        return false;
      }
      if (n.includes('submitting empty form')) {
        return false;
      }
      return true;
    };

    const isUrlSuccessCase = (name) => {
      const n = String(name || '').toLowerCase();
      return (
        n.includes('new registration') ||
        n.includes('existing registration') ||
        n.includes('base phone number with different email')
      );
    };

    /** What “PASS” means for end users: real registration vs blocked vs validation only. */
    const registrationExpectationFromName = (name) => {
      const n = String(name || '').toLowerCase();
      if (n.includes('base email with different phone')) {
        return 'blocked_after_otp';
      }
      if (
        n.includes('invalid email') ||
        n.includes('invalid phone') ||
        n.includes('submitting empty form')
      ) {
        return 'validation_only';
      }
      if (
        n.includes('new registration') ||
        n.includes('existing registration') ||
        n.includes('base phone number with different email')
      ) {
        return 'screening_url';
      }
      return 'other';
    };

    const userRegistrationPassFrom = (t, registrationStatus, expectation) => {
      if (expectation === 'screening_url') {
        return registrationStatus === 'registered';
      }
      return t.status === 'passed';
    };

    const testsWithContext = tests.map((t) => {
      const urlSuccessCase = isUrlSuccessCase(t.name);
      const expectUrl = expectsScreeningUrl(t.name);
      const registrationStatus =
        urlSuccessCase && t.status === 'passed' ? 'registered' : 'not_registered';
      const registrationExpectation = registrationExpectationFromName(t.name);
      const userRegistrationPass = userRegistrationPassFrom(
        t,
        registrationStatus,
        registrationExpectation
      );
      return {
        ...t,
        caseType: expectUrl ? 'registration' : 'validation',
        expectsScreeningUrl: expectUrl,
        isRegistrationUrlCase: urlSuccessCase,
        registrationExpectation,
        userRegistrationPass,
        urlCheck: registrationStatus === 'registered' ? 'url_found' : 'url_not_found',
        registrationStatus,
        lead: leadDetailsFromName(t.name),
      };
    });

    const parsedTotal = testsWithContext.length;
    const parsedPassed = testsWithContext.filter((t) => t.status === 'passed').length;
    const parsedFailed = testsWithContext.filter((t) => t.status === 'failed').length;

    const summaryPassingMatch = cleanedOutput.match(/(\d+)\s+passing/i);
    const summaryFailingMatch = cleanedOutput.match(/(\d+)\s+failing/i);
    const summaryPassed = summaryPassingMatch ? Number(summaryPassingMatch[1]) : null;
    const summaryFailed = summaryFailingMatch ? Number(summaryFailingMatch[1]) : null;

    const automationPassed = parsedPassed || (summaryPassed ?? 0);
    const automationFailed = parsedFailed || (summaryFailed ?? (code === 0 ? 0 : 1));
    const total = parsedTotal || (summaryPassed !== null || summaryFailed !== null
      ? (summaryPassed || 0) + (summaryFailed || 0)
      : automationPassed + automationFailed);
    const urlIntentTests = testsWithContext.filter((t) => isUrlSuccessCase(t.name));
    const registrationUrlAttempts = urlIntentTests.length;
    const registrationUrlSuccess = urlIntentTests.filter(
      (t) => t.registrationStatus === 'registered'
    ).length;

    const userRegistrationSuccess = testsWithContext.filter(
      (t) => t.userRegistrationPass
    ).length;
    const userRegistrationAttempts = testsWithContext.length;
    const allUserRegistrationOk =
      userRegistrationAttempts > 0 &&
      userRegistrationSuccess === userRegistrationAttempts;

    console.log('Lead URL-verification summary:');
    for (const t of testsWithContext) {
      const email = t.lead?.email || '-';
      const phone = t.lead?.phone || '-';
      const reg = t.registrationStatus === 'registered' ? 'URL_FOUND' : 'URL_NOT_FOUND';
      const auto = t.status === 'passed' ? 'AUTO_PASS' : 'AUTO_FAIL';
      console.log(`- ${t.name} | ${email} | ${phone} | ${reg} | ${auto}`);
    }

    res.json({
      ok: code === 0,
      message:
        code === 0
          ? `Lead outcomes (expected registration / block / validation): ${userRegistrationSuccess}/${userRegistrationAttempts}. Screening URL (3 registration flows): ${registrationUrlSuccess}/${registrationUrlAttempts}. Cypress: ${automationPassed}/${total}.`
          : `Cypress run failed (exit code ${code}).`,
      exitCode: code,
      platform: selectedPlatform,
      baseUrl: selectedBaseUrl,
      tests: testsWithContext.map((t) => ({
        ...t,
        leadRegisteredWithUrl: t.registrationStatus === 'registered',
      })),
      totals: {
        total,
        automationPassed,
        automationFailed,
        registrationUrlSuccess,
        registrationUrlAttempts,
        /** true when every registration-URL test reached the screening URL */
        allRegistrationUrlsOk:
          registrationUrlAttempts > 0 &&
          registrationUrlSuccess === registrationUrlAttempts,
        userRegistrationSuccess,
        userRegistrationAttempts,
        /** true when every test met its intended outcome (register, block, or validate) */
        allUserRegistrationOk,
      },
    });
  });
});

app.listen(PORT, () => {
  console.log(`MLP form server running at http://localhost:${PORT}`);
});

