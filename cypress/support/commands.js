// Page navigation, lead form and OTP commands shared by MLP, ALM, BASL and the
// download / callback flows. Every command fails loudly if the element it needs
// is missing — nothing is silently skipped.
import {
  EMAIL_INPUT,
  PHONE_INPUT,
  findButtons,
  findNameInputs,
  findOtpInputs,
  closestContaining,
  escapeRegex,
} from './dom';

// Lead-form CTA: MLP "Start your marketing journey", ALM "Apply Now",
// BASL "Get your candidature evaluated".
const LEAD_CTA_TEXT = /start your marketing journey|apply now|candidature|evaluate|submit/i;
const OTP_SUBMIT_TEXT = /submit|verify|confirm|validate|continue/i;
const OTP_VALIDATE_PATH = /\/otp-validation\/validate\/?$/;

Cypress.Commands.add('visitPage', (path, options = {}) => {
  cy.visit(path, options);
  cy.selectPlatformIfPresent();
});

// The test environment sometimes shows a "testing on test/main platform" chooser.
Cypress.Commands.add('selectPlatformIfPresent', () => {
  const label =
    Cypress.env('platform') === 'main' ? /testing on main platform/i : /testing on test platform/i;
  cy.get('body').then(($body) => {
    if (!label.test($body.text())) return;
    cy.contains(label).click();
  });
});

/**
 * Type into a field and prove it took the value. Phone inputs reformat what is
 * typed ("6984756410" -> "+91 69847 56410"), so numbers are compared by digits.
 */
Cypress.Commands.add('typeInto', { prevSubject: 'element' }, ($input, value) => {
  const text = String(value);
  cy.wrap($input).clear().type(text);
  if (/^\d+$/.test(text)) {
    cy.wrap($input).should(($el) => {
      expect(String($el.val()).replace(/\D/g, ''), 'digits in the field').to.match(new RegExp(`${text}$`));
    });
  } else {
    cy.wrap($input).should('have.value', text);
  }
});

/**
 * Pick an option in the site's custom dropdown (.dropdown-button + .dropdown-option).
 * Subject: the dropdown trigger. Proves the choice by the trigger showing the label.
 */
Cypress.Commands.add('pickDropdownOption', { prevSubject: 'element' }, ($trigger, label) => {
  const exact = new RegExp(`^\\s*${escapeRegex(label)}\\s*$`, 'i');
  cy.wrap($trigger).click();
  cy.wrap($trigger.closest('.custom-dropdown, .dropdown-wrapper, form, [role="dialog"], .modal'))
    .find('.dropdown-option, [role="option"], li')
    .filter((_, el) => Cypress.$(el).is(':visible') && exact.test(el.innerText || ''))
    .should('have.length.at.least', 1)
    .first()
    .click();
  cy.wrap($trigger).should('contain.text', label);
});

/**
 * Yields the lead form root: the smallest container around a visible CTA that
 * also holds the email and phone inputs. Uses the last match on the page, which
 * is the main lead form (hero/sticky CTAs come earlier).
 */
Cypress.Commands.add('getLeadForm', () => {
  const pick = ($body) => {
    const $ctas = $body.find('.submit-btn').filter(':visible').add(findButtons($body, LEAD_CTA_TEXT));
    let root = null;
    $ctas.each((_, el) => {
      root = closestContaining(el, [EMAIL_INPUT, PHONE_INPUT]) || root;
    });
    return root;
  };
  return cy
    .get('body', { timeout: 20000 })
    .should(($body) => {
      expect(pick($body), 'lead form (email + phone inputs + submit button)').to.not.equal(null);
    })
    .then(($body) => cy.wrap(pick($body), { log: false }));
});

function leadSubmitButton($form) {
  const $byClass = $form.find('.submit-btn').filter(':visible');
  const $buttons = $byClass.length ? $byClass : findButtons($form, LEAD_CTA_TEXT);
  if (!$buttons.length) throw new Error('Lead form submit button not found');
  return $buttons.last();
}

/** Click the lead form's submit button. */
Cypress.Commands.add('submitLeadForm', () => {
  cy.getLeadForm().then(($form) => cy.wrap(leadSubmitButton($form)).click());
});

/**
 * Choose the "Yes"/"No" WhatsApp opt-in inside `$scope`. Uses the radio input
 * when there is one (clicking its text label does not select it on every page)
 * and proves it ended up checked.
 */
export function clickOptIn($scope, answer) {
  const regex = answer ? /^\s*yes\s*$/i : /^\s*no\s*$/i;
  const $radio = $scope.find('input[type="radio"]').filter((_, el) => {
    const label = el.id ? $scope.find(`label[for="${el.id}"]`).text() : '';
    const wrapper = Cypress.$(el).parent().text();
    return regex.test(el.value || '') || regex.test(label) || regex.test(wrapper);
  });
  if ($radio.length) {
    // Styled radios hide the real <input> behind a custom circle; force is safe
    // here because the assertion proves the selection took effect.
    cy.wrap($radio.first()).check({ force: true }).should('be.checked');
    return;
  }
  const $opt = $scope
    .find('label, button, [role="button"], [role="radio"], span, div')
    .filter((_, el) => Cypress.$(el).is(':visible') && regex.test(el.innerText || ''))
    .last();
  if (!$opt.length) throw new Error(`WhatsApp opt-in "${answer ? 'Yes' : 'No'}" not found in the form`);
  cy.wrap($opt).click();
}

// data: { name, email, phone, whatsappOptIn } — empty values are left blank.
Cypress.Commands.add('fillLeadForm', ({ name, email, phone, whatsappOptIn }) => {
  cy.getLeadForm().then(($form) => {
    if (name) {
      const $name = findNameInputs($form);
      if (!$name.length) throw new Error('Name input not found in the lead form');
      cy.wrap($name.first()).typeInto(name);
    }
    if (email) cy.wrap($form.find(EMAIL_INPUT).filter(':visible').first()).typeInto(email);
    if (phone) cy.wrap($form.find(PHONE_INPUT).filter(':visible').last()).typeInto(phone);
    if (whatsappOptIn !== undefined) clickOptIn($form, whatsappOptIn);
  });
  cy.submitLeadForm();
});

Cypress.Commands.add('waitForOtpStage', () => {
  cy.get('body', { timeout: 45000 }).should(($body) => {
    expect(findOtpInputs($body).length, 'OTP input visible').to.be.greaterThan(0);
  });
});

Cypress.Commands.add('enterOtpAndSubmit', (otp) => {
  const value = String(otp || '').trim();
  expect(value, 'OTP from fixture').to.match(/^\d{4,8}$/);
  cy.waitForOtpStage();

  cy.apiMark().then((since) => {
    cy.get('body').then(($body) => {
      const $inputs = findOtpInputs($body);
      const $digits = $inputs.filter((_, el) => Number(el.getAttribute('maxlength')) === 1);
      if ($digits.length >= value.length) {
        value.split('').forEach((digit, i) => cy.wrap($digits[i]).type(digit).should('have.value', digit));
      } else {
        cy.wrap($inputs.last()).typeInto(value);
      }
    });

    // Most forms submit on their own once the last digit is typed. Clicking
    // Submit as well sends a second validate request (the backend answers it
    // with a 500), so only click when the page did not submit by itself.
    cy.waitForApi('POST', OTP_VALIDATE_PATH, { since, timeout: 3000, sent: true }).then((call) => {
      if (!call) clickOtpSubmit();
    });
  });
});

function clickOtpSubmit() {
  cy.get('body').then(($body) => {
    const $otp = findOtpInputs($body).last();
    let $scope = $otp.parent();
    while ($scope.length && !$scope.is('body') && !findButtons($scope, OTP_SUBMIT_TEXT).length) {
      $scope = $scope.parent();
    }
    const $buttons = findButtons($scope.length ? $scope : $body, OTP_SUBMIT_TEXT);
    if (!$buttons.length) throw new Error('OTP submit button not found');
    cy.wrap($buttons.last()).click();
  });
}

/** No OTP step may open (invalid / blank submissions). */
Cypress.Commands.add('assertOtpStageNotOpened', () => {
  cy.get('body').should(($body) => {
    expect(findOtpInputs($body).length, 'OTP inputs visible').to.equal(0);
  });
});
