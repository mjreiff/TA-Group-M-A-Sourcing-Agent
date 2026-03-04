// ============================================================
// M&A Sourcing Agent — Daily Digest
//
// Finds IT staffing / consulting / MSP businesses for sale.
// Uses Claude web search to find real listings with real URLs.
// No scoring — just finds deals matching criteria and emails them.
//
// EMAIL: New listings (last 14 days) first, then all others.
// ============================================================

const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

// ── CRITERIA (used in prompts to filter results) ─────────────
const CRITERIA_TEXT = `
We are looking to acquire IT businesses matching ALL of these criteria:
- Sector: IT Staffing, IT Consulting, IT Managed Services (MSP)
- Geography: United States, Canada, or Latin America
- Revenue: $1M – $30M
- EBITDA: $300K – $6M
- Max asking price multiple: 10x EBITDA
- Must be profitable (positive EBITDA)
- No single customer above 40% of revenue
- NO non-IT businesses
`.trim();

// ── GATED SOURCES (shown in email footer) ────────────────────
const GATED_SOURCES = [
  { name:"Axial.net",                url:"https://www.axial.net",                        note:"Register free, filter by IT Services / Staffing." },
  { name:"FOCUS Investment Banking", url:"https://focusbankers.com/it-services-msp/",    note:"Specialist MSP & IT M&A advisor." },
  { name:"Corum Group",              url:"https://corumgroup.com/transactions/",          note:"Tech M&A. Review recent transactions." },
  { name:"Griffin Financial Group",  url:"https://www.griffinfingroup.com/industries/staffing/", note:"IT staffing M&A specialist." },
  { name:"MKLINK MSP Marketplace",   url:"https://mklink.org/mergers-acquisitions/",     note:"MSP-exclusive broker." },
  { name:"Generational Equity",      url:"https://www.genequity.com/businesses-for-sale/", note:"Mid-market. Browse technology category." },
  { name:"Benchmark International",  url:"https://www.benchmarkcorporate.com/businesses-for-sale", note:"Global firm. Filter by technology." },
  { name:"Colonnade Advisors",       url:"https://coladv.com/transactions/",              note:"Staffing & tech M&A specialist." },
  { name:"Transworld",               url:"https://www.tworld.com/buy-a-business/business-listing-search", note:"Search technology / staffing." },
  { name:"Sunbelt",                  url:"https://www.sunbeltnetwork.com/businesses-for-sale/?industry=Technology", note:"Filter to Technology." },
  { name:"Murphy Business",          url:"https://www.murphybusiness.com/listings/?industry=technology", note:"Technology listings." },
  { name:"RoseBiz",                  url:"https://www.rosebiz.com/businesses-for-sale/",  note:"MSPs, VARs, CSPs, Microsoft channel partners." },
  { name:"Exit Factor",              url:"https://www.exitfactor.com/businesses-for-sale/", note:"Tech-enabled businesses." },
];

// ── SEARCH QUERIES ────────────────────────────────────────────
// Each query targets a specific source or category.
// The prompt instructs Claude to return verified, working URLs only.
const SEARCHES = [
  // BizBuySell — use site: operator, it works well here
  { label: "BizBuySell — IT Staffing",       q: 'site:bizbuysell.com/Business-Opportunity "IT staffing" for sale' },
  { label: "BizBuySell — MSP",               q: 'site:bizbuysell.com/Business-Opportunity "managed service provider" OR "MSP" for sale' },
  { label: "BizBuySell — IT Consulting",     q: 'site:bizbuysell.com/Business-Opportunity "IT consulting" for sale' },
  { label: "BizBuySell — Managed IT",        q: 'site:bizbuysell.com/Business-Opportunity "managed IT" OR "IT services" for sale asking price' },
  // BizQuest
  { label: "BizQuest — IT/MSP",             q: 'site:bizquest.com "IT staffing" OR "managed service" OR "MSP" OR "IT consulting" for sale listing' },
  // BusinessBroker.net
  { label: "BusinessBroker.net — IT",       q: 'site:businessbroker.net "IT staffing" OR "managed service" OR "IT consulting" for sale' },
  // Specialist broker pages — fetch and parse directly via Claude
  { label: "Synergy BB — IT Services",      q: 'site:synergybb.com for sale IT staffing OR managed service OR consulting listing' },
  { label: "IT ExchangeNet",                q: 'site:itexchangenet.com for sale IT OR MSP OR staffing OR consulting' },
  { label: "Brampton Capital",              q: 'site:bramptoncapital.com for sale managed service OR IT staffing OR consulting' },
  { label: "WebsiteClosers — IT",           q: 'site:websiteclosers.com "IT staffing" OR "managed service" OR "MSP" for sale' },
  { label: "DealStream — IT",               q: 'site:dealstream.com IT staffing OR managed service OR consulting for sale' },
  { label: "BusinessesForSale — IT",        q: 'site:businessesforsale.com "IT staffing" OR "managed service" OR "IT consulting" for sale United States' },
  // Broad open-web — catches listings on any platform
  { label: "Open Web — IT Staffing",        q: '"IT staffing company for sale" 2025 United States asking price revenue' },
  { label: "Open Web — MSP",               q: '"managed service provider for sale" 2025 United States revenue asking price' },
  { label: "Open Web — IT Consulting",      q: '"IT consulting firm for sale" OR "IT consulting business for sale" 2025 United States' },
  { label: "Open Web — MSP 2",             q: '"MSP for sale" 2025 profitable revenue United States Canada' },
  { label: "Open Web — IT Services",        q: '"IT services business for sale" OR "IT services company for sale" 2025 profitable United States' },
  { label: "Open Web — Staff Aug",          q: '"staff augmentation company for sale" OR "technology staffing for sale" 2025 United States' },
];

// ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── RUN ONE SEARCH ────────────────────────────────────────────
// Returns array of listing objects with verified, working URLs.
async function runSearch(label, query) {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const prompt = `Today is ${new Date().toDateString()}.

${CRITERIA_TEXT}

Search for: ${query}

Look through ALL search results carefully. For every business-for-sale listing you find that could match the criteria above, extract it.

CRITICAL URL RULES — read carefully:
- The listingUrl MUST be the direct URL to that specific listing page
- Copy the URL EXACTLY as it appears in the search results — do not shorten, modify, or reconstruct it
- If you are not 100% sure a URL is correct and working, omit that listing entirely
- Do NOT make up or guess URLs
- Do NOT use search page URLs or homepage URLs — only specific listing page URLs

For each valid listing return:
- name: the listing title exactly as shown
- listingUrl: the EXACT direct URL to this specific listing (e.g. https://www.bizbuysell.com/Business-Opportunity/some-title/1234567/)
- source: the website it's listed on
- askingPrice: e.g. "$2.5M" — or omit if not shown
- revenue: e.g. "$4.2M" — or omit if not shown
- ebitda: e.g. "$600k" — or omit if not shown
- location: city/state
- description: 1-2 sentences about the business
- isNew: true if listed after ${twoWeeksAgo.toDateString()}, otherwise false
- listedDate: the listing date if visible

Return ONLY a raw JSON array. No markdown. No explanation. If nothing found return [].

Example of correct output:
[
  {
    "name": "IT MSP - Dallas Texas - $800K Revenue",
    "listingUrl": "https://www.bizbuysell.com/Business-Opportunity/it-msp-dallas-texas/1867234/",
    "source": "BizBuySell",
    "askingPrice": "$1.2M",
    "revenue": "$800K",
    "ebitda": "$220K",
    "location": "Dallas, TX",
    "description": "Managed IT services provider with 45 SMB clients on recurring contracts.",
    "isNew": false,
    "listedDate": "Feb 10, 2026"
  }
]`;

  const res = await postAnthropic({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });

  if (res.error) throw new Error(res.error.message);

  const text = (res.content || []).filter(b => b.type === "text").map(b => b.text || "").join("").trim();
  if (!text) return [];

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(l => {
      if (!l.name || l.name.length < 5) return false;
      if (!l.listingUrl) return false;
      // Reject generic/homepage/search page URLs
      try {
        const u = new URL(l.listingUrl);
        if (u.pathname.length < 5) return false;
        if (/\/(search|results|listings|businesses-for-sale|technology-businesses|it-and-software)\/?$/i.test(u.pathname)) return false;
        return true;
      } catch { return false; }
    }).map(l => ({
      name:        l.name,
      listingUrl:  l.listingUrl,
      source:      l.source || label.split(" — ")[0],
      askingPrice: l.askingPrice || null,
      revenue:     l.revenue || null,
      ebitda:      l.ebitda || null,
      location:    l.location || null,
      description: l.description || null,
      isNew:       l.isNew === true,
      listedDate:  l.listedDate || null,
    }));
  } catch (e) {
    console.log(`     JSON parse error: ${e.message}`);
    return [];
  }
}

// ── BUILD EMAIL ───────────────────────────────────────────────
function buildEmail(newListings, otherListings, date, totalFound) {

  const card = (l) => `
  <tr><td style="padding:16px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
    <p style="margin:0 0 3px;color:#555;font-size:11px;font-weight:600;">${l.source}${l.listedDate ? ` · ${l.listedDate}` : ""}${l.isNew ? ` · <span style="color:#3b82f6;font-weight:700;">NEW</span>` : ""}</p>
    <h3 style="margin:0 0 4px;color:#f0e6cc;font-size:14px;font-family:Georgia,serif;font-weight:normal;">${l.name}</h3>
    ${l.location ? `<p style="margin:0 0 6px;color:#666;font-size:12px;">📍 ${l.location}</p>` : ""}
    ${l.description ? `<p style="margin:0 0 8px;color:#999;font-size:13px;line-height:1.5;">${l.description}</p>` : ""}
    ${l.askingPrice || l.revenue || l.ebitda ? `
    <table cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>
      ${l.askingPrice ? `<td style="background:#111;border:1px solid #252525;border-radius:5px;padding:5px 12px;text-align:center;"><div style="color:#c8a84b;font-size:13px;font-weight:700;">${l.askingPrice}</div><div style="color:#444;font-size:10px;letter-spacing:1px;margin-top:1px;">ASK</div></td><td style="width:5px"></td>` : ""}
      ${l.revenue ? `<td style="background:#111;border:1px solid #252525;border-radius:5px;padding:5px 12px;text-align:center;"><div style="color:#ccc;font-size:13px;font-weight:700;">${l.revenue}</div><div style="color:#444;font-size:10px;letter-spacing:1px;margin-top:1px;">REVENUE</div></td><td style="width:5px"></td>` : ""}
      ${l.ebitda ? `<td style="background:#111;border:1px solid #252525;border-radius:5px;padding:5px 12px;text-align:center;"><div style="color:#ccc;font-size:13px;font-weight:700;">${l.ebitda}</div><div style="color:#444;font-size:10px;letter-spacing:1px;margin-top:1px;">EBITDA</div></td>` : ""}
    </tr></table>` : ""}
    <a href="${l.listingUrl}" style="display:inline-block;padding:6px 14px;background:#c8a84b15;border:1px solid #c8a84b44;border-radius:5px;color:#c8a84b;font-size:12px;font-weight:600;text-decoration:none;">View Listing →</a>
  </td></tr>`;

  const sectionTitle = (text, count, color) =>
    `<tr><td style="padding:18px 0 2px;"><p style="margin:0;color:${color};font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${text} &nbsp;(${count})</p></td></tr>`;

  const emptyRow = (msg) =>
    `<tr><td style="padding:20px 0;text-align:center;color:#444;font-size:13px;">${msg}</td></tr>`;

  const newSection = newListings.length > 0 ? `
    ${sectionTitle("🆕 New — Listed in Last 14 Days", newListings.length, "#3b82f6")}
    ${newListings.map(card).join("")}
    <tr><td style="height:1px;background:#222;padding:0;margin:0;"></td></tr>` : "";

  const otherSection = `
    ${sectionTitle("All Listings", otherListings.length, "#666")}
    ${otherListings.length > 0 ? otherListings.map(card).join("") : emptyRow("No additional listings found today.")}`;

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

  <!-- Header -->
  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px 10px 0 0;padding:22px 26px;border-bottom:none;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <span style="background:#c8a84b;border-radius:4px;display:inline-block;width:20px;height:20px;text-align:center;line-height:20px;font-size:10px;color:#0a0a0a;font-weight:900;margin-bottom:7px;">◈</span>
        <h1 style="margin:0;color:#f0e6cc;font-size:18px;font-family:Georgia,serif;font-weight:normal;">M&amp;A Deal Digest</h1>
        <p style="margin:3px 0 0;color:#333;font-size:11px;">${date} · ${totalFound} listings found · ${newListings.length} new in last 14 days</p>
      </td>
      <td align="right" style="vertical-align:top;white-space:nowrap;">
        <p style="margin:2px 0;color:#3b82f6;font-size:12px;">🆕 ${newListings.length} New</p>
        <p style="margin:2px 0;color:#aaa;font-size:12px;">◎ ${otherListings.length} Other</p>
      </td>
    </tr></table>
  </td></tr>

  <!-- Criteria bar -->
  <tr><td style="background:#0b0b0b;border:1px solid #1e1e1e;border-top:none;border-bottom:none;padding:8px 26px;">
    <p style="margin:0;color:#2e2e2e;font-size:11px;font-family:monospace;">IT Staffing · IT Consulting · MSP · US/Canada/LatAm · $1M–$30M rev · max 10x EBITDA</p>
  </td></tr>

  <!-- Listings -->
  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-top:none;padding:0 26px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${newSection}
      ${otherSection}
    </table>
  </td></tr>

  <!-- Gated sources -->
  <tr><td style="background:#090909;border:1px solid #1e1e1e;border-top:none;padding:18px 26px;">
    <p style="margin:0 0 10px;color:#252525;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Also Check — Login Required</p>
    <table width="100%" cellpadding="0" cellspacing="0">${gatedRows}</table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#060606;border:1px solid #1e1e1e;border-top:none;border-radius:0 0 10px 10px;padding:12px 26px;text-align:center;">
    <p style="margin:0;color:#1e1e1e;font-size:10px;">M&amp;A Sourcing Agent · ${SEARCHES.length} searches daily · Powered by Claude</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

// ── SEND EMAIL ────────────────────────────────────────────────
async function sendEmail(html, newCount, total) {
  const subject = `M&A Digest ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})} — ${newCount} new listing${newCount!==1?"s":""} · ${total} total`;
  const res = await postResend({ from: EMAIL_FROM, to: [EMAIL_TO], subject, html });
  if (res.error) throw new Error(`Resend error: ${res.error.message || JSON.stringify(res.error)}`);
  console.log(`✓ Email sent (id: ${res.id})`);
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}`);
  console.log(`  ${SEARCHES.length} searches queued`);
  console.log("─".repeat(54));

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY)    throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO)          throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM)        throw new Error("Missing EMAIL_FROM");

  // ── Run all searches
  console.log(`\n① Running searches...`);
  const allListings = [];
  const seenUrls    = new Set();

  for (const { label, q } of SEARCHES) {
    process.stdout.write(`   ${label}... `);
    try {
      const results = await runSearch(label, q);
      let added = 0;
      for (const l of results) {
        if (seenUrls.has(l.listingUrl)) continue;
        seenUrls.add(l.listingUrl);
        allListings.push(l);
        added++;
      }
      console.log(`${added} listings`);
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
    await sleep(1500); // avoid rate limiting
  }

  console.log(`\n  Total unique listings: ${allListings.length}`);

  // ── Split into new vs other
  const newListings   = allListings.filter(l => l.isNew);
  const otherListings = allListings.filter(l => !l.isNew);

  console.log(`  New (last 14 days): ${newListings.length}`);
  console.log(`  Other:              ${otherListings.length}`);

  // ── Build and send email
  console.log(`\n② Sending email...`);
  const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmail(newListings, otherListings, date, allListings.length);
  await sendEmail(html, newListings.length, allListings.length);

  console.log("\n✓ Done.\n");
}

main().catch(err => { console.error("\n✗ Failed:", err.message); process.exit(1); });
