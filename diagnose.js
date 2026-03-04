// ============================================================
// DIAGNOSTIC SCRIPT — run this in GitHub Actions to find
// exactly what's failing. Check the Actions log output.
// node diagnose.js
// ============================================================

const https = require("https");
const http  = require("http");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

function ok(msg)   { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); }
function info(msg) { console.log(`  · ${msg}`); }

// ── simple fetch ──────────────────────────────────────────────
function fetchPage(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
      timeout: 15000,
    }, res => {
      let d = "";
      res.on("data", c => { d += c; if (d.length > 100000) req.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode, len: d.length, html: d.slice(0,500) }));
    });
    req.on("error", e => resolve({ status: "ERR", error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ status: "TIMEOUT" }); });
  });
}

function postAnthropic(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      }
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on("error", reject); req.write(payload); req.end();
  });
}

function postResend(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: "api.resend.com", path: "/emails", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      }
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on("error", reject); req.write(payload); req.end();
  });
}

async function main() {
  console.log("\n============================================");
  console.log("  M&A Agent — Diagnostic");
  console.log(`  ${new Date().toISOString()}`);
  console.log("============================================\n");

  // ── 1. Check env vars
  console.log("① Environment variables:");
  ANTHROPIC_API_KEY ? ok(`ANTHROPIC_API_KEY set (${ANTHROPIC_API_KEY.slice(0,8)}...)`) : fail("ANTHROPIC_API_KEY missing!");
  RESEND_API_KEY    ? ok(`RESEND_API_KEY set (${RESEND_API_KEY.slice(0,8)}...)`)    : fail("RESEND_API_KEY missing!");
  EMAIL_TO          ? ok(`EMAIL_TO: ${EMAIL_TO}`)          : fail("EMAIL_TO missing!");
  EMAIL_FROM        ? ok(`EMAIL_FROM: ${EMAIL_FROM}`)       : fail("EMAIL_FROM missing!");

  // ── 2. Test direct site fetches
  console.log("\n② Direct site fetches:");
  const sites = [
    "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=IT+staffing",
    "https://www.bizquest.com/business-for-sale/technology-internet-businesses/",
    "https://synergybb.com/businesses-for-sale/it-services-companies-for-sale/",
    "https://www.itexchangenet.com/for-sale",
    "https://bramptoncapital.com/managed-services-companies-for-sale/",
    "https://dealstream.com/l/buy/it-services",
    "https://lionbusinessbrokers.com/businesses-for-sale/",
    "https://www.businessbroker.net/business-for-sale/technology-businesses/",
  ];
  for (const url of sites) {
    const domain = new URL(url).hostname;
    const r = await fetchPage(url);
    if (r.status === 200) {
      ok(`${domain} — ${r.len.toLocaleString()} bytes`);
      // Check if it looks like real HTML or a bot block / JS shell
      const hasContent = r.html.includes("<a ") || r.html.includes("<div");
      const isJsOnly = r.html.includes("__NEXT_DATA__") || r.html.includes("window.__") || r.html.length < 2000;
      if (isJsOnly) info(`  ⚠ Looks JS-rendered (thin HTML) — may not have listing data`);
      else if (hasContent) info(`  HTML looks good`);
    } else {
      fail(`${domain} — ${r.status} ${r.error || ""}`);
    }
  }

  // ── 3. Test Anthropic API
  console.log("\n③ Anthropic API:");
  try {
    const res = await postAnthropic({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      messages: [{ role: "user", content: "Say OK" }]
    });
    if (res.error) fail(`API error: ${res.error.message}`);
    else ok(`API working — response: "${(res.content||[]).map(b=>b.text).join("").slice(0,30)}"`);
  } catch(e) { fail(`API exception: ${e.message}`); }

  // ── 4. Test Resend
  console.log("\n④ Resend email:");
  try {
    const res = await postResend({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject: "M&A Agent — Diagnostic Test",
      html: `<p>Diagnostic test sent at ${new Date().toISOString()}. If you got this, email delivery is working.</p>`
    });
    if (res.error) fail(`Resend error: ${JSON.stringify(res.error)}`);
    else if (res.id) ok(`Email sent! id: ${res.id}`);
    else fail(`Unexpected response: ${JSON.stringify(res)}`);
  } catch(e) { fail(`Resend exception: ${e.message}`); }

  // ── 5. Quick test: does BizBuySell HTML contain listing links?
  console.log("\n⑤ BizBuySell listing link check:");
  try {
    const r = await fetchPage("https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=IT+staffing");
    if (r.status === 200) {
      const matches = r.html.match(/Business-Opportunity[^"'\s]*/g) || [];
      ok(`Found ${matches.length} /Business-Opportunity/ URLs in first 500 bytes`);
      if (matches.length > 0) info(`Sample: ${matches[0]}`);
    }
  } catch(e) { fail(e.message); }

  console.log("\n============================================");
  console.log("  Diagnostic complete");
  console.log("============================================\n");
}

main().catch(e => { console.error("Diagnostic crashed:", e.message); process.exit(1); });
