/// <reference types="cypress" />
//
// Kraftshala KS Live — single-registration smoke test.
//
// Simplified from the earlier 5-edge-case suite: now runs ONE test — fill name/
// email/phone on the 1st visible event card, submit, verify success. All the
// probes, workarounds, and defenses from the earlier iteration are kept:
//   - window.open('_top') is intercepted so the AUT doesn't blank out
//   - native DOM click on Register Now (React onClick added via addEventListener)
//   - OTP fill via the specific .otp-input-kslive selector, submit via
//     .ks-live-submit-btn — these were confirmed via inspect probe
//   - success text OR "already registered" both count as PASS

const ksFixture = require('../../fixtures/kslive/ksLiveTestData.json');

const CARD_SELECTOR = '.ks-live-registration-card';
const REGISTER_BTN_SELECTOR = '.register-btn';
const OTP_INPUT_SELECTOR = 'input.otp-input-kslive';
const OTP_SUBMIT_SELECTOR = 'button.ks-live-submit-btn';
// The registration-form submit CTA (inside the modal on the events page, or
// on the standalone /register/ page — same button, same text either way).
// Labels have changed over site iterations:
//   current  → "Register for Free"
//   prior    → "Register Now"
//   original → "Reserve my seat"
// Regex covers all three so a future rename doesn't silently break the click.
const SUBMIT_BTN_TEXT = /register\s*for\s*free|register\s*now|reserve\s*my\s*seat/i;

// End-state text patterns. All three count as a PASS for the KS Live smoke:
//   SUCCESS_NEW  → current site — "🎉 You're In! Don't Miss Important Updates"
//                  (paired-phrase match so we don't false-positive on stray
//                   "you're in" text elsewhere on the page)
//   SUCCESS_OLD  → older site — "Your Session Registration Is Confirmed"
//   ALREADY_REG  → repeat-registration path — "You're already registered … re-sent"
const SUCCESS_NEW =
  /you[’‘']?re\s+in[\s\S]{0,300}(don[’‘']?t\s+miss|important\s+updates)/i;
const SUCCESS_OLD = /your\s+session\s+registration\s+is\s+confirmed/i;
const ALREADY_REGISTERED_TEXT =
  /you[’‘']?re\s+already\s+registered[\s\S]{0,300}(re[-\s]?sent|join\s+session)/i;
const OUTCOME_REGEX = new RegExp(
  [SUCCESS_NEW.source, SUCCESS_OLD.source, ALREADY_REGISTERED_TEXT.source].join('|'),
  'i'
);

function neutraliseKsLiveHazards(win) {
  try { Object.defineProperty(win, 'top', { configurable: true, get: () => win }); } catch (_) {}
  try { Object.defineProperty(win, 'parent', { configurable: true, get: () => win }); } catch (_) {}
  try {
    Object.defineProperty(win.navigator, 'serviceWorker', {
      configurable: true,
      get: () => undefined,
    });
  } catch (_) {}
  win.__nextRegisterUrl = null;
  // eslint-disable-next-line no-unused-vars
  win.open = function (url, _target) {
    win.__nextRegisterUrl = String(url || '');
    return null;
  };
}

describe('Kraftshala KS Live registration', () => {
  beforeEach(() => {
    Cypress.on('uncaught:exception', () => false);
  });

  it('Register on 1st KS Live event with base email and base phone', () => {
    cy.visit('/kraftshala-live/', {
      failOnStatusCode: false,
      onBeforeLoad: neutraliseKsLiveHazards,
    });
    cy.selectPlatformIfPresent();

    // Wait for at least one visible event card, then click Register Now.
    cy.get(CARD_SELECTOR, { timeout: 25000 })
      .filter(':visible')
      .should('have.length.at.least', 1);
    cy.window().then((win) => { win.__nextRegisterUrl = null; });
    cy.get(CARD_SELECTOR)
      .filter(':visible')
      .eq(0)
      .scrollIntoView()
      .find(REGISTER_BTN_SELECTOR)
      .filter(':visible')
      .first()
      .then(($btn) => { $btn[0].click(); });

    // Register Now calls window.open(url, '_top') — our onBeforeLoad captured
    // the URL into __nextRegisterUrl. Follow it via cy.visit() so Cypress
    // keeps tracking the AUT (a raw _top nav would blank out the runner).
    cy.window({ timeout: 10000 }).should((win) => {
      expect(win.__nextRegisterUrl, 'register URL captured').to.be.a('string').and.not.empty;
    });
    cy.window()
      .then((win) => win.__nextRegisterUrl)
      .then((url) => {
        cy.log('KSLIVE registration URL: ' + url);
        cy.visit(url, {
          failOnStatusCode: false,
          onBeforeLoad: neutraliseKsLiveHazards,
        });
      });

    // On the registration page — wait for the form to hydrate.
    cy.get(
      'input[type="email"], input[name*="email"], input[type="tel"], input[name*="phone"], input[name*="name"]',
      { timeout: 20000 }
    )
      .filter(':visible')
      .should('have.length.at.least', 1);

    // Fill name (best-effort — some layouts have a labelled name input).
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
          .type(ksFixture.name, { force: true });
      }
    });

    // Email + phone.
    cy.get('input[type="email"], input[name*="email"], input[placeholder*="Email"]', { timeout: 10000 })
      .filter(':visible')
      .last()
      .clear({ force: true })
      .type(ksFixture.baseEmail, { force: true });
    cy.get('input[type="tel"], input[name*="phone"], input[placeholder*="Phone"], input[placeholder*="phone"]', { timeout: 10000 })
      .filter(':visible')
      .last()
      .clear({ force: true })
      .type(ksFixture.basePhone, { force: true });

    // WhatsApp Yes — OPTIONAL. Older KS Live modal had a WhatsApp opt-in
    // radio (matching MLP/ALM/SMBL convention). Current version doesn't.
    // Skip the click gracefully if no "Yes" element is visible — using
    // cy.contains here would throw and fail the whole test.
    cy.get('body').then(($body) => {
      const $yes = $body.find('*').filter((_, el) => {
        if (!Cypress.$(el).is(':visible')) return false;
        // Only match text-only leaf elements — avoids the whole page
        // matching just because the word "yes" appears somewhere inside.
        if (el.children && el.children.length > 0) return false;
        return /^\s*yes\s*$/i.test(String(el.textContent || ''));
      });
      if ($yes.length > 0) {
        cy.wrap($yes.first()).click({ force: true });
      } else {
        cy.log('KSLIVE: no WhatsApp Yes option visible — skipping');
      }
    });

    // Submit the registration form.
    //
    // Both the form submit ("Register for Free" / "Register Now" / "Reserve
    // my seat" — label has changed over site iterations) and the OTP submit
    // share class .ks-live-submit-btn. At this point only the form's CTA is
    // rendered (the OTP step opens *after* this click), so filtering by
    // ':visible' and taking .last() safely picks the form CTA.
    //
    // Strategy: prefer the class-based selector (most reliable, doesn't
    // break when the button's label changes). Fall back to text match only
    // if the class is missing.
    cy.get('body').then(($body) => {
      const $byClass = $body.find('button.ks-live-submit-btn').filter(':visible');
      if ($byClass.length) {
        cy.wrap($byClass.last()).scrollIntoView().click({ force: true });
      } else {
        cy.contains(SUBMIT_BTN_TEXT, { timeout: 10000 })
          .filter(':visible')
          .last()
          .scrollIntoView()
          .click({ force: true });
      }
    });

    // After clicking Register for Free, the flow is one of:
    //   A) OTP step opens → we enter OTP → success message
    //   B) Direct success — "🎉 You're In!" shows immediately, no OTP
    // Current KS Live site follows (B). We handle both so a future OTP
    // reintroduction doesn't break the test.
    cy.get('body', { timeout: 30000 }).should(($body) => {
      const hasOtp = $body.find(OTP_INPUT_SELECTOR).filter(':visible').length > 0;
      const hasOutcome = OUTCOME_REGEX.test($body.text());
      expect(
        hasOtp || hasOutcome,
        'expected OTP input OR outcome message after Register for Free'
      ).to.equal(true);
    });

    // Enter OTP only if it's visible. Otherwise the success message already
    // appeared and we skip straight to the outcome assertion.
    cy.get('body').then(($body) => {
      const hasOtp = $body.find(OTP_INPUT_SELECTOR).filter(':visible').length > 0;
      if (!hasOtp) {
        cy.log('KSLIVE: no OTP step — success message appeared directly');
        return;
      }
      cy.get(OTP_INPUT_SELECTOR)
        .should('be.visible')
        .should('be.enabled')
        .clear()
        .type(String(ksFixture.otp), { delay: 80 });
      cy.get(OTP_INPUT_SELECTOR).should('have.value', String(ksFixture.otp));
      cy.get(OTP_SUBMIT_SELECTOR, { timeout: 10000 })
        .should('be.visible')
        .should('not.be.disabled')
        .scrollIntoView()
        .click();
    });

    // Final outcome — success ("You're In!" / "Session Registration Confirmed")
    // OR "already registered" repeat. Any of these counts as PASS.
    cy.contains(OUTCOME_REGEX, { timeout: 60000 }).should('be.visible');
  });
});
