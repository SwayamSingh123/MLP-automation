// API monitoring layer for MLP Cypress tests.
// - Intercepts POST /lead/create and POST /otp-validation/validate on any host.
// - Captures payload, response, status, and duration for every matched call.
// - After each test, sends the capture to Node via cy.task so the form server can
//   merge it into the UI results panel.

const LEAD_CREATE_URL_REGEX = /\/lead\/create(?:\?|$)/i;
const OTP_VALIDATE_URL_REGEX = /\/otp-validation\/validate(?:\?|$)/i;

function getCaptureBucket() {
  return Cypress.env('__apiMonitorCalls') || [];
}

function setCaptureBucket(calls) {
  Cypress.env('__apiMonitorCalls', calls);
}

function recordInterceptedCall(endpoint, req) {
  const startTime = Date.now();
  req.on('response', (res) => {
    const duration = Date.now() - startTime;
    const calls = getCaptureBucket();
    calls.push({
      endpoint,
      method: (req.method || 'POST').toUpperCase(),
      url: String(req.url || ''),
      payload: req.body != null ? req.body : null,
      response: res.body != null ? res.body : null,
      status: Number(res.statusCode) || 0,
      duration,
      timestamp: new Date().toISOString(),
    });
    setCaptureBucket(calls);
  });
}

beforeEach(() => {
  setCaptureBucket([]);

  cy.intercept({ method: 'POST', url: LEAD_CREATE_URL_REGEX }, (req) => {
    recordInterceptedCall('lead/create', req);
  }).as('apiMonitorLeadCreate');

  cy.intercept({ method: 'POST', url: OTP_VALIDATE_URL_REGEX }, (req) => {
    recordInterceptedCall('otp-validation/validate', req);
  }).as('apiMonitorOtpValidate');
});

afterEach(function () {
  const test = this.currentTest;
  if (!test) return;

  const entry = {
    testTitle: test.title,
    testFullTitle:
      typeof test.fullTitle === 'function' ? test.fullTitle() : test.title,
    testState: test.state || 'unknown',
    testError: test.err ? String(test.err.message || test.err) : null,
    apiCalls: getCaptureBucket(),
    timestamp: new Date().toISOString(),
  };

  cy.task('apiMonitorAppend', entry, { log: false });
});
