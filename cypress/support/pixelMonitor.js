// Meta Pixel monitor — captures requests to facebook.com/tr/ and extracts the
// pixel ID (`id`) and event name (`ev`) from the query string.
//
// Per spec: pixel events are identical regardless of test data, so we only need
// to capture them ONCE per Cypress run (during the first edge case). Subsequent
// tests skip pixel capture entirely.
//
// "First test" coordination is done via cy.task('pixelClaimFirstSlot') — the Node
// task atomically returns true exactly once per run.

const PIXEL_URL_REGEX = /facebook\.com\/tr\/?(?:\?|$)/i;

function getCaptureBucket() {
  return Cypress.env('__pixelMonitorCalls') || [];
}

function setCaptureBucket(calls) {
  Cypress.env('__pixelMonitorCalls', calls);
}

function isPixelCaptureActive() {
  return Cypress.env('__pixelCaptureActive') === true;
}

function recordPixelCall(req) {
  let pixelId = '';
  let eventName = '';
  let sourceUrl = '';
  let queryString = '';

  // Primary: extract id / ev / dl from URL query params. This is how Meta
  // Pixel sends most browser pixel calls (GET to /tr/?id=X&ev=Y&dl=Z).
  try {
    const urlObj = new URL(req.url);
    pixelId = urlObj.searchParams.get('id') || '';
    eventName = urlObj.searchParams.get('ev') || '';
    // `dl` (document location) is the URL of the page that fired the pixel.
    // Used to distinguish fires from the page under test vs. post-redirect
    // pages (e.g. /screening-test/... fires its own PageView on load).
    sourceUrl = urlObj.searchParams.get('dl') || '';
    queryString = urlObj.search || '';
  } catch (_err) {
    /* ignore malformed URL */
  }

  // Fallback: some Meta Pixel calls fire as POST with id/ev/dl in the request
  // body (advanced-matching enabled, large payloads, etc.). The URL-only
  // extractor above misses them and the aggregator then skips them as empty.
  // Parsing the body here only fills fields the URL didn't have — never
  // overwrites good URL data, wrapped in try/catch so any unexpected body
  // shape silently leaves the field empty (no spec-breaking side-effect).
  if (!pixelId || !eventName || !sourceUrl) {
    try {
      const body = req.body;
      if (typeof body === 'string' && body.length > 0) {
        const params = new URLSearchParams(body);
        if (!pixelId) pixelId = params.get('id') || '';
        if (!eventName) eventName = params.get('ev') || '';
        if (!sourceUrl) sourceUrl = params.get('dl') || '';
      } else if (body && typeof body === 'object') {
        if (!pixelId && body.id != null) pixelId = String(body.id);
        if (!eventName && body.ev != null) eventName = String(body.ev);
        if (!sourceUrl && body.dl != null) sourceUrl = String(body.dl);
      }
    } catch (_err) {
      /* leave fields empty if body is unparseable */
    }
  }

  const calls = getCaptureBucket();
  calls.push({
    pixelId,
    eventName,
    sourceUrl,
    method: (req.method || 'GET').toUpperCase(),
    url: String(req.url || ''),
    queryString,
    timestamp: new Date().toISOString(),
  });
  setCaptureBucket(calls);
}

beforeEach(() => {
  setCaptureBucket([]);
  Cypress.env('__pixelCaptureActive', false);

  // Run-level kill switch: form-server passes `--env disablePixel=true` for
  // ALM runs (the user opted out of pixel checks for ALM). Default off, so
  // MLP runs continue to capture exactly as before.
  if (Cypress.env('disablePixel') === true || Cypress.env('disablePixel') === 'true') {
    return;
  }


  cy.task('pixelClaimFirstSlot', null, { log: false }).then((claimed) => {
    if (!claimed) return;
    Cypress.env('__pixelCaptureActive', true);
    cy.intercept({ url: PIXEL_URL_REGEX }, (req) => {
      recordPixelCall(req);
    }).as('pixelMonitor');
  });
});

afterEach(function () {
  if (!isPixelCaptureActive()) return;

  const test = this.currentTest;
  if (!test) return;

  const entry = {
    testTitle: test.title,
    testFullTitle:
      typeof test.fullTitle === 'function' ? test.fullTitle() : test.title,
    pixelCalls: getCaptureBucket(),
    timestamp: new Date().toISOString(),
  };

  cy.task('pixelMonitorAppend', entry, { log: false });
});
