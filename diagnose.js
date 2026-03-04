const https = require("https");
const http  = require("http");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

function ok(msg)   { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); }
function info(msg) { console.log(`    · ${msg}`); }

function fetchPage(url) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith("https") ? https : http;
      const req = lib.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
        timeout: 12000,
      }, res => {
        let d = "";
        res.on("data", c => { d += c; if (d.length > 50000) req.destroy(); });
        res.on("end", () => resolve({ status: res.statusCode, len: d.length, html: d.slice(0, 1000) }));
      });
      req.on("error", e => resolve({ status: "ERR", error: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ status: "TIMEOUT" }); });
    } catch(e) { resolve({ status: "ERR", error: e.message }); }
  });
}

function postAnthropic(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
    }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } }); });
    req.on("error", reject); req.write(payload); req.end();
  });
}

function postResend(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: "api.resend.com", path: "/emails", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "Authorization": `Bearer ${RESEND_API_KEY}` }
    }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } }); });
    req.on("error", reject); req.write(payload); req.end();
  });
}

async function main() {
  console.log("\n============================================");
  console.log("  M&A Agent — Diagnostic");
  console.log(`  ${new Date().toISOString()}`);
  console.log("============================================\n");

  // ① Env vars
  console.log("① Environment variables:");
  ANTHROPIC_API_KEY ? ok(`ANTHROPIC_API_KEY set (${ANTHROPIC_API_KEY.slice(0,10)}...)`) : fail("ANTHROPIC_API_KEY missing!");
  RESEND_API_KEY    ? ok(`RESEND_API_KEY set (${RESEND_API_KEY.slice(0,10)}...)`)        : fail("RESEND_API_KEY missing!");
  EMAIL_TO          ? ok(`EMAIL_TO set`)   : fail("EMAIL_TO missing!");
  EMAIL_FROM        ? ok(`EMAIL_FROM set`) : fail("EMAIL_FROM missing!");

  // ② Site fetches — don't stop on failure
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
    try {
      const domain = new URL(url).hostname;
      const r = await fetchPage(url);
      if (r.status === 200) {
        ok(`${domain} — ${r.len.toLocaleString()} bytes`);
        const isJsOnly = r.len < 3000 || (r.html.includes("__NEXT_DATA__") && !r.html.includes("<a href"));
        if (isJsOnly) info("⚠ Looks JS-rendered — likely no listing data in HTML");
        else info("HTML looks server-rendered");
      } else {
        fail(`${domain} — HTTP ${r.status} (blocked)`);
      }
    } catch(e) { fail(`${url} — ${e.message}`); }
  }

  // ③ Anthropic API
  console.log("\n③ Anthropic API:");
  try {
    const res = await postAnthropic({
      model: "claude-sonnet-4-20250514", max_tokens: 50,
      messages: [{ role: "user", content: "Reply with just the word OK" }]
    });
    if (res.error) fail(`API error: ${res.error.message}`);
    else ok(`API working — "${(res.content||[]).map(b=>b.text).join("").trim()}"`);
  } catch(e) { fail(`API exception: ${e.message}`); }

  // ④ Claude web search
  console.log("\n④ Claude web search (find 1 real BizBuySell listing):");
  try {
    const res = await postAnthropic({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: 'Search for: site:bizbuysell.com "IT staffing" business for sale\n\nList the first 3 result URLs you find, exactly as they appear.' }]
    });
    if (res.error) { fail(`Search error: ${res.error.message}`); }
    else {
      const text = (res.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      ok(`Web search working`);
      info(`Results preview:\n${text.slice(0,600)}`);
    }
  } catch(e) { fail(`Search exception: ${e.message}`); }

  // ⑤ Resend
  console.log("\n⑤ Resend email:");
  try {
    const res = await postResend({
      from: EMAIL_FROM, to: [EMAIL_TO],
      subject: "M&A Agent — Diagnostic Test",
      html: `<p>Diagnostic test at ${new Date().toISOString()}. Email delivery is working.</p>`
    });
    if (res.error) fail(`Resend error: ${JSON.stringify(res.error)}`);
    else if (res.id) ok(`Email sent! id: ${res.id}`);
    else fail(`Unexpected: ${JSON.stringify(res).slice(0,200)}`);
  } catch(e) { fail(`Resend exception: ${e.message}`); }

  console.log("\n============================================");
  console.log("  Done");
  console.log("============================================\n");
}

main().catch(e => { console.error("Diagnostic crashed:", e.message); process.exit(1); });
