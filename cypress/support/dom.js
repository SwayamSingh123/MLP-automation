// Pure DOM helpers shared by the support commands and the specs.

// jQuery selectors do not support the CSS4 case-insensitive [attr*=x i] flag, so both casings are listed.
export const EMAIL_INPUT =
  'input[type="email"], input[name*="email"], input[name*="Email"], input[placeholder*="email"], input[placeholder*="Email"]';
export const PHONE_INPUT =
  'input[type="tel"], input[name*="phone"], input[name*="Phone"], input[placeholder*="phone"], input[placeholder*="Phone"]';

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buttonText(el) {
  return String(el.innerText || el.value || '').trim();
}

/** Visible buttons/links under $scope whose text matches `regex`. */
export function findButtons($scope, regex) {
  return $scope
    .find('button, [role="button"], a, input[type="submit"]')
    .filter((_, el) => Cypress.$(el).is(':visible') && regex.test(buttonText(el)));
}

/** Visible text input for the person's name. */
export function findNameInputs($scope) {
  return $scope.find('input').filter((_, el) => {
    const name = (el.getAttribute('name') || '').toLowerCase();
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return (
      Cypress.$(el).is(':visible') &&
      type !== 'hidden' &&
      type !== 'email' &&
      (name === 'name' || name.endsWith('name') || placeholder.includes('name'))
    );
  });
}

/** Visible OTP inputs: a single 4-8 digit box or one box per digit. */
export function findOtpInputs($scope) {
  return $scope.find('input').filter((_, el) => {
    if (!Cypress.$(el).is(':visible')) return false;
    const attrs = ['name', 'id', 'placeholder', 'class', 'autocomplete']
      .map((a) => (el.getAttribute(a) || '').toLowerCase())
      .join(' ');
    const maxLength = Number(el.getAttribute('maxlength') || 0);
    return attrs.includes('otp') || attrs.includes('one-time-code') || maxLength === 6 || maxLength === 1;
  });
}

/** Smallest ancestor of `el` that contains everything `selectors` lists. */
export function closestContaining(el, selectors) {
  let $cur = Cypress.$(el).parent();
  while ($cur.length && !$cur.is('body, html')) {
    if (selectors.every((s) => $cur.find(s).filter(':visible').length)) return $cur;
    $cur = $cur.parent();
  }
  return null;
}
