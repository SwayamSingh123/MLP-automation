/// <reference types="cypress" />
//
// Kraftshala KS Live — registration automation.
// Page (test):  https://testprogram.kraftshala.com/kraftshala-live/
// Page (prod):  https://program.kraftshala.com/kraftshala-live/
//
// Targets cards by position (NOT by label/date text):
//   1st KS Live event = .ks-live-registration-card:eq(0)
//   2nd KS Live event = .ks-live-registration-card:eq(1)
//
// Per-registration flow (every scenario):
//   1. Click the Nth card's `.register-btn` ("Register Now")
//   2. Modal opens — fill Name / Email / Phone
//   3. Click WhatsApp Yes radio
//   4. Click "Reserve my seat"
//   5. Enter master OTP and submit
//   6. Verify success: "Your Session Registration Is Confirmed! Thank you"
//
// API logging works automatically — the global cypress/support/apiMonitor.js
// intercepts /lead/create and /otp-validation/validate per test and writes
// per-test entries that form-server.js attaches to the dashboard test cards.

const ksFixture = require('../../fixtures/kslive/ksLiveTestData.json');
const mlpFixture = require('../../fixtures/mlp/mlpTestData.json');

const CARD_SELECTOR = '.ks-live-registration-card';
const REGISTER_BTN_SELECTOR = '.register-btn';
const SUCCESS_REGEX =
  /your\s+session\s+registration\s+is\s+confirmed[\s\S]*thank\s+you/i;

// Heavy third-party resources that have been observed to crash Cypress's
// Electron renderer on the KS Live page (video embeds + analytics + tracking
// pixels + chat widgets). Stubbing them out drops the page's memory footprint
// dramatically and prevents the renderer crash that ends the Cypress process.
//
// Each pattern is intercepted with a 204 stub so the page's <script>/<img>
// tags resolve quickly with no body — much lighter than letting them load.
//
// First-party Kraftshala endpoints (/lead/create, /otp-validation/*) are NOT
// in this list, so the existing apiMonitor.js continues to capture them.
const THIRD_PARTY_BLOCK_PATTERNS = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /analytics\.google\.com/i,
  /googleadservices\.com/i,
  /doubleclick\.net/i,
  /facebook\.com\/tr/i,
  /facebook\.net/i,
  /connect\.facebook\.net/i,
  /linkedin\.com\/(?:px|insight|li\.lms)/i,
  /px\.ads\.linkedin\.com/i,
  /youtube\.com\/(?:embed|iframe_api)/i,
  /vimeo\.com\/(?:video|api)/i,
  /clarity\.ms/i,
  /customer\.io/i,
  /customerlabs\.co/i,
  /hotjar\.com/i,
  /segment\.(?:com|io)/i,
  /twitter\.com\/widgets/i,
  /platform\.twitter\.com/i,
];

describe('Kraftshala KS Live — registration', () => {
  // Register the exception handler INSIDE beforeEach (not module-level) so
  // it's active before each test's first cy.visit fires the page scripts.
  // Page-side uncaught errors (GTM / Meta Pixel / etc. throwing during Gatsby
  // hydration) are suppressed here. Scoped to this spec only.
  beforeEach(() => {
    Cypress.on('uncaught:exception', () => false);

    // Stub heavy third-party requests BEFORE cy.visit so they're blocked from
    // the first page load.
    for (const pattern of THIRD_PARTY_BLOCK_PATTERNS) {
      cy.intercept(pattern, { statusCode: 204, body: '' });
    }

    cy.visit('/kraftshala-live/', {
      failOnStatusCode: false,
      // Generous load timeout — the page can be slow to hydrate.
      timeout: 60000,
    });
    cy.selectPlatformIfPresent();

    // Wait for at least one card to render before the first interaction.
    cy.get(CARD_SELECTOR, { timeout: 25000 })
      .filter(':visible')
      .should('have.length.at.least', 1);
  });

  // ── Scenarios 1-3: driven by user inputs from the dashboard form ────────

  it('Scenario 1 — 1st: new email + new number | 2nd: same email + same number', () => {
    registerOnCard(0, {
      name: ksFixture.name,
      email: ksFixture.differentEmail,
      phone: ksFixture.differentPhone,
      otp: ksFixture.otp,
    });
    registerOnCard(1, {
      name: ksFixture.name,
      email: ksFixture.differentEmail,
      phone: ksFixture.differentPhone,
      otp: ksFixture.otp,
    });
  });

  it('Scenario 2 — 1st: Email A + new number | 2nd: Email B + same number', () => {
    registerOnCard(0, {
      name: ksFixture.name,
      email: ksFixture.baseEmail,        // Email A
      phone: ksFixture.differentPhone,   // new number
      otp: ksFixture.otp,
    });
    registerOnCard(1, {
      name: ksFixture.name,
      email: ksFixture.differentEmail,   // Different Email B
      phone: ksFixture.differentPhone,   // same number as 1st
      otp: ksFixture.otp,
    });
  });

  it('Scenario 3 — 1st: Email A + new number | 2nd: same Email A + different number', () => {
    registerOnCard(0, {
      name: ksFixture.name,
      email: ksFixture.baseEmail,        // Email A
      phone: ksFixture.differentPhone,   // new number
      otp: ksFixture.otp,
    });
    registerOnCard(1, {
      name: ksFixture.name,
      email: ksFixture.baseEmail,        // same Email A
      phone: ksFixture.basePhone,        // different number
      otp: ksFixture.otp,
    });
  });

  // ── Scenario 4: driven by MLP fixture ────────────────────────────────────

  it('Scenario 4 — MLP fixture values on both cards', () => {
    const mlpData = {
      name: mlpFixture.name,
      email: mlpFixture.existingEmail,
      phone: mlpFixture.existingPhone,
      otp: mlpFixture.otp || ksFixture.otp,
    };
    registerOnCard(0, mlpData);
    registerOnCard(1, mlpData);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function registerOnCard(eventIndex, data) {
  clickRegisterOnCard(eventIndex);
  waitForModal();
  fillModalForm(data);
  clickWhatsappYes();
  clickReserveMySeat();
  cy.enterOtpAndSubmit(data.otp);
  cy.contains(SUCCESS_REGEX, { timeout: 45000 }).should('be.visible');

  // Re-visit so the next card's Register button is fresh and clickable.
  cy.visit('/kraftshala-live/', { failOnStatusCode: false });
  cy.selectPlatformIfPresent();
  cy.get(CARD_SELECTOR, { timeout: 25000 })
    .filter(':visible')
    .should('have.length.at.least', 1);
}

// Card-index targeting — click the Nth `.register-btn` inside the Nth visible
// `.ks-live-registration-card`. Auto-retries via .should() until cards are ready.
function clickRegisterOnCard(eventIndex) {
  cy.get(CARD_SELECTOR, { timeout: 20000 })
    .filter(':visible')
    .should('have.length.at.least', eventIndex + 1);

  cy.get(CARD_SELECTOR)
    .filter(':visible')
    .eq(eventIndex)
    .scrollIntoView()
    .find(REGISTER_BTN_SELECTOR)
    .filter(':visible')
    .first()
    .click({ force: true });
}

// Wait for the modal's email input to render — anchor on a visible email field.
function waitForModal() {
  cy.get(
    'input[type="email"]:visible, input[name*="email"]:visible, input[placeholder*="Email"]:visible',
    { timeout: 15000 }
  ).should('exist');
}

function fillModalForm({ name, email, phone }) {
  // Name (optional — present in most KS Live modals).
  if (name) {
    cy.get('body').then(($body) => {
      const $name = $body.find('input').filter((_, el) => {
        const $el = Cypress.$(el);
        if (!$el.is(':visible')) return false;
        const n = (el.getAttribute('name') || '').toLowerCase();
        const p = (el.getAttribute('placeholder') || '').toLowerCase();
        const t = (el.getAttribute('type') || '').toLowerCase();
        return (n === 'name' || p.includes('name')) && t !== 'hidden';
      });
      if ($name.length) {
        cy.wrap($name[0]).clear({ force: true }).type(name, { force: true });
      }
    });
  }

  cy.get('input[type="email"], input[name*="email"], input[placeholder*="Email"]', {
    timeout: 10000,
  })
    .filter(':visible')
    .first()
    .clear({ force: true })
    .type(email, { force: true });

  cy.get('input[type="tel"], input[name*="phone"], input[placeholder*="Phone"], input[placeholder*="phone"]', {
    timeout: 10000,
  })
    .filter(':visible')
    .last()
    .clear({ force: true })
    .type(phone, { force: true });
}

// WhatsApp opt-in (Yes) — same pattern as MLP/ALM lead-form code.
function clickWhatsappYes() {
  cy.contains(/^yes$/i).filter(':visible').first().click({ force: true });
}

// Modal CTA — "Reserve my seat".
function clickReserveMySeat() {
  cy.contains(/reserve\s*my\s*seat/i, { timeout: 10000 })
    .filter(':visible')
    .last()
    .scrollIntoView()
    .click({ force: true });
}
