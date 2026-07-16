/* eslint-disable no-console */
//
// Called by .github/workflows/run-all.yml after Cypress finishes.
// Reads cypress/reports/run-all-output.log, parses the per-spec summary
// and the individual test failures, uploads any failure screenshots to
// catbox.moe so they're viewable via public URL, then POSTs a formatted
// Google Chat report (with inline screenshot images per failure) via the
// GCHAT_WEBHOOK_URL secret.
//
// Standalone by design — this file must run in a fresh GitHub Actions
// checkout without pulling in form-server.js's imports.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const LOG_PATH = path.join(REPO_ROOT, 'cypress', 'reports', 'run-all-output.log');
const SCREENSHOTS_DIR = path.join(REPO_ROOT, 'cypress', 'screenshots');

const GCHAT_WEBHOOK_URL = process.env.GCHAT_WEBHOOK_URL || '';
const PLATFORM = String(process.env.RUN_ALL_PLATFORM || 'test').toLowerCase();
const REQUEST_ID = String(process.env.RUN_ALL_REQUEST_ID || '');
const TRIGGER_URL = String(process.env.RUN_ALL_TRIGGER_URL || '');
const WORKFLOW_URL = String(process.env.RUN_ALL_WORKFLOW_URL || '');

const MAX_SCREENSHOTS_TO_UPLOAD = 20; // safety cap in case of many failures
const CATBOX_TIMEOUT_MS = 30000;

// ── Text parsing helpers ──────────────────────────────────────────────────

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function mmssToSec(mmss) {
  const parts = String(mmss || '').split(':').map((x) => Number(x));
  if (parts.length !== 2 || parts.some(isNaN)) return 0;
  return parts[0] * 60 + parts[1];
}

function fmtDuration(sec) {
  const s = Number(sec) || 0;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function specToMode(specPath) {
  if (/mlpLeadForm|downloadBrochure|downloadSyllabus/i.test(specPath)) return 'MLP';
  if (/almLeadForm|almDownloadProspectus/i.test(specPath)) return 'ALM';
  if (/smblLeadForm/i.test(specPath)) return 'SMBL';
  if (/ksLiveRegistration/i.test(specPath)) return 'KS Live';
  if (/requestCallback/i.test(specPath)) return 'Callback';
  if (/seoChecklist/i.test(specPath)) return 'SEO';
  if (/brokenLinkChecker/i.test(specPath)) return 'Links';
  return specPath;
}

function parseSpecRows(logText) {
  const cleaned = stripAnsi(logText);
  const rowRegex =
    /[│|]\s+([✔✖✓✗√X])\s+([^\s│|]+\.cy\.js)\s+(\d+:\d+)\s+(\d+)\s+(\d+)\s+(\d+)/g;
  const rows = [];
  let m;
  while ((m = rowRegex.exec(cleaned)) !== null) {
    const [, icon, spec, duration, total, passing, failing] = m;
    rows.push({
      spec,
      durationSec: mmssToSec(duration),
      total: Number(total) || 0,
      passing: Number(passing) || 0,
      failing: Number(failing) || 0,
      ok: /[✔✓√]/.test(icon),
    });
  }
  return rows;
}

function parseFailures(logText) {
  const cleaned = stripAnsi(logText);
  const lines = cleaned.split(/\r?\n/);
  const failures = [];
  let currentSpec = '';
  for (const line of lines) {
    const specMatch = line.match(/^\s*Running:\s+(\S+\.cy\.js)/);
    if (specMatch) {
      currentSpec = specMatch[1];
      continue;
    }
    const failMatch = line.match(/^\s*\d+\)\s+(.+)$/);
    if (failMatch) {
      failures.push({ spec: currentSpec, name: failMatch[1].trim() });
    }
  }
  return failures;
}

function aggregateByMode(specRows) {
  const map = new Map();
  for (const row of specRows) {
    const mode = specToMode(row.spec);
    if (!map.has(mode)) {
      map.set(mode, { mode, total: 0, passing: 0, failing: 0, durationSec: 0 });
    }
    const agg = map.get(mode);
    agg.total += row.total;
    agg.passing += row.passing;
    agg.failing += row.failing;
    agg.durationSec += row.durationSec;
  }
  return map;
}

// ── Screenshot discovery + upload ─────────────────────────────────────────

// Recursively walk a directory, returning absolute paths of every .png.
function findScreenshots(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// Match one screenshot file to a specific failed test. Cypress default
// convention: cypress/screenshots/<spec>/<describe> -- <test name> (failed).png
function matchScreenshotToFailure(failure, allScreenshots) {
  const nameEscaped = failure.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Look for a screenshot whose filename ends in "-- <test name> (failed).png"
  // (case insensitive; Cypress replaces some special chars but our name
  // regex is lenient enough to still hit).
  const suffixRegex = new RegExp(
    '\\s--\\s' + nameEscaped + '\\s*\\(failed\\)(?:\\s*\\(attempt\\s*\\d+\\))?\\.png$',
    'i'
  );
  const specSlashed = failure.spec.replace(/\\/g, '/');
  for (const shot of allScreenshots) {
    const slashed = shot.replace(/\\/g, '/');
    if (!slashed.includes('/' + specSlashed + '/')) continue;
    if (suffixRegex.test(slashed)) return shot;
  }
  // Fallback — any screenshot in the spec's folder whose base name contains
  // a normalised version of the test name (last-resort match).
  const nameLoose = failure.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const shot of allScreenshots) {
    const slashed = shot.replace(/\\/g, '/');
    if (!slashed.includes('/' + specSlashed + '/')) continue;
    const baseNormalised = path.basename(shot).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (baseNormalised.includes(nameLoose)) return shot;
  }
  return null;
}

// Upload a single file to catbox.moe (anonymous). Returns the public URL
// on success, null on any failure (never throws — never blocks the report).
async function uploadToCatbox(filePath) {
  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    console.warn('[screenshots] Node 18+ FormData/Blob/fetch unavailable — skipping upload');
    return null;
  }
  try {
    const buf = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buf], { type: 'image/png' }), filename);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATBOX_TIMEOUT_MS);
    try {
      const resp = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!resp.ok) {
        console.warn(`[screenshots] catbox HTTP ${resp.status} for ${filename}`);
        return null;
      }
      const url = (await resp.text()).trim();
      if (!/^https?:\/\/files\.catbox\.moe\/.+\.png$/i.test(url)) {
        console.warn(`[screenshots] catbox returned unexpected response: ${url.slice(0, 200)}`);
        return null;
      }
      console.log(`[screenshots] Uploaded ${filename} → ${url}`);
      return url;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[screenshots] Upload failed for ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

// Upload all failure screenshots and return a map: failure-key → image URL.
// failure-key = `${spec}|${name}` (matches what's produced later by builder).
async function uploadFailureScreenshots(failures) {
  const all = findScreenshots(SCREENSHOTS_DIR);
  console.log(`[screenshots] Found ${all.length} screenshot file(s) in ${SCREENSHOTS_DIR}`);
  if (all.length === 0 || failures.length === 0) return new Map();

  const urlMap = new Map();
  const toUpload = [];
  for (const failure of failures) {
    const match = matchScreenshotToFailure(failure, all);
    if (match) toUpload.push({ failure, path: match });
    if (toUpload.length >= MAX_SCREENSHOTS_TO_UPLOAD) break;
  }
  console.log(`[screenshots] Matched ${toUpload.length} failure(s) to screenshots — uploading…`);

  // Sequential upload — parallel would risk catbox rate-limiting.
  for (const { failure, path: filePath } of toUpload) {
    const url = await uploadToCatbox(filePath);
    if (url) urlMap.set(`${failure.spec}|${failure.name}`, url);
  }
  console.log(`[screenshots] ${urlMap.size} of ${toUpload.length} upload(s) succeeded`);
  return urlMap;
}

// ── Message builder ───────────────────────────────────────────────────────

const MODE_ORDER = ['MLP', 'ALM', 'SMBL', 'KS Live', 'Callback', 'SEO', 'Links'];

function buildTextMessage(specRows, failures, screenshotUrls) {
  const platform = PLATFORM.toUpperCase();
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const byMode = aggregateByMode(specRows);
  const totalDurationSec = specRows.reduce((s, r) => s + r.durationSec, 0);

  const lines = [];
  lines.push('🤖 *Kraftshala Automation — Run All Report*');
  lines.push(
    `Platform: *${platform}*  ·  Duration: *${fmtDuration(totalDurationSec)}*  ·  ${timestamp}`
  );
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('*📊 SUMMARY*');
  lines.push('');

  let totalPass = 0;
  let totalFail = 0;
  for (const modeName of MODE_ORDER) {
    const m = byMode.get(modeName);
    const label = modeName.padEnd(10);
    if (!m || m.total === 0) {
      lines.push(`⚠️  ${label} did not run`);
      continue;
    }
    const icon = m.failing > 0 ? '❌' : '✅';
    totalPass += m.passing;
    totalFail += m.failing;
    lines.push(
      `${icon}  ${label} ${m.passing}/${m.total} passed  (${fmtDuration(m.durationSec)})` +
        (m.failing > 0 ? `  ⚠ ${m.failing} failed` : '')
    );
  }
  lines.push('');
  const overallIcon = totalFail === 0 ? '✅' : '❌';
  lines.push(`${overallIcon}  *Total: ${totalPass}/${totalPass + totalFail} tests passed*`);

  // Failures with screenshot URLs.
  if (failures.length > 0) {
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('*❌ FAILURES DETAIL*');
    lines.push('');
    const byMode2 = new Map();
    for (const f of failures) {
      const mode = specToMode(f.spec);
      if (!byMode2.has(mode)) byMode2.set(mode, []);
      byMode2.get(mode).push(f);
    }
    for (const [mode, list] of byMode2) {
      lines.push(`▪ *${mode}* — ${list.length} failed`);
      const shown = list.slice(0, 8);
      for (const f of shown) {
        lines.push(`  • ${f.name}`);
        const url = screenshotUrls.get(`${f.spec}|${f.name}`);
        if (url) {
          lines.push(`    📸 Screenshot: ${url}`);
        }
      }
      if (list.length > shown.length) {
        lines.push(`  … and ${list.length - shown.length} more`);
      }
      lines.push('');
    }
  }

  // Trailer links.
  const trailers = [];
  if (WORKFLOW_URL) trailers.push('🔗 GitHub Actions run: ' + WORKFLOW_URL);
  if (TRIGGER_URL) trailers.push('▶ Run again: ' + TRIGGER_URL);
  if (trailers.length) {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    trailers.forEach((t) => lines.push(t));
  }

  return lines.join('\n');
}

// Build a Google Chat Cards V2 payload with inline image widgets per
// failure. Text summary lives in `text`; the card holds the screenshots
// so Chat renders them inline instead of as bare URLs.
function buildCardsV2Payload(text, failures, screenshotUrls) {
  const failuresWithShots = failures.filter((f) =>
    screenshotUrls.get(`${f.spec}|${f.name}`)
  );
  if (failuresWithShots.length === 0) {
    return { text };
  }

  // One section per failure with a screenshot — max 20 to stay under
  // Chat's card size limits.
  const sections = [];
  for (const f of failuresWithShots.slice(0, 20)) {
    const mode = specToMode(f.spec);
    const url = screenshotUrls.get(`${f.spec}|${f.name}`);
    sections.push({
      header: `❌ ${mode}: ${f.name}`,
      collapsible: true,
      uncollapsibleWidgetsCount: 1,
      widgets: [
        { image: { imageUrl: url, altText: f.name } },
      ],
    });
  }

  return {
    text,
    cardsV2: [
      {
        cardId: 'run-all-failure-screenshots',
        card: {
          header: {
            title: '📸 Failure Screenshots',
            subtitle: `${failuresWithShots.length} screenshot(s) — click to expand`,
          },
          sections,
        },
      },
    ],
  };
}

// ── Networking ────────────────────────────────────────────────────────────

async function postToGchat(payload) {
  if (!GCHAT_WEBHOOK_URL) {
    console.error('[gchat] GCHAT_WEBHOOK_URL secret not set — cannot post report');
    return { ok: false, skipped: true };
  }
  try {
    const resp = await fetch(GCHAT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    });
    console.log('[gchat] Response status:', resp.status);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[gchat] Response body:', body.slice(0, 500));
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[gchat] Post failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

(async () => {
  let raw = '';
  try {
    raw = fs.readFileSync(LOG_PATH, 'utf8');
  } catch (err) {
    console.error('Could not read Cypress log at ' + LOG_PATH + ':', err.message);
    const msg =
      '🤖 *Kraftshala Automation — Run All Report*\n\n' +
      '❌ Cypress did not produce a log file. Check the GitHub Actions run.\n\n' +
      (WORKFLOW_URL ? '🔗 GitHub Actions run: ' + WORKFLOW_URL : '');
    await postToGchat({ text: msg });
    process.exit(0);
  }

  const specRows = parseSpecRows(raw);
  const failures = parseFailures(raw);
  console.log(
    `Parsed ${specRows.length} spec row(s) and ${failures.length} failed test(s) from Cypress output.`
  );

  // Upload screenshots BEFORE building the message so we can embed the URLs.
  const screenshotUrls = await uploadFailureScreenshots(failures);

  const text = buildTextMessage(specRows, failures, screenshotUrls);
  const payload = buildCardsV2Payload(text, failures, screenshotUrls);

  console.log('---Google Chat message preview---');
  console.log(text);
  console.log('---end preview---');

  await postToGchat(payload);
})();
