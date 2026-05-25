/// <reference types="cypress" />
//
// Kraftshala — "Request a CallBack" automation.
// Flow (per spec):
//   1. Visit MLP page (the callback widget lives there).
//   2. Click "Request a CallBack" button.
//   3. Fill Name / Email / Phone — values read directly from the MLP fixture
//      (cypress/fixtures/mlp/mlpTestData.json — same source MLP tests use).
//   4. Open the course dropdown and pick "Digital Marketing".
//   5. Click "Request OTP".
//   6. Enter master OTP and submit.
//   7. Verify success copy:
//      "Thanks for sharing your details. One of our Admissions Counsellors will get in touch with you shortly"
//
// Selectors use the same resilience pattern as commands.js — visible filter +
// scope by anchor + text regex. The global apiMonitor.js + pixelMonitor.js
// hooks pick up /lead/create and /otp-validation/validate automatically.

// Reuse MLP fixture — guarantees the same name/email/phone the MLP tests use.
const mlpFixture = require('../../fixtures/mlp/mlpTestData.json');
const testData = {
  name: mlpFixture.name,
  email: mlpFixture.existingEmail,
  phone: mlpFixture.existingPhone,
  courseLabel: 'Digital Marketing',
  otp: mlpFixture.otp,
};

const SUCCESS_MESSAGE_REGEX =
  /thanks for sharing your details[\s\S]*one of our admissions counsellors will get in touch with you shortly/i;

describe('Kraftshala — Request a CallBack', () => {
  beforeEach(() => {
    // The callback widget only lives on the home page (not on MLP).
    cy.visit('/');
    cy.selectPlatformIfPresent();
  });

  it('Submit callback request and verify success message', () => {
    openCallbackWidget();
    fillCallbackForm({
      name: testData.name,
      email: testData.email,
      phone: testData.phone,
    });
    selectCourse(testData.courseLabel || 'Digital Marketing');
    clickRequestOtp();
    cy.enterOtpAndSubmit(testData.otp);
    assertCallbackSuccess();
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function openCallbackWidget() {
  // The CTA appears on the MLP page — could be a floating button, header link
  // or inline section. Match by text and click the first visible one.
  cy.contains(/request\s*a?\s*call\s*back/i, { timeout: 15000 })
    .filter(':visible')
    .first()
    .scrollIntoView()
    .click({ force: true });

  // Wait for the callback form to render — anchor on a visible email input.
  cy.get('body', { timeout: 15000 }).should(($body) => {
    const $email = $body
      .find('input[type="email"], input[name*="email"], input[placeholder*="Email"]')
      .filter(':visible');
    expect($email.length, 'Callback form email input should be visible').to.be.greaterThan(0);
  });
}

// Walks up from a visible email input to find the closest container that also
// has a Request-OTP button. Returns the body fallback if not found.
function getCallbackScope($body) {
  const $email = $body
    .find('input[type="email"], input[name*="email"], input[placeholder*="Email"]')
    .filter(':visible')
    .last();
  if (!$email.length) return $body;
  let $cur = Cypress.$($email).parent();
  while ($cur.length && !$cur.is('body, html')) {
    const text = ($cur.text() || '').toLowerCase();
    if (/request\s*otp|get\s*otp|send\s*otp/.test(text)) return $cur;
    $cur = $cur.parent();
  }
  return Cypress.$($body);
}

function fillCallbackForm({ name, email, phone }) {
  cy.get('body').then(($body) => {
    const $scope = getCallbackScope($body);

    if (name) {
      const $nameInputs = $scope.find('input').filter((_, el) => {
        const $el = Cypress.$(el);
        if (!$el.is(':visible')) return false;
        const n = (el.getAttribute('name') || '').toLowerCase();
        const p = (el.getAttribute('placeholder') || '').toLowerCase();
        const t = (el.getAttribute('type') || '').toLowerCase();
        return (n === 'name' || p.includes('name')) && t !== 'hidden';
      });
      if ($nameInputs.length) {
        cy.wrap($nameInputs[0]).clear({ force: true }).type(name, { force: true });
      }
    }

    if (email) {
      const $emailInputs = $scope
        .find('input[type="email"], input[name*="email"], input[placeholder*="Email"]')
        .filter(':visible');
      if ($emailInputs.length) {
        cy.wrap($emailInputs.first()).clear({ force: true }).type(email, { force: true });
      }
    }

    if (phone) {
      const $phoneInputs = $scope
        .find('input[type="tel"], input[name*="phone"], input[placeholder*="Phone"], input[placeholder*="phone"]')
        .filter(':visible');
      if ($phoneInputs.length) {
        cy.wrap($phoneInputs.last()).clear({ force: true }).type(phone, { force: true });
      }
    }
  });
}

function selectCourse(courseLabel) {
  cy.get('body').then(($body) => {
    // Highest-priority path: the callback widget uses `.dropdown-text` as the
    // trigger element. Click it to open, then click the matching option.
    const $dropdownText = $body.find('.dropdown-text').filter(':visible');
    if ($dropdownText.length) {
      cy.wrap($dropdownText.last()).scrollIntoView().click({ force: true });
      cy.contains(new RegExp(escapeRegex(courseLabel), 'i'), { timeout: 10000 })
        .filter(':visible')
        .first()
        .click({ force: true });
      return;
    }

    const $scope = getCallbackScope($body);

    // Fallback 1 — native <select>.
    const $selects = $scope.find('select').filter(':visible');
    if ($selects.length) {
      cy.wrap($selects.last()).select(courseLabel, { force: true });
      return;
    }

    // Fallback 2 — custom dropdown by text heuristic.
    const $triggers = $scope
      .find('button, [role="button"], [role="combobox"], div.dropdown, div[class*="dropdown"], div[class*="Select"]')
      .filter((_, el) => {
        const $el = Cypress.$(el);
        if (!$el.is(':visible')) return false;
        const text = ((el.innerText || '') + '').toLowerCase();
        return /select|course|program|interest|choose/.test(text);
      });
    if ($triggers.length) {
      cy.wrap($triggers.first()).click({ force: true });
    }

    cy.contains(new RegExp(escapeRegex(courseLabel), 'i'), { timeout: 10000 })
      .filter(':visible')
      .first()
      .click({ force: true });
  });
}

function clickRequestOtp() {
  cy.get('body').then(($body) => {
    const $scope = getCallbackScope($body);
    const $btn = $scope
      .find('button, [role="button"], a, input[type="submit"]')
      .filter((_, el) => {
        const $el = Cypress.$(el);
        if (!$el.is(':visible')) return false;
        const text = ((el.innerText || el.value || '') + '').trim();
        return /request\s*otp|get\s*otp|send\s*otp/i.test(text);
      });
    if ($btn.length) {
      cy.wrap($btn[$btn.length - 1]).scrollIntoView().click({ force: true });
    } else {
      // Fallback: body-wide search.
      cy.contains(/request\s*otp|get\s*otp|send\s*otp/i)
        .filter(':visible')
        .last()
        .scrollIntoView()
        .click({ force: true });
    }
  });
}

function assertCallbackSuccess() {
  cy.contains(SUCCESS_MESSAGE_REGEX, { timeout: 45000 }).should('be.visible');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
