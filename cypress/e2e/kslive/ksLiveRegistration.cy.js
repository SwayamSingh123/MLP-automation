/// <reference types="cypress" />
//
// Kraftshala KS Live — event registration tests.
// Page: /kraftshala-live/
//
// The page lists multiple KS Live event cards that share the same selector
// (.ks-live-registration-card) and CTA (.register-btn). Labels and dates change
// frequently, so we target by visible-card index:
//   - 1st card (eq 0) — 4 scenarios
//   - 2nd card (eq 1) — 1 scenario
//
// Diagnostic finding (probes 1–4): clicking Register Now executes
//   window.open('/kraftshala-live/register/?event_name=<event>', '_top')
// which navigates the AUT to a blank top-level page that Cypress cannot
// follow — symptom is "white screen, no terminal error".
//
// Fix: in onBeforeLoad we override window.open to CAPTURE the URL into
// win.__nextRegisterUrl instead of executing the navigation. After clicking
// the button, we read that URL and cy.visit() it ourselves — Cypress keeps
// tracking the AUT, the registration form on the new page is reachable, and
// the rest of the flow (name/email/phone → WhatsApp Yes → Reserve my seat →
// OTP → success message) runs identically across all 5 scenarios.

const ksFixture = require('../../fixtures/kslive/ksLiveTestData.json');

const CARD_SELECTOR = '.ks-live-registration-card';
const REGISTER_BTN_SELECTOR = '.register-btn';
const RESERVE_BTN_TEXT = /reserve\s*my\s*seat/i;

// Three end-states the registration page can produce. Each is a PASS:
//   - SUCCESS               → new registration succeeded
//   - ALREADY_REGISTERED    → lead already registered for this event
//   - PHONE_BLOCKED         → email known + phone differs → blocked
//
// Regexes are tightened to match ONLY the actual confirmation strings, not
// boilerplate that might exist elsewhere on the page (FAQ / footer / link
// text like "If you're already registered, login here"). Previous loose regex
// /already registered/i was matching such boilerplate and causing the test
// to pass without ever entering OTP.
//
// Curly-apostrophe tolerant — the page uses ’ (U+2019), not ASCII '.
const SUCCESS_TEXT =
  /your\s+session\s+registration\s+is\s+confirmed/i;
const ALREADY_REGISTERED_TEXT =
  /you[’‘']?re\s+already\s+registered[\s\S]{0,300}(re[-\s]?sent|join\s+session)/i;
const PHONE_BLOCKED_TEXT =
  /phone\s+number\s+associated\s+with[\s\S]{0,200}try\s+using\s+this\s+phone/i;

// KS Live OTP UI — confirmed via inspect probe:
//   - Single text input, class="otp-input-kslive", maxlength=6
//   - Submit button, class="ks-live-submit-btn", text "Submit"
// Selectors pinned to these exact classes — broader fallbacks would risk
// matching unrelated fields (e.g. a maxlength="6" verification field elsewhere
// on the registration page) and typing the OTP into the wrong input.
const OTP_INPUT_SELECTOR = 'input.otp-input-kslive';
const OTP_SUBMIT_SELECTOR = 'button.ks-live-submit-btn';

function neutraliseKsLiveHazards(win) {
  try {
    Object.defineProperty(win, 'top', { configurable: true, get: () => win });
  } catch (_) {}
  try {
    Object.defineProperty(win, 'parent', { configurable: true, get: () => win });
  } catch (_) {}
  try {
    Object.defineProperty(win.navigator, 'serviceWorker', {
      configurable: true,
      get: () => undefined,
    });
  } catch (_) {}

  // CRITICAL — Register Now invokes window.open(url, '_top') to navigate to
  // the registration page. Capture the URL so we can cy.visit() it ourselves.
  // Without this, the AUT loses its top-level frame and Cypress goes blank.
  win.__nextRegisterUrl = null;
  // eslint-disable-next-line no-unused-vars
  win.open = function (url, _target) {
    win.__nextRegisterUrl = String(url || '');
    return null;
  };
}

function visitKsLivePage() {
  cy.visit('/kraftshala-live/', {
    failOnStatusCode: false,
    onBeforeLoad: neutraliseKsLiveHazards,
  });
  cy.selectPlatformIfPresent();
  cy.get(CARD_SELECTOR, { timeout: 25000 })
    .filter(':visible')
    .should('have.length.at.least', 1);
}

// Click Register Now on a single visible card index. Captures the resulting
// URL into win.__nextRegisterUrl via the window.open intercept. Used as a
// building block by both the fast path and the discovery loop below.
function clickRegisterAt(eventIndex) {
  cy.window().then((win) => { win.__nextRegisterUrl = null; });
  // Native DOM click — React's onClick is attached via addEventListener and
  // synthetic Cypress clicks have been observed to no-op on this widget.
  cy.get(CARD_SELECTOR)
    .filter(':visible')
    .eq(eventIndex)
    .scrollIntoView()
    .find(REGISTER_BTN_SELECTOR)
    .filter(':visible')
    .first()
    .then(($btn) => { $btn[0].click(); });
  cy.window({ timeout: 10000 }).should((win) => {
    expect(win.__nextRegisterUrl, 'register URL captured').to.be.a('string').and.not.empty;
  });
}

// Click the Nth UNIQUE-event card (1-based). The /kraftshala-live/ page shows
// one card per session; the same event can appear in multiple sessions, which
// means DOM index alone doesn't map to "Nth distinct event". We disambiguate
// by capturing each visible card's URL (event_name query param is the
// identity) and selecting the Nth one we haven't seen before.
//
// n=1 fast-path: card[0] is always the first unique event, no discovery needed.
// n>=2 slow-path: iterate every visible card, capture URLs (window.open is
//   intercepted so no real navigation), then pick the Nth unique by DOM order.
function clickRegisterOnNthUniqueEvent(n) {
  cy.get(CARD_SELECTOR, { timeout: 20000 })
    .filter(':visible')
    .should('have.length.at.least', 1);

  if (n === 1) {
    clickRegisterAt(0);
    return;
  }

  const events = []; // [{ idx, eventName, url }]

  cy.get(CARD_SELECTOR)
    .filter(':visible')
    .each(($card, idx) => {
      cy.window().then((win) => { win.__nextRegisterUrl = null; });
      cy.wrap($card)
        .scrollIntoView()
        .find(REGISTER_BTN_SELECTOR)
        .filter(':visible')
        .first()
        .then(($btn) => { $btn[0].click(); });
      cy.window({ timeout: 5000 }).should((win) => {
        expect(win.__nextRegisterUrl, 'card[' + idx + '] URL captured').to.be.a(
          'string'
        ).and.not.empty;
      });
      cy.window().then((win) => {
        const url = String(win.__nextRegisterUrl || '');
        const m = url.match(/event_name=([^&]+)/);
        const eventName = (m ? m[1] : '').toLowerCase();
        events.push({ idx, eventName, url });
      });
    })
    .then(() => {
      const seen = new Set();
      const uniqueEvents = [];
      events.forEach((e) => {
        if (e.eventName && !seen.has(e.eventName)) {
          seen.add(e.eventName);
          uniqueEvents.push(e);
        }
      });

      if (uniqueEvents.length < n) {
        throw new Error(
          'KSLIVE: only ' +
            uniqueEvents.length +
            ' unique event(s) visible (need ' +
            n +
            '). Found: ' +
            uniqueEvents.map((e) => e.eventName).join(', ')
        );
      }

      const target = uniqueEvents[n - 1];
      cy.log(
        'KSLIVE nth-unique-event: n=' +
          n +
          ' → idx=' +
          target.idx +
          ' event_name=' +
          target.eventName
      );
      // Set captured URL directly so followCapturedRegistrationUrl picks the
      // target. Avoids a redundant re-click that could be disturbed by the
      // page state shifting after multiple Register Now clicks.
      cy.window().then((win) => { win.__nextRegisterUrl = target.url; });
    });
}

function followCapturedRegistrationUrl() {
  cy.window({ timeout: 10000 }).should((win) => {
    expect(win.__nextRegisterUrl, 'register URL captured').to.be.a('string').and.not.empty;
  });
  cy.window()
    .then((win) => win.__nextRegisterUrl)
    .then((url) => {
      cy.log('KSLIVE registration URL: ' + url);
      // The URL is relative (e.g. /kraftshala-live/register/?event_name=...) —
      // cy.visit joins it with baseUrl. failOnStatusCode false because the
      // registration page may set a non-200 on first load while it hydrates.
      cy.visit(url, {
        failOnStatusCode: false,
        onBeforeLoad: neutraliseKsLiveHazards,
      });
    });
  // On the registration page now — wait for any name/email/phone input.
  cy.get(
    'input[type="email"], input[name*="email"], input[type="tel"], input[name*="phone"], input[name*="name"]',
    { timeout: 20000 }
  )
    .filter(':visible')
    .should('have.length.at.least', 1);
}

function fillFormAndSubmit({ name, email, phone }) {
  if (name) {
    cy.get('body').then(($body) => {
      const nameInputs = $body.find('input').filter((_, el) => {
        const $el = Cypress.$(el);
        if (!$el.is(':visible')) return false;
        const n = (el.getAttribute('name') || '').toLowerCase();
        const p = (el.getAttribute('placeholder') || '').toLowerCase();
        const t = (el.getAttribute('type') || '').toLowerCase();
        return (n === 'name' || p.includes('name')) && t !== 'hidden';
      });
      if (nameInputs.length) {
        cy.wrap(nameInputs[0])
          .clear({ force: true })
          .type(name, { force: true });
      }
    });
  }

  cy.get(
    'input[type="email"], input[name*="email"], input[placeholder*="Email"]',
    { timeout: 10000 }
  )
    .filter(':visible')
    .last()
    .clear({ force: true })
    .type(email, { force: true });

  cy.get(
    'input[type="tel"], input[name*="phone"], input[placeholder*="Phone"], input[placeholder*="phone"]',
    { timeout: 10000 }
  )
    .filter(':visible')
    .last()
    .clear({ force: true })
    .type(phone, { force: true });

  cy.contains(/^yes$/i).filter(':visible').first().click({ force: true });

  cy.contains(RESERVE_BTN_TEXT, { timeout: 10000 })
    .filter(':visible')
    .last()
    .scrollIntoView()
    .click({ force: true });
}

// KS Live OTP fill — dedicated helper. KS Live's OTP UI is a single text
// input (class .otp-input-kslive, maxlength=6) and a Submit button (class
// .ks-live-submit-btn). The shared cy.enterOtpAndSubmit was written for
// MLP/ALM/SMBL's 6-individual-digit inputs and doesn't match these.
function enterKsLiveOtp(otp) {
  const otpStr = String(otp);

  // Wait for the input to appear AND be interactable.
  cy.get(OTP_INPUT_SELECTOR, { timeout: 30000 })
    .should('be.visible')
    .should('be.enabled')
    .clear()
    .type(otpStr, { delay: 80 });

  // Verify the value actually landed before submitting — guards against React
  // dropping keystrokes or onChange not firing on each character.
  cy.get(OTP_INPUT_SELECTOR).should('have.value', otpStr);

  cy.get(OTP_SUBMIT_SELECTOR, { timeout: 10000 })
    .should('be.visible')
    .should('not.be.disabled')
    .scrollIntoView()
    .click();
}

// After clicking "Reserve my seat" the flow is:
//   1. OTP step opens (canonical path) → we enter OTP → end-state shows
//   2. (rare) "Already registered" appears before OTP → no OTP needed
//
// IMPORTANT: We must ALWAYS enter OTP if the input is visible. Previous logic
// short-circuited on any page-text match for "already registered", which fired
// on boilerplate text and falsely passed the test without ever submitting OTP.
function submitAndAssertOutcome(otp) {
  // Step 1: wait for OTP input to be visible. Generous timeout — the OTP
  // step takes a few seconds to render after Reserve my seat.
  cy.get('body', { timeout: 30000 }).should(($body) => {
    const hasOtp = $body.find(OTP_INPUT_SELECTOR).filter(':visible').length > 0;
    // We also tolerate the (rare) no-OTP path — but ONLY if the tight
    // end-state regex actually matches the post-submit confirmation.
    const text = $body.text();
    const hasTightEnd =
      SUCCESS_TEXT.test(text) ||
      ALREADY_REGISTERED_TEXT.test(text) ||
      PHONE_BLOCKED_TEXT.test(text);
    expect(
      hasOtp || hasTightEnd,
      'expected OTP input visible OR confirmation message after Reserve my seat'
    ).to.equal(true);
  });

  // Step 2: if OTP is visible, ALWAYS enter it. Don't consult page text here —
  // the OTP step is the canonical flow and must be completed.
  cy.get('body').then(($body) => {
    const hasOtp = $body.find(OTP_INPUT_SELECTOR).filter(':visible').length > 0;
    if (hasOtp) {
      enterKsLiveOtp(otp);
    } else {
      cy.log('KSLIVE no OTP input visible — proceeding to end-state assertion');
    }
  });

  // Step 3: final assertion — wait for one of the three end-state messages.
  // Tight regexes ensure only the actual confirmation/error string matches,
  // not boilerplate. On failure, body-preview tells us what's on screen.
  cy.get('body', { timeout: 60000 }).should(($body) => {
    const text = $body.text();
    const succ = SUCCESS_TEXT.test(text);
    const alreadyReg = ALREADY_REGISTERED_TEXT.test(text);
    const blocked = PHONE_BLOCKED_TEXT.test(text);
    const matched = succ || alreadyReg || blocked;
    if (!matched) {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 500);
      expect(
        matched,
        'expected success / already-registered / phone-blocked. Body preview: ' +
          preview
      ).to.equal(true);
    }
    expect(matched).to.equal(true);
  });
}

// n: 1 = 1st unique event, 2 = 2nd unique event, etc. Robust to the page
// showing multiple sessions (DOM cards) of the same event.
function registerOnNthUniqueEvent(n, payload) {
  clickRegisterOnNthUniqueEvent(n);
  followCapturedRegistrationUrl();
  fillFormAndSubmit(payload);
  submitAndAssertOutcome(payload.otp);
}

describe('Kraftshala KS Live registration', () => {
  beforeEach(() => {
    Cypress.on('uncaught:exception', () => false);
    visitKsLivePage();
  });

  it('Register on 1st KS Live event with base email and base phone', () => {
    registerOnNthUniqueEvent(1, {
      name: ksFixture.name,
      email: ksFixture.baseEmail,
      phone: ksFixture.basePhone,
      otp: ksFixture.otp,
    });
  });

  it('Re-register on 1st KS Live event with base email and base phone', () => {
    registerOnNthUniqueEvent(1, {
      name: ksFixture.name,
      email: ksFixture.baseEmail,
      phone: ksFixture.basePhone,
      otp: ksFixture.otp,
    });
  });

  it('Register on 1st KS Live event with base email and a different phone', () => {
    registerOnNthUniqueEvent(1, {
      name: ksFixture.name,
      email: ksFixture.baseEmail,
      phone: ksFixture.differentPhone,
      otp: ksFixture.otp,
    });
  });

  it('Register on 1st KS Live event with a different email and base phone', () => {
    registerOnNthUniqueEvent(1, {
      name: ksFixture.name,
      email: ksFixture.differentEmail,
      phone: ksFixture.basePhone,
      otp: ksFixture.otp,
    });
  });

  it('Register on 2nd KS Live event with base email and base phone', () => {
    registerOnNthUniqueEvent(2, {
      name: ksFixture.name,
      email: ksFixture.baseEmail,
      phone: ksFixture.basePhone,
      otp: ksFixture.otp,
    });
  });
});
