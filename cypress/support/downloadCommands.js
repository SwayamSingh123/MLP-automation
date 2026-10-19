// "Download brochure / syllabus / prospectus" flows on the MLP and ALM pages.
// The form opens inline or in a modal; it is located from its Next button.
import { clickOptIn } from './commands';
import { EMAIL_INPUT, PHONE_INPUT, findButtons, findNameInputs, closestContaining } from './dom';

const MODAL = '[role="dialog"], .modal, .Modal, .popup, .ReactModal__Content, .MuiDialog-paper';
const DOWNLOAD_NEXT = '[class*="next-button-download"]';
const NEXT_TEXT = /^\s*(next|proceed)\s*[→›»>]?\s*$/i;

function downloadFormScope($body) {
  const $modal = $body.find(MODAL).filter(':visible').filter((_, el) => Cypress.$(el).find(EMAIL_INPUT).length);
  if ($modal.length) return $modal.last();
  const $next = $body.find(DOWNLOAD_NEXT).filter(':visible').add(findButtons($body, NEXT_TEXT));
  for (let i = $next.length - 1; i >= 0; i -= 1) {
    const root = closestContaining($next[i], [EMAIL_INPUT]);
    if (root) return root;
  }
  return null;
}

function nextButton($scope) {
  const $byClass = $scope.find(DOWNLOAD_NEXT).filter(':visible');
  return $byClass.length ? $byClass.last() : findButtons($scope, NEXT_TEXT).last();
}

/** Open the download form from its CTA, e.g. /download\s*brochure/i. */
Cypress.Commands.add('openDownloadForm', (ctaText) => {
  const find = ($body) => findButtons($body, ctaText).last();
  cy.get('body', { timeout: 20000 }).should(($body) => {
    expect(find($body).length, `visible "${ctaText}" button`).to.be.greaterThan(0);
  });
  cy.get('body').then(($body) => cy.wrap(find($body)).scrollIntoView());
  // Re-query: scrolling can re-render the section and detach the old element.
  cy.get('body').then(($body) => cy.wrap(find($body)).click());
  cy.get('body', { timeout: 15000 }).should(($body) => {
    expect(downloadFormScope($body), 'download form (email input + Next button)').to.not.equal(null);
  });
});

// data: { name, email, phone, whatsappOptIn }
Cypress.Commands.add('fillDownloadForm', ({ name, email, phone, whatsappOptIn }) => {
  cy.get('body').then(($body) => {
    const $form = downloadFormScope($body);
    const $name = findNameInputs($form);
    if (!$name.length) throw new Error('Name input not found in the download form');
    cy.wrap($name.first()).typeInto(name);
    cy.wrap($form.find(EMAIL_INPUT).filter(':visible').first()).typeInto(email);
    cy.wrap($form.find(PHONE_INPUT).filter(':visible').last()).typeInto(phone);
    if (whatsappOptIn !== undefined) clickOptIn($form, whatsappOptIn);
  });
  cy.get('body').should(($body) => {
    const $next = nextButton(downloadFormScope($body));
    expect($next.length, 'Next button').to.be.greaterThan(0);
    expect($next.is(':disabled'), 'Next button enabled').to.equal(false);
  });
  cy.get('body').then(($body) => cy.wrap(nextButton(downloadFormScope($body))).click());
});

/** Final screen: "You're all set. We've sent the <document> to your email and WhatsApp." */
Cypress.Commands.add('assertDownloadSuccess', (documentText) => {
  cy.contains(/you['’]?re all set/i, { timeout: 60000 }).should('be.visible');
  cy.contains(new RegExp(`we['’]?ve sent the ${documentText} to your email and whatsapp`, 'i'), {
    timeout: 10000,
  }).should('be.visible');
});
