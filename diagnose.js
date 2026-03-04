const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

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
  console.log("\n=== M&A Diagnostic ===\n");

  // 1. Env vars
  console.log("① Env vars:");
  console.log("  ANTHROPIC_API_KEY:", ANTHROPIC_API_KEY ? "SET" : "MISSING");
  console.log("  RESEND_API_KEY:", RESEND_API_KEY ? "SET" : "MISSING");
  console.log("  EMAIL_TO:", EMAIL_TO ? "SET" : "MISSING");
  console.log("  EMAIL_FROM:", EMAIL_FROM ? "SET" : "MISSING");

  // 2. Anthropic API basic call
  console.log("\n② Anthropic API:");
  try {
    const res = await postAnthropic({
      model: "claude-sonnet-4-20250514", max_tokens: 20,
      messages: [{ role: "user", content: "Say OK" }]
    });
    if (res.error) console.log("  FAIL:", res.error.message);
    else console.log("  OK:", (res.content||[]).map(b=>b.text).join("").trim());
  } catch(e) { console.log("  EXCEPTION:", e.message); }

  // 3. Web search — get real BizBuySell listing URLs
  console.log("\n③ Web search for real listings:");
  try {
    const res = await postAnthropic({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: `Search for: site:bizbuysell.com "IT staffing" OR "managed service provider" OR "MSP" business for sale

List every URL from the search results exactly as they appear. Show at least 5 URLs.` }]
    });
    if (res.error) { console.log("  FAIL:", res.error.message); }
    else {
      const text = (res.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      console.log("  Result:\n" + text.slice(0, 1000));
    }
  } catch(e) { console.log("  EXCEPTION:", e.message); }

  // 4. Resend — actually send a test email
  console.log("\n④ Resend — sending test email:");
  try {
    const res = await postResend({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject: "M&A Agent Diagnostic — " + new Date().toISOString(),
      html: "<h2>Diagnostic Test</h2><p>If you received this, Resend is working correctly.</p><p>Sent at: " + new Date().toISOString() + "</p>"
    });
    console.log("  Full Resend response:", JSON.stringify(res));
  } catch(e) { console.log("  EXCEPTION:", e.message); }

  console.log("\n=== Done ===\n");
}

main().catch(e => { console.error("CRASHED:", e.message); process.exit(1); });
