// One download flow (brochure / syllabus / prospectus): clean the lead, fill
// the download form, verify OTP, then check the success copy and the backend calls.
const OTP_VALIDATE = /\/otp-validation\/validate\/?$/;

export function defineDownloadTest({ title, testName, fixture, cta, documentText }) {
  describe(title, () => {
    it(testName, () => {
      Object.assign(globalThis.testDetail(), {
        kind: 'lead',
        form: fixture.form,
        page: fixture.page,
        expectation: `"You're all set. We've sent the ${documentText} to your email and WhatsApp."`,
        lead: fixture.lead,
      });
      cy.cleanupLead({
        programSlug: fixture.programSlug,
        emails: [fixture.lead.email],
        // alsoFreePhones: numbers the email may still be bound to in the OTP service
        // (the lead form's "blocked" case binds it to its alternate phone).
        phones: [fixture.lead.phone, ...(fixture.alsoFreePhones || [])],
      });
      cy.visitPage(fixture.page);
      cy.apiMark().then((since) => {
        cy.openDownloadForm(cta);
        cy.fillDownloadForm({ ...fixture.lead, whatsappOptIn: true });
        cy.enterOtpAndSubmit(fixture.otp);
        cy.verifyApi('OTP validation', 'POST', OTP_VALIDATE, { since });
        cy.assertDownloadSuccess(documentText);
        cy.recordDetail({ submission: { ok: true, outcome: `Success message shown: ${documentText} sent` } });
      });
    });
  });
}
