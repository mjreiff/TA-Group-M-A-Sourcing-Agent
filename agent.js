// ============================================================
// M&A Sourcing Agent
// Finds real listing URLs via Claude web search, then uses
// the search snippet (not page fetch) to get details.
// BizBuySell blocks page fetches so we extract what we can
// from search result snippets directly.
// ============================================================

const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

const GATED_SOURCES = [
  { name:"Axial.net",                url:"https://www.axial.net",                                  note:"Register free. Filter by IT Services / Staffing." },
  { name:"FOCUS Investment Banking", url:"https://focusbankers.com/it-services-msp/",               note:"Specialist MSP & IT M&A advisor." },
  { name:"Corum Group",              url:"https://corumgroup.com/transactions/",                    note:"Tech M&A. Review recent transactions." },
  { name:"Griffin Financial Group",  url:"https://www.griffinfingroup.com/industries/staffing/",    note:"IT staffing M&A specialist." },
  { name:"MKLINK MSP Marketplace",   url:"https://mklink.org/mergers-acquisitions/",                note:"MSP-exclusive broker." },
  { name:"Generational Equity",      url:"https://www.genequity.com/businesses-for-sale/",          note:"Mid-market. Browse technology." },
  { name:"Benchmark International",  url:"https://www.benchmarkcorporate.com/businesses-for-sale", note:"Global firm. Filter by technology." },
  { name:"Colonnade Advisors",       url:"https://coladv.com/transactions/",                        note:"Staffing & tech M&A specialist." },
  { name:"Transworld",               url:"https://www.tworld.com/buy-a-business/business-listing-search", note:"Search technology / staffing." },
  { name:"Sunbelt",                  url:"https://www.sunbeltnetwork.com/businesses-for-sale/?industry=Technology", note:"Filter to Technology." },
  { name:"Murphy Business",          url:"https://www.murphybusiness.com/listings/?industry=technology", note:"Technology listings." },
  { name:"RoseBiz",                  url:"https://www.rosebiz.com/businesses-for-sale/",            note:"MSPs, VARs, CSPs, Microsoft partners." },
  { name:"Exit Factor",              url:"https://www.exitfactor.com/businesses-for-sale/",         note:"Tech-enabled businesses." },
];

const SEARCH_QUERIES = [
  'site:bizbuysell.com/business-opportunity "IT staffing" OR "IT staff augmentation"',
  'site:bizbuysell.com/business-opportunity "managed service provider" OR "managed services"',
  'site:bizbuysell.com/business-opportunity "MSP" OR "managed IT"',
  'site:bizbuysell.com/business-opportunity "IT consulting" OR "technology consulting"',
  'site:bizbuysell.com/business-opportunity "IT services" staffing OR consulting OR managed',
  'site:bizquest.com/ad "IT staffing" OR "managed service" OR "IT consulting" OR "MSP"',
  'site:businessbroker.net "IT staffing" OR "managed service" OR "IT consulting" for sale',
  '"IT staffing company for sale" revenue 2025 bizbuysell OR bizquest OR businessbroker',
  '"managed service provider for sale" revenue EBITDA 2025',
  '"MSP for sale" revenue profitable 2025 United States',
  '"IT consulting firm for sale" revenue 2025 United States',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── SEARCH: get listings WITH details from search snippets ────
// Key insight: Google search snippets contain price/revenue/description
// data from the listing. We extract everything from the snippet, not
// by fetching the page (which gets blocked).
async function searchForListings(query) {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const res = await postAnthropic({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{
      role: "user",
      content: `Search for: ${query}

Look at the search results carefully. For each result that is an individual business listing page (not a category page), extract everything visible in the search snippet — title, description, price, revenue, location, date.

Rules for valid listing URLs:
- BizBuySell: must contain /business-opportunity/ AND a numeric ID at the end
- BizQuest: must contain /ad/ 
- BusinessBroker: must contain /listing/
- Any other broker: must have a path with a specific listing title/ID
- REJECT any URL that is just a category browse page

Today is ${new Date().toDateString()}. Mark isNew:true if the listing appears to have been posted after ${twoWeeksAgo.toDateString()}.

Return ONLY a raw JSON array. No markdown. No explanation. Each object:
{
  "name": "exact listing title from search result",
  "listingUrl": "exact URL — copy it precisely, do not modify",
  "source": "BizBuySell or BizQuest etc",
  "askingPrice": "from snippet e.g. $2.5M or null",
  "revenue": "from snippet e.g. $4.2M or null",
  "ebitda": "from snippet e.g. $600K or null",
  "location": "from snippet e.g. Dallas, TX or null",
  "description": "1-2 sentence description from the search snippet",
  "isNew": false,
  "listedDate": "date if visible in snippet, else null"
}

If no valid individual listing URLs found: []`
    }]
  });

  if (res.error) throw new Error(res.error.message);
  const text = (res.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();

  try {
    const match = text.replace(/```json|```/g,"").match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(l => {
      if (!l.name || !l.listingUrl) return false;
      try {
        const u = new URL(l.listingUrl);
        const p = u.pathname;
        // Must look like a specific listing, not a category page
        if (p.split("/").filter(Boolean).length < 2) return false;
        // Reject known category page patterns
        if (/^\/(it-and-software|california|texas|florida|new-york|technology-businesses|business-for-sale|businesses-for-sale)\/?$/i.test(p)) return false;
        return true;
      } catch { return false; }
    });
  } catch(e) {
    console.log(`    parse error: ${e.message}`);
    return [];
  }
}

// ── BUILD EMAIL ───────────────────────────────────────────────
function buildEmail(newListings, otherListings, date, total) {
  const card = (l) => {
    // Convert URL slug to readable title if name is missing
    const title = l.name || l.listingUrl.split("/").filter(Boolean).slice(-2,-1)[0]?.replace(/-/g," ") || "View Listing";
    const source = l.source || new URL(l.listingUrl).hostname.replace("www.","");

    return `
  <tr><td style="padding:16px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
    <p style="margin:0 0 3px;color:#555;font-size:11px;font-weight:600;">
      ${source}${l.listedDate ? ` · ${l.listedDate}` : ""}${l.isNew ? ` · <span style="color:#3b82f6;font-weight:700;">NEW</span>` : ""}
    </p>
    <h3 style="margin:0 0 4px;color:#f0e6cc;font-size:14px;font-family:Georgia,serif;font-weight:normal;">${title}</h3>
    ${l.location ? `<p style="margin:0 0 6px;color:#666;font-size:12px;">📍 ${l.location}</p>` : ""}
    ${l.description ? `<p style="margin:0 0 8px;color:#999;font-size:13px;line-height:1.5;">${l.description}</p>` : ""}
    ${l.askingPrice || l.revenue || l.ebitda ? `
    <table cellpadding="0" cellspacing="4" style="margin-bottom:10px;"><tr>
      ${l.askingPrice ? `<td style="background:#111;border:1px solid #252525;border-radius:5px;padding:5px 12px;text-align:center;"><div style="color:#c8a84b;font-size:13px;font-weight:700;">${l.askingPrice}</div><div style="color:#444;font-size:10px;letter-spacing:1px;">ASK</div></td>` : ""}
      ${l.revenue    ? `<td style="background:#111;border:1px solid #252525;border-radius:5px;padding:5px 12px;text-align:center;"><div style="color:#ccc;font-size:13px;font-weight:700;">${l.revenue}</div><div style="color:#444;font-size:10px;letter-spacing:1px;">REVENUE</div></td>` : ""}
      ${l.ebitda     ? `<td style="background:#111;border:1px solid #252525;border-radius:5px;padding:5px 12px;text-align:center;"><div style="color:#ccc;font-size:13px;font-weight:700;">${l.ebitda}</div><div style="color:#444;font-size:10px;letter-spacing:1px;">EBITDA</div></td>` : ""}
    </tr></table>` : ""}
    <a href="${l.listingUrl}" style="display:inline-block;padding:6px 14px;background:#c8a84b15;border:1px solid #c8a84b44;border-radius:5px;color:#c8a84b;font-size:12px;font-weight:600;text-decoration:none;">View Listing →</a>
  </td></tr>`;
  };

  const sectionHeader = (label, count, color) =>
    `<tr><td style="padding:18px 0 2px;"><p style="margin:0;color:${color};font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${label} (${count})</p></td></tr>`;

  const newSection = newListings.length > 0 ? `
    ${sectionHeader("🆕 New — Listed in Last 14 Days", newListings.length, "#3b82f6")}
    ${newListings.map(card).join("")}
    <tr><td style="height:1px;background:#222;padding:0;"></td></tr>` : "";

  const otherSection = `
    ${sectionHeader("All Listings", otherListings.length, "#666")}
    ${otherListings.length > 0
      ? otherListings.map(card).join("")
      : `<tr><td style="padding:20px 0;text-align:center;color:#444;font-size:13px;">No listings found today.</td></tr>`}`;

  const gatedRows = GATED_SOURCES.map(s => `
    <tr><td style="padding:6px 0;border-bottom:1px solid #161616;">
      <a href="${s.url}" style="color:#c8a84b;font-size:13px;font-weight:600;text-decoration:none;">${s.name} →</a>
      <span style="color:#383838;font-size:12px;margin-left:8px;">${s.note}</span>
    </td></tr>`).join("");

  return `<!DOCTYPE html><html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:28px 16px;">
<tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px 10px 0 0;padding:22px 26px;border-bottom:none;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <span style="background:#c8a84b;border-radius:4px;display:inline-block;width:20px;height:20px;text-align:center;line-height:20px;font-size:10px;color:#0a0a0a;font-weight:900;margin-bottom:7px;">◈</span>
        <h1 style="margin:0;color:#f0e6cc;font-size:18px;font-family:Georgia,serif;font-weight:normal;">M&amp;A Deal Digest</h1>
        <p style="margin:3px 0 0;color:#333;font-size:11px;">${date} · ${total} listings · ${newListings.length} new in last 14 days</p>
      </td>
      <td align="right" style="vertical-align:top;white-space:nowrap;">
        <p style="margin:2px 0;color:#3b82f6;font-size:12px;">🆕 ${newListings.length} New</p>
        <p style="margin:2px 0;color:#888;font-size:12px;">◎ ${otherListings.length} Other</p>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#0b0b0b;border:1px solid #1e1e1e;border-top:none;border-bottom:none;padding:8px 26px;">
    <p style="margin:0;color:#2e2e2e;font-size:11px;font-family:monospace;">IT Staffing · IT Consulting · MSP · US/Canada/LatAm · $1M–$30M rev · max 10x EBITDA</p>
  </td></tr>

  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-top:none;padding:0 26px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${newSection}
      ${otherSection}
    </table>
  </td></tr>

  <tr><td style="background:#090909;border:1px solid #1e1e1e;border-top:none;padding:18px 26px;">
    <p style="margin:0 0 10px;color:#252525;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Also Check — Login Required</p>
    <table width="100%" cellpadding="0" cellspacing="0">${gatedRows}</table>
  </td></tr>

  <tr><td style="background:#060606;border:1px solid #1e1e1e;border-top:none;border-radius:0 0 10px 10px;padding:12px 26px;text-align:center;">
    <p style="margin:0;color:#1e1e1e;font-size:10px;">M&amp;A Sourcing Agent · Powered by Claude</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

// ── SEND EMAIL ────────────────────────────────────────────────
async function sendEmail(html, newCount, total) {
  const subject = `M&A Digest ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})} — ${newCount} new · ${total} total listings`;
  const res = await postResend({ from: EMAIL_FROM, to: [EMAIL_TO], subject, html });
  if (res.error) throw new Error(`Resend: ${res.error.message || JSON.stringify(res.error)}`);
  console.log(`✓ Email sent (id: ${res.id})`);
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}\n`);

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY)    throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO)          throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM)        throw new Error("Missing EMAIL_FROM");

  console.log(`① Running ${SEARCH_QUERIES.length} searches...`);
  const allListings = [];
  const seenUrls    = new Set();

  for (const query of SEARCH_QUERIES) {
    process.stdout.write(`  · "${query.slice(0,55)}..." `);
    try {
      const results = await searchForListings(query);
      let added = 0;
      for (const l of results) {
        if (seenUrls.has(l.listingUrl)) continue;
        seenUrls.add(l.listingUrl);
        allListings.push(l);
        added++;
      }
      console.log(`${added} listings`);
    } catch(e) {
      console.log(`error: ${e.message}`);
    }
    await sleep(1200);
  }

  console.log(`\n  Total: ${allListings.length} unique listings`);
  allListings.forEach(l => console.log(`  · [${l.source||"?"}] ${l.name} — ${l.listingUrl}`));

  const newListings   = allListings.filter(l => l.isNew);
  const otherListings = allListings.filter(l => !l.isNew);

  console.log(`\n② Sending email...`);
  const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmail(newListings, otherListings, date, allListings.length);
  await sendEmail(html, newListings.length, allListings.length);

  console.log("\n✓ Done.\n");
}

main().catch(err => { console.error("\n✗ Failed:", err.message); process.exit(1); });
