// Central support file for Cypress E2E tests.
// Loads custom commands for MLP lead form + brochure/syllabus flows, the API
// monitoring layer (lead/create + otp-validation/validate), and the Meta Pixel
// monitor (facebook.com/tr/ — first test of the run only).

import './commands';
import './commands/downloadCommands';
import './apiMonitor';
import './pixelMonitor';

