// Lead cleanup (delete API) and backend API verification.
//
// Cleanup goes through cy.request, so it bypasses cy.intercept and never shows
// up as a page API call. Every cleanup response is checked: a test never runs
// on top of state it failed to reset.

const CALLS = '__apiCalls';

function apiBase() {
  return Cypress.env('apiBase');
}

function apiHostPattern() {
  const host = new URL(apiBase()).host.replace(/\./g, '\\.');
  return new RegExp(`^https?://${host}/`);
}

function responseMessage(body) {
  if (body && typeof body === 'object' && body.message != null) return String(body.message).slice(0, 160);
  if (typeof body === 'string') return body.slice(0, 160);
  return '';
}

// Record every call the page makes to the Kraftshala backend.
beforeEach(() => {
  globalThis[CALLS] = [];
  cy.intercept({ url: apiHostPattern() }, (req) => {
    // Recorded when sent, so a request that never gets a response still shows up.
    const call = { method: req.method, path: new URL(req.url).pathname, status: null, startedAt: Date.now() };
    globalThis[CALLS].push(call);
    req.on('response', (res) => {
      Object.assign(call, {
        status: res.statusCode,
        durationMs: Date.now() - call.startedAt,
        message: responseMessage(res.body),
      });
    });
  });
});

afterEach(() => {
  const detail = globalThis.testDetail();
  if (!detail || detail.kind !== 'lead') return;
  // Full backend trace for debugging; kept in the JSON, not shown on the dashboard.
  detail.apiTrace = globalThis[CALLS];
  const now = Date.now();
  const hung = globalThis[CALLS].filter((c) => c.status === null && c.method !== 'GET');
  if (hung.length) {
    detail.notes = (detail.notes || []).concat(
      hung.map((c) => `Backend never answered ${c.method} ${c.path} (waited ${Math.round((now - c.startedAt) / 1000)}s)`)
    );
  }
  // A backend error during the test is worth seeing even when it is not the asserted call.
  const errors = globalThis[CALLS].filter((c) => c.status >= 400 && !(detail.api || []).some((a) => a.status === c.status));
  if (errors.length) {
    detail.notes = (detail.notes || []).concat(
      errors.map((c) => `Backend error: ${c.method} ${c.path} -> HTTP ${c.status} ${c.message || ''}`.trim())
    );
  }
});

function pushDetail(field, item) {
  const detail = globalThis.testDetail();
  detail[field] = detail[field] || [];
  detail[field].push(item);
}

/**
 * Delete leads (by email, per programme) and free phone numbers before a test.
 * "Not found" counts as clean — the state the test needs is already there.
 */
Cypress.Commands.add('cleanupLead', ({ programSlug, emails = [], phones = [] }) => {
  const targets = [
    ...emails.map((email) => ({
      target: `remove-lead (${programSlug})`,
      identifier: email,
      url: `${apiBase()}/lead/remove-lead/${programSlug}/${encodeURIComponent(email)}`,
      isOk: (res, msg) => res.status === 200 && (!/failure/i.test(msg) || /lead not found/i.test(msg)),
    })),
    ...phones.map((phone) => ({
      target: 'removeNumber',
      identifier: phone,
      url: `${apiBase()}/otp-validation/removeNumber/${encodeURIComponent(phone)}`,
      isOk: (res, msg) => res.status === 200 || (res.status === 400 && /not found/i.test(msg)),
    })),
  ];

  targets.forEach((t) => {
    cy.request({ method: 'GET', url: t.url, failOnStatusCode: false, timeout: 30000, log: false }).then((res) => {
      const msg = responseMessage(res.body);
      pushDetail('cleanup', {
        target: t.target,
        identifier: t.identifier,
        status: res.status,
        message: /not found/i.test(msg) ? `Already absent (${msg})` : msg || 'Deleted',
        ok: t.isOk(res, msg),
      });
    });
  });

  cy.then(() => {
    const failed = (globalThis.testDetail().cleanup || []).filter((c) => !c.ok);
    if (failed.length) {
      throw new Error(
        `Lead cleanup failed, so the test cannot start from a clean state: ${failed
          .map((c) => `${c.target} ${c.identifier} -> HTTP ${c.status} ${c.message}`)
          .join('; ')}`
      );
    }
  });
});

// `sent`: also match requests still waiting for a response.
function findCall(method, pathRegex, since, sent = false) {
  return globalThis[CALLS].find(
    (c, i) => i >= since && (sent || c.status !== null) && c.method === method && pathRegex.test(c.path)
  );
}

/** Index to pass as `since`, so only calls made after this point are considered. */
Cypress.Commands.add('apiMark', () => cy.wrap(globalThis[CALLS].length, { log: false }));

/**
 * Yields the first completed `method path` call since `since` (with `sent`, the
 * first one sent even if unanswered), or null after `timeout` ms. Never fails.
 */
Cypress.Commands.add('waitForApi', (method, pathRegex, { since = 0, timeout = 45000, sent = false } = {}) => {
  const poll = (remaining) => {
    const call = findCall(method, pathRegex, since, sent);
    if (call || remaining <= 0) return cy.wrap(call || null, { log: false });
    return cy.wait(250, { log: false }).then(() => poll(remaining - 250));
  };
  return poll(timeout);
});

/**
 * Wait for the page to make `method path` and require a 2xx response.
 * Records the outcome under "API verification" in the report either way.
 */
Cypress.Commands.add('verifyApi', (label, method, pathRegex, { since = 0, timeout = 45000, expectOk = true } = {}) => {
  return cy.waitForApi(method, pathRegex, { since, timeout }).then((call) => {
    const is2xx = !!call && call.status >= 200 && call.status < 300;
    const ok = expectOk ? is2xx : !!call && !is2xx;
    pushDetail('api', {
      label,
      status: call ? call.status : 0,
      message: call ? call.message : `No ${method} ${pathRegex} request within ${timeout / 1000}s`,
      ok,
    });
    expect(call, `${label}: ${method} request sent`).to.not.equal(null);
    if (expectOk) expect(call.status, `${label}: HTTP status`).to.be.within(200, 299);
    else expect(call.status, `${label}: HTTP status (rejection expected)`).to.not.be.within(200, 299);
    return call;
  });
});

/** Require that the page did NOT make `method path` since `since`. */
Cypress.Commands.add('verifyNoApi', (label, method, pathRegex, { since = 0 } = {}) => {
  cy.then(() => {
    const call = findCall(method, pathRegex, since);
    pushDetail('api', {
      label,
      status: call ? call.status : 0,
      message: call ? 'Request was sent but should not have been' : 'Not sent (as expected)',
      ok: !call,
    });
    expect(call, `${label}: no ${method} request`).to.equal(undefined);
  });
});
