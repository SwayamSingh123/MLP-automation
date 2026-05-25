// Custom commands for Kraftshala MLP "Download brochure" and "Download syllabus" flows.
// Style mirrors cypress/support/commands.js: text-regex + visible filters + scoped container fallbacks.
//
// The brochure/syllabus form is NOT always rendered inside a modal/dialog — on the MLP page
// it often appears inline. We anchor the form scope around the visible "Next" button instead:
// walk up from the Next button to the closest ancestor that also contains the form inputs.

const MODAL_SELECTOR =
  '[role="dialog"], .modal, .Modal, .popup, .ReactModal__Content, .MuiDialog-paper';
const EMAIL_INPUT_SELECTOR =
  'input[type="email"], input[name*="email"], input[placeholder*="Email"], input[placeholder*="email"]';
const PHONE_INPUT_SELECTOR =
  'input[type="tel"], input[name="phone"], input[name*="phone"], input[placeholder*="Phone"], input[placeholder*="phone"]';

// Strict regex used only to locate the form scope (avoids matching the main lead form CTA).
const NEXT_BUTTON_DISCOVERY_REGEX = /^\s*(next|proceed)\s*$/i;
// Broader regex used when actually clicking the progression CTA.
const NEXT_CTA_CLICK_REGEX = /^\s*(next|continue|submit|verify|proceed)\s*$/i;

// The MLP page marks the brochure / syllabus Next buttons with these specific classes.
// Targeting them directly is more reliable than text-regex scope walking, and cleanly
// separates the brochure form's Next from the syllabus form's Next when both are in the DOM.
const DOWNLOAD_NEXT_BUTTON_SELECTOR =
  '.next-button-download-brochure, .next-button-download-syllabus, [class*="next-button-download"]';

function findSpecificDownloadNextButton($body) {
  return $body.find(DOWNLOAD_NEXT_BUTTON_SELECTOR).filter((_, el) => {
    const $el = Cypress.$(el);
    return $el.is(':visible') && !isButtonDisabled(el, $el);
  });
}

function findVisibleOtpInputs($scope) {
  return $scope.find('input').filter((_, el) => {
    const $el = Cypress.$(el);
    if (!$el.is(':visible')) return false;
    const name = (el.getAttribute('name') || '').toLowerCase();
    const id = (el.getAttribute('id') || '').toLowerCase();
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
    const maxLength = Number(el.getAttribute('maxlength') || 0);
    const type = (el.getAttribute('type') || '').toLowerCase();
    return (
      name.includes('otp') ||
      id.includes('otp') ||
      placeholder.includes('otp') ||
      maxLength === 6 ||
      maxLength === 1 ||
      type === 'number'
    );
  });
}

function normalizeButtonText(el) {
  const raw = (el.innerText || el.value || '') + '';
  return raw
    .trim()
    .replace(/[\s→›»>]+$/u, '')
    .replace(/^[\s←‹«<]+/u, '');
}

function isButtonDisabled(el, $el) {
  if (el.disabled) return true;
  if ($el.attr('disabled') !== undefined) return true;
  if (String($el.attr('aria-disabled') || '').toLowerCase() === 'true') return true;
  return false;
}

function findVisibleNextButtons($scope, regex) {
  return $scope
    .find('button, [role="button"], a, input[type="submit"]')
    .filter((_, el) => {
      const $el = Cypress.$(el);
      if (!$el.is(':visible')) return false;
      if (isButtonDisabled(el, $el)) return false;
      const text = normalizeButtonText(el);
      return regex.test(text);
    });
}

// Finds the container wrapping the currently-open download form.
// 1. Prefer a visible modal/dialog if present.
// 2. Otherwise walk up from the visible "Next" button until we find an ancestor
//    that also contains a visible email input — that's the form.
// 3. Fall back to $body.
function getDownloadFormScope($body) {
  const $modals = $body.find(MODAL_SELECTOR).filter(':visible');
  if ($modals.length) return Cypress.$($modals.last());

  const $nextButtons = findVisibleNextButtons($body, NEXT_BUTTON_DISCOVERY_REGEX);
  if ($nextButtons.length) {
    const $nextBtn = Cypress.$($nextButtons[$nextButtons.length - 1]);
    let $current = $nextBtn.parent();
    while ($current.length && !$current.is('body, html')) {
      const hasEmail = $current.find(EMAIL_INPUT_SELECTOR).filter(':visible').length > 0;
      if (hasEmail) return $current;
      $current = $current.parent();
    }
  }

  return Cypress.$($body);
}

function clickDownloadCta(labelRegex) {
  cy.get('body').then(($body) => {
    const $buttons = $body
      .find('button, [role="button"], a, input[type="submit"]')
      .filter((_, el) => {
        const text = ((el.innerText || el.value || '') + '').trim();
        return labelRegex.test(text);
      })
      .filter(':visible');

    expect(
      $buttons.length,
      `Expected a visible "${labelRegex}" CTA on the MLP page`
    ).to.be.greaterThan(0);

    cy.wrap($buttons[$buttons.length - 1])
      .scrollIntoView()
      .click({ force: true });
  });
}

// Scrolls to and opens the "Download brochure" form on the MLP page.
Cypress.Commands.add('openDownloadBrochureForm', () => {
  clickDownloadCta(/download\s*brochure/i);
});

// Scrolls to and opens the "Download syllabus" form on the MLP page.
Cypress.Commands.add('openDownloadSyllabusForm', () => {
  clickDownloadCta(/download\s*syllabus/i);
});

// Scrolls to and opens the "Download prospectus" form on the ALM page.
Cypress.Commands.add('openDownloadProspectusForm', () => {
  clickDownloadCta(/download\s*prospectus/i);
});

// Fills the download form (name / email / phone / whatsapp opt-in) and clicks Next.
// data: { name, email, phone, whatsappOptIn }
Cypress.Commands.add('fillDownloadForm', (data = {}) => {
  const { name, email, phone, whatsappOptIn } = data;

  // Wait for the form to render — anchor on a visible "Next" button + email input.
  cy.get('body', { timeout: 15000 }).should(($body) => {
    const $scope = getDownloadFormScope($body);
    const hasNext = findVisibleNextButtons($scope, NEXT_BUTTON_DISCOVERY_REGEX).length > 0;
    const hasEmail = $scope.find(EMAIL_INPUT_SELECTOR).filter(':visible').length > 0;
    expect(
      hasNext && hasEmail,
      'Download form (Next button + email input) should be visible after opening CTA'
    ).to.equal(true);
  });

  if (name) {
    cy.get('body').then(($body) => {
      const $scope = getDownloadFormScope($body);
      const $nameInputs = $scope.find('input').filter((_, el) => {
        const $el = Cypress.$(el);
        const nameAttr = (el.getAttribute('name') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        return (
          $el.is(':visible') &&
          (nameAttr === 'name' || placeholder.includes('name')) &&
          type !== 'hidden'
        );
      });
      if ($nameInputs.length) {
        cy.wrap($nameInputs[0]).clear({ force: true }).type(name, { force: true });
      }
    });
  }

  if (email) {
    cy.get('body').then(($body) => {
      const $scope = getDownloadFormScope($body);
      const $emailInputs = $scope.find(EMAIL_INPUT_SELECTOR).filter(':visible');
      if ($emailInputs.length) {
        cy.wrap($emailInputs.first())
          .clear({ force: true })
          .type(email, { force: true });
      }
    });
  }

  if (phone) {
    cy.get('body').then(($body) => {
      const $scope = getDownloadFormScope($body);
      const $phoneInputs = $scope.find(PHONE_INPUT_SELECTOR).filter(':visible');
      if ($phoneInputs.length) {
        cy.wrap($phoneInputs.last())
          .clear({ force: true })
          .type(phone, { force: true });
      }
    });
  }

  if (whatsappOptIn === true || whatsappOptIn === 'yes') {
    cy.get('body').then(($body) => {
      const $scope = getDownloadFormScope($body);
      const $yes = $scope
        .find('label, button, [role="button"], span, div')
        .filter((_, el) => /^yes$/i.test(((el.innerText || '') + '').trim()))
        .filter(':visible');
      if ($yes.length) {
        cy.wrap($yes[0]).click({ force: true });
      } else {
        cy.contains(/^yes$/i).click({ force: true });
      }
    });
  } else if (whatsappOptIn === false || whatsappOptIn === 'no') {
    cy.get('body').then(($body) => {
      const $scope = getDownloadFormScope($body);
      const $no = $scope
        .find('label, button, [role="button"], span, div')
        .filter((_, el) => /^no$/i.test(((el.innerText || '') + '').trim()))
        .filter(':visible');
      if ($no.length) {
        cy.wrap($no[0]).click({ force: true });
      } else {
        cy.contains(/^no$/i).click({ force: true });
      }
    });
  }

  // Wait for an enabled download-specific Next button (or a text-matched fallback).
  cy.get('body', { timeout: 15000 }).should(($body) => {
    const specificCount = findSpecificDownloadNextButton($body).length;
    if (specificCount > 0) return;

    const $scope = getDownloadFormScope($body);
    const fallbackCount =
      findVisibleNextButtons($scope, NEXT_BUTTON_DISCOVERY_REGEX).length +
      findVisibleNextButtons($scope, NEXT_CTA_CLICK_REGEX).length;
    expect(
      fallbackCount,
      'Enabled Next button should be present in the download form'
    ).to.be.greaterThan(0);
  });

  // Prefer the class-specific selector (.next-button-download-brochure / -syllabus).
  // Fall back to text-matched buttons only if no class-specific button is present.
  cy.get('body').then(($body) => {
    const $specific = findSpecificDownloadNextButton($body);
    if ($specific.length) {
      cy.wrap($specific[$specific.length - 1])
        .scrollIntoView()
        .click({ force: true });
      return;
    }

    const $scope = getDownloadFormScope($body);
    const $strict = findVisibleNextButtons($scope, NEXT_BUTTON_DISCOVERY_REGEX);
    const $target = $strict.length
      ? $strict
      : findVisibleNextButtons($scope, NEXT_CTA_CLICK_REGEX);

    cy.wrap($target[$target.length - 1])
      .scrollIntoView()
      .click({ force: true });
  });
});

// Waits for the OTP stage to render inside the download form.
// Prevents cy.enterOtpAndSubmit from falling back to the main lead form CTA.
// Includes a recovery re-click of Next in case the first click missed.
Cypress.Commands.add('waitForDownloadOtpStage', () => {
  // Give the backend + DOM time to transition from fill stage to OTP stage.
  cy.wait(3000);

  // Recovery: if OTP still hasn't rendered, the Next click may have missed. Click it again.
  cy.get('body').then(($body) => {
    if (findVisibleOtpInputs($body).length > 0) return;

    const $specific = findSpecificDownloadNextButton($body);
    if ($specific.length) {
      cy.wrap($specific[$specific.length - 1])
        .scrollIntoView()
        .click({ force: true });
      return;
    }

    const $scope = getDownloadFormScope($body);
    const $nextButtons = findVisibleNextButtons($scope, NEXT_CTA_CLICK_REGEX);
    if ($nextButtons.length) {
      cy.wrap($nextButtons[$nextButtons.length - 1])
        .scrollIntoView()
        .click({ force: true });
    }
  });

  // Final wait — auto-retry until OTP inputs are visible.
  cy.get('body', { timeout: 45000 }).should(($body) => {
    const otpCount = findVisibleOtpInputs($body).length;
    expect(
      otpCount,
      'OTP input should be visible in the download form after submit'
    ).to.be.greaterThan(0);
  });
});

function assertDownloadSuccess(documentCopyRegex) {
  cy.contains(/you['’]?re all set/i, { timeout: 60000 }).should('be.visible');
  cy.contains(documentCopyRegex, { timeout: 60000 }).should('be.visible');
}

// Final-screen assertions for brochure download success.
Cypress.Commands.add('assertBrochureDownloadSuccess', () => {
  assertDownloadSuccess(
    /we['’]?ve sent the document to your email and whatsapp/i
  );
});

// Final-screen assertions for syllabus download success.
Cypress.Commands.add('assertSyllabusDownloadSuccess', () => {
  assertDownloadSuccess(
    /we['’]?ve sent the syllabus to your email and whatsapp/i
  );
});

// Final-screen assertions for prospectus download success.
// User-confirmed copy: "You're all set. We've sent the document to your email and WhatsApp."
Cypress.Commands.add('assertProspectusDownloadSuccess', () => {
  assertDownloadSuccess(
    /we['’]?ve sent the document to your email and whatsapp/i
  );
});
