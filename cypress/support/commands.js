// Custom commands for Kraftshala MLP lead form (and reused by the ALM spec).

Cypress.Commands.add('visitMlpPage', () => {
  cy.visit('/marketing-launchpad/digital-marketing-course/');
  cy.selectPlatformIfPresent();
});

// ALM (AI-Led Marketing) — reuses the same form-fill / OTP / blocked-flow
// commands. Only the page URL and the success-URL pattern differ.
// (Product URL is /pgp-in-marketing/ — kept as-is — but internal name is ALM.)
Cypress.Commands.add('visitAlmPage', () => {
  cy.visit('/pgp-in-marketing/');
  cy.selectPlatformIfPresent();
});

// Selects the platform card if a chooser is displayed after initial page load.
Cypress.Commands.add('selectPlatformIfPresent', () => {
  const selectedPlatform = String(Cypress.env('platform') || 'test').toLowerCase();
  const targetLabel =
    selectedPlatform === 'main'
      ? /testing on main platform/i
      : /testing on test platform/i;

  cy.get('body').then(($body) => {
    const bodyText = $body.text() || '';
    if (!targetLabel.test(bodyText)) {
      return;
    }

    cy.contains(targetLabel, { timeout: 10000 }).then(($label) => {
      const clickableParent = $label.closest(
        'button, [role="button"], label, .card, .box, div'
      );
      cy.wrap(clickableParent.length ? clickableParent : $label).click({
        force: true,
      });
    });
  });
});

// Clicks the lead form submit CTA with resilient selector fallback.
Cypress.Commands.add('submitLeadForm', () => {
  cy.get('body').then(($body) => {
    // Class-based priority — `.submit-btn` is the lead-form CTA. Far more
    // reliable than text matching when multiple "Start your marketing journey"
    // CTAs exist on the page.
    const $ctaByClass = $body.find('.submit-btn').filter(':visible');
    if ($ctaByClass.length) {
      cy.wrap($ctaByClass.last()).scrollIntoView().click({ force: true });
      return;
    }

    // Prefer the button inside the visible lead form section.
    const leadInput = $body
      .find('input[type="email"], input[name*="email"], input[type="tel"], input[name*="phone"]')
      .filter((_, el) => Cypress.$(el).is(':visible'))
      .last();

    if (leadInput.length) {
      const scopedContainer = Cypress.$(leadInput).closest('form, section, .card, .wpcf7, .wpcf7-form');
      if (scopedContainer.length) {
        const scopedButtons = scopedContainer
          .find('button, [role="button"], a, input[type="submit"]')
          .filter((_, el) => {
            const text = ((el.innerText || el.value || '') + '').trim();
            // MLP: "Start your marketing journey", ALM: "Apply Now",
            // SMBL: "Get your candidature evaluated" — plus generic
            // submit/continue as fallbacks.
            return /start your marketing journey|apply now|apply|submit|continue|candidature|evaluate/i.test(text);
          });
        if (scopedButtons.length) {
          cy.wrap(scopedButtons[scopedButtons.length - 1])
            .scrollIntoView()
            .click({ force: true });
          return;
        }
      }
    }

    const buttons = $body.find('button, [role="button"], a, input[type="submit"]');
    const startCta = Cypress.$(buttons).filter((_, el) => {
      const text = ((el.innerText || el.value || '') + '').trim();
      return /start your marketing journey/i.test(text);
    });
    if (startCta.length) {
      cy.wrap(startCta[startCta.length - 1]).scrollIntoView().click({ force: true });
      return;
    }

    const fallbackCta = Cypress.$(buttons).filter((_, el) => {
      const text = ((el.innerText || el.value || '') + '').trim();
      // Includes SMBL's "Get your candidature evaluated" — additive only,
      // MLP/ALM keep matching on their existing keywords.
      return /apply now|apply|submit|continue|candidature|evaluate/i.test(text);
    });
    if (fallbackCta.length) {
      cy.wrap(fallbackCta[fallbackCta.length - 1]).scrollIntoView().click({
        force: true,
      });
    }
  });
});

// data: { name, email, phone, whatsappOptIn }
Cypress.Commands.add('fillLeadForm', (data) => {
  const { name, email, phone, whatsappOptIn } = data;

  if (name) {
    cy.get('body').then(($body) => {
      const nameInputs = $body.find('input').filter((_, el) => {
        const $el = Cypress.$(el);
        const isVisible = $el.is(':visible');
        const nameAttr = (el.getAttribute('name') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        return (
          isVisible &&
          (nameAttr === 'name' || placeholder.includes('name')) &&
          type !== 'hidden'
        );
      });

      if (nameInputs.length) {
        cy.wrap(nameInputs[0]).clear({ force: true }).type(name, { force: true });
      }
    });
  }

  if (email) {
    cy.get('input[placeholder="Email*"], input[type="email"], input[name*="email"]', {
      timeout: 15000,
    })
      .filter(':visible')
      .first()
      .clear({ force: true })
      .type(email, { force: true });
  }

  if (phone) {
    cy.get('input[type="tel"], input[name="phone"], input[placeholder*="Phone"], input[placeholder*="phone"]', {
      timeout: 15000,
    })
      .filter(':visible')
      .last()
      .clear({ force: true })
      .type(phone, { force: true });
  }

  if (whatsappOptIn === true || whatsappOptIn === 'yes') {
    cy.contains(/^yes$/i).click({ force: true });
  } else if (whatsappOptIn === false || whatsappOptIn === 'no') {
    cy.contains(/^no$/i).click({ force: true });
  }

  // Highest-priority submit: class-based selector for the lead-form CTA.
  // Class matching is more deterministic than text matching, which could miss
  // when the page has multiple "Start your marketing journey" CTAs (header /
  // hero / sticky) or when scope detection picks the wrong wrapper.
  cy.get('body', { timeout: 15000 }).then(($body) => {
    const $cta = $body.find('.submit-btn').filter(':visible');
    if ($cta.length) {
      cy.wrap($cta.last()).scrollIntoView().click({ force: true });
      return;
    }

    // Fallback: closest visible-input → form/section/card → text-match button.
    cy.get('input[type="email"], input[name*="email"], input[type="tel"], input[name*="phone"]')
      .filter(':visible')
      .last()
      .then(($anchor) => {
        const container = Cypress.$($anchor).closest('form, section, .card, .wpcf7, .wpcf7-form');
        const scopedButtons = container
          .find('button, [role="button"], a, input[type="submit"]')
          .filter((_, el) => {
            const text = ((el.innerText || el.value || '') + '').trim();
            // MLP / ALM / SMBL CTAs — text list covers each page's actual label.
            return /start your marketing journey|apply now|apply|submit|continue|candidature|evaluate/i.test(text);
          });

        if (scopedButtons.length) {
          cy.wrap(scopedButtons[scopedButtons.length - 1]).scrollIntoView().click({
            force: true,
          });
        } else {
          cy.submitLeadForm();
        }
      });
  });
});

function findVisibleOtpInputs($scope) {
  return $scope.find('input').filter((_, el) => {
    const $el = Cypress.$(el);
    const visible = $el.is(':visible');
    const name = (el.getAttribute('name') || '').toLowerCase();
    const id = (el.getAttribute('id') || '').toLowerCase();
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
    const maxLength = Number(el.getAttribute('maxlength') || 0);
    const type = (el.getAttribute('type') || '').toLowerCase();
    const otpLike =
      name.includes('otp') ||
      id.includes('otp') ||
      placeholder.includes('otp') ||
      maxLength === 6 ||
      maxLength === 1 ||
      type === 'number';
    return visible && otpLike;
  });
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when page copy indicates the app blocked registration (e.g. already linked / mismatch). */
function isRegistrationBlockedText(text) {
  const t = String(text || '').toLowerCase();
  return (
    /already\s+(registered|used|exists|taken|associated)/.test(t) ||
    /(email|phone|number).{0,40}already/.test(t) ||
    /phone\s+number\s+associated|associated\s+with\s+(this|another|different)/.test(t) ||
    /try\s+using\s+this\s+phone|linked\s+to\s+another|cannot\s+(complete|proceed|register)/.test(
      t
    ) ||
    /(email|phone).{0,30}mismatch|not\s+eligible|number\s+not\s+verified/i.test(t)
  );
}

function findOtpSubmitButtons($scope) {
  return $scope
    .find('button, [role="button"], a, input[type="submit"]')
    .filter((_, el) => {
      const $el = Cypress.$(el);
      const text = ((el.innerText || el.value || '') + '').trim();
      return $el.is(':visible') && /submit|verify|confirm|validate|continue/i.test(text);
    });
}

// Same email + different phone: wait for OTP (UI can appear late), submit OTP, validate request completes,
// then require `.alreadyExists` (product marks duplicate / block) — never screening-test URL.
// Call after cy.intercept on POST otp-validation validate/verify (see mlpLeadForm.cy.js) and cy.fillLeadForm(...).
//
// Opt-in `options` (used by ALM; MLP doesn't pass any so default behavior is unchanged):
//   options.denyUrlPattern        — RegExp the post-submit URL must NOT match
//   options.includeUrl            — string the final URL must still contain
//   options.requireOtp            — when true, always wait for OTP inputs (no dual-path heuristic)
//   options.blockedMessagePattern — text RegExp accepted as a "blocked" signal in lieu of `.alreadyExists`
Cypress.Commands.add('assertSameEmailDifferentPhoneBlockedFlow', (otp, options = {}) => {
  const denyPattern =
    options.denyUrlPattern ||
    /\/marketing-launchpad\/digital-marketing-course\/screening-test\//;
  const includeUrl = options.includeUrl || '/marketing-launchpad/';
  const requireOtp = options.requireOtp === true;

  if (requireOtp) {
    // ALM: always renders OTP step before blocking. Skip the dual-path heuristic
    // because baseline page copy can falsely trigger `isRegistrationBlockedText`.
    cy.get('body', { timeout: 60000 }).should(($body) => {
      expect(
        findVisibleOtpInputs($body).length,
        'OTP inputs should appear after lead submit'
      ).to.be.greaterThan(0);
    });
    cy.enterOtpAndSubmit(otp);
    cy.wait('@otpValidateBlocked', { timeout: 90000 });
    cy.assertRegistrationBlockedBySystem(options);
  } else {
    cy.get('body', { timeout: 45000 }).should(($body) => {
      const hasOtp = findVisibleOtpInputs($body).length > 0;
      const hasAlreadyExists = $body.find('.alreadyExists').filter(':visible').length > 0;
      const hasBlockCopy = isRegistrationBlockedText($body.text());
      expect(
        hasOtp || hasAlreadyExists || hasBlockCopy,
        'OTP inputs should appear after submit, or .alreadyExists / block copy should be visible'
      ).to.equal(true);
    });

    cy.get('body').then(($body) => {
      if (findVisibleOtpInputs($body).length > 0) {
        cy.enterOtpAndSubmit(otp);
        cy.wait('@otpValidateBlocked', { timeout: 90000 });
        cy.assertRegistrationBlockedBySystem(options);
      } else {
        cy.assertRegistrationBlockedBySystem(options);
      }
    });
  }

  cy.location('pathname', { timeout: 90000 }).should((pathname) => {
    const path = String(pathname || '');
    expect(path).to.not.match(denyPattern);
  });
  cy.url().should('include', includeUrl);
});

/** After OTP submit for blocked flows: product shows `.alreadyExists` (MLP) or
 *  a text message like "The phone number associated with <email> is xxxxxx4699.
 *  Try using this phone number" (ALM). When `options.blockedMessagePattern` is
 *  supplied, match that text instead of the selector. */
Cypress.Commands.add('assertRegistrationBlockedBySystem', (options = {}) => {
  if (options.blockedMessagePattern) {
    const pattern =
      options.blockedMessagePattern instanceof RegExp
        ? options.blockedMessagePattern
        : new RegExp(escapeRegex(options.blockedMessagePattern), 'i');
    cy.contains(pattern, { timeout: 25000 }).should('be.visible');
    return;
  }
  cy.get('.alreadyExists', { timeout: 25000 }).should('be.visible');
});

Cypress.Commands.add('enterOtpAndSubmit', (otp) => {
  // OTP UI differs across test/main. If first CTA click missed, retry submit once.
  cy.get('body', { timeout: 15000 }).then(($body) => {
    if (findVisibleOtpInputs($body).length === 0) {
      cy.submitLeadForm();
    }
  });

  cy.get('body', { timeout: 30000 })
    .should(($body) => {
      const otpCount = findVisibleOtpInputs($body).length;
      expect(
        otpCount,
        'OTP input should be visible after lead form submit'
      ).to.be.greaterThan(0);
    })
    .then(($body) => {
      const candidates = findVisibleOtpInputs($body);
      if (!candidates.length) {
        throw new Error(
          'OTP input did not appear. Form submission is incomplete and lead cannot be confirmed.'
        );
      }

      const otpValue = String(otp || '').trim();
      if (!/^\d{4,8}$/.test(otpValue)) {
        throw new Error(`Invalid OTP value provided: "${otpValue}"`);
      }

      const singleDigitInputs = candidates.filter((_, el) => {
        const maxLength = Number(el.getAttribute('maxlength') || 0);
        return maxLength === 1;
      });

      if (singleDigitInputs.length >= otpValue.length) {
        otpValue.split('').forEach((digit, idx) => {
          cy.wrap(singleDigitInputs[idx]).clear({ force: true }).type(digit, { force: true });
        });
      } else {
        cy.wrap(candidates[candidates.length - 1])
          .clear({ force: true })
          .type(otpValue, { force: true, delay: 50 });
      }

      const otpAnchor = Cypress.$(candidates[candidates.length - 1]);
      const closestContainer = otpAnchor.closest(
        'form, [role="dialog"], .modal, .Modal, .popup, .wpcf7, .wpcf7-form, section, div'
      );
      const scopedButtons = closestContainer.length
        ? findOtpSubmitButtons(closestContainer)
        : Cypress.$();
      const fallbackButtons = findOtpSubmitButtons($body);

      if (scopedButtons.length) {
        cy.wrap(scopedButtons[scopedButtons.length - 1])
          .scrollIntoView()
          .click({ force: true });
      } else if (fallbackButtons.length) {
        cy.wrap(fallbackButtons[fallbackButtons.length - 1])
          .scrollIntoView()
          .click({ force: true });
      } else {
        cy.wrap(candidates[candidates.length - 1]).type('{enter}', { force: true });
      }
    });
});

Cypress.Commands.add('assertOtpStageNotOpened', () => {
  cy.get('body', { timeout: 15000 }).then(($body) => {
    const otpCount = findVisibleOtpInputs($body).length;
    expect(
      otpCount,
      'OTP form should not be visible for invalid/blocked lead submission'
    ).to.equal(0);
  });
});

Cypress.Commands.add('assertNumberAlreadyAssociated', () => {
  cy.assertRegistrationBlockedBySystem();
});

Cypress.Commands.add('cleanupLeadsForScenario', ({ emails = [], phones = [] } = {}) => {
  const selectedPlatform = String(Cypress.env('platform') || 'test').toLowerCase();
  const isMain = selectedPlatform === 'main';

  const emailDeleteBase = isMain
    ? (Cypress.env('emailDeleteBaseMain') ||
      'https://service.kraftshala.com/lead/remove-lead/mlp/')
    : (Cypress.env('emailDeleteBaseTest') ||
      'https://testservice.kraftshala.com/lead/remove-lead/mlp/');
  const phoneDeleteBase = isMain
    ? (Cypress.env('phoneDeleteBaseMain') ||
      'https://service.kraftshala.com/otp-validation/removeNumber/')
    : (Cypress.env('phoneDeleteBaseTest') ||
      'https://testservice.kraftshala.com/otp-validation/removeNumber/');

  const uniqueEmails = [...new Set(emails.map((v) => String(v || '').trim()).filter(Boolean))];
  const uniquePhones = [...new Set(phones.map((v) => String(v || '').trim()).filter(Boolean))];

  cy.wrap(uniqueEmails, { log: false }).each((email) => {
    cy.request({
      method: 'GET',
      url: `${emailDeleteBase}${encodeURIComponent(email)}`,
      failOnStatusCode: false,
      timeout: 20000,
    });
  });

  cy.wrap(uniquePhones, { log: false }).each((phone) => {
    cy.request({
      method: 'GET',
      url: `${phoneDeleteBase}${encodeURIComponent(phone)}`,
      failOnStatusCode: false,
      timeout: 20000,
    });
  });
});

// Opt-in `options` (used by ALM; MLP passes none and gets default behavior):
//   options.successUrlPattern    — RegExp the post-submit URL must match
//                                  (default: MLP screening-test path)
//   options.requireOnDemandHeader — boolean; when false, skip the on-demand
//                                  header check (ALM may not have it)
Cypress.Commands.add('assertLeadRegistrationSuccess', (_leadName, options = {}) => {
  const pathPattern =
    options.successUrlPattern ||
    /\/marketing-launchpad\/digital-marketing-course\/screening-test\/[^/]+\/[^/]+\/?$/;
  const requireOnDemandHeader = options.requireOnDemandHeader !== false;

  cy.location('pathname', { timeout: 90000 }).should((pathname) => {
    const path = String(pathname || '');
    expect(
      pathPattern.test(path),
      `Expected URL ending with .../screening-test/{id}/{id}/ — got pathname "${path}"`
    ).to.equal(true);
  });

  // On successful registration, lead summary must be visible.
  cy.get('.lead-name', { timeout: 90000 }).should('be.visible');
  if (requireOnDemandHeader) {
    cy.get('.on-demand-header-main > :nth-child(2)', { timeout: 90000 }).should(
      'be.visible'
    );
  }
});
