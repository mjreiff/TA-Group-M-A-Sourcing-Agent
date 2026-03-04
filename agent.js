// ============================================================
// M&A Sourcing Agent
// Strategy: Claude searches for listings, then fetches each
// individual listing page to get real details and verified URLs
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

// Each search query is designed to surface individual listing pages
// not category/browse pages
const SEARCH_QUERIES = [
  // BizBuySell — individual listing pages have /business-opportunity/ in the URL
  'site:bizbuysell.com/business-opportunity "IT staffing" OR "IT staff augmentation"',
  'site:bizbuysell.com/business-opportunity "managed service provider" OR "managed services"',
  'site:bizbuysell.com/business-opportunity "MSP" OR "managed IT"',
  'site:bizbuysell.com/business-opportunity "IT consulting" OR "technology consulting"',
  'site:bizbuysell.com/business-opportunity "IT services" staffing OR consulting',
  // BizQuest individual listings
  'site:bizquest.com/ad "IT staffing" OR "managed service" OR "IT consulting" OR "MSP"',
  // BusinessBroker.net
  'site:businessbroker.net/listing "IT staffing" OR "managed service" OR "IT consulting"',
  // Open web — find listings on any broker site
  '"IT staffing" "for sale" "asking price" site:bizbuysell.com OR site:bizquest.com OR site:businessbroker.net',
  '"managed service provider" "for sale" "asking price" OR "cash flow" 2025',
  '"MSP for sale" OR "managed service provider for sale" "asking price" 2025',
  '"IT consulting" "for sale" "asking price" OR "annual revenue" 2025',
  '"IT staffing company for sale" "revenue" 2025',
  // Synergy, DealStream, IT ExchangeNet — these won't index well but try
  'synergybb.com "IT staffing" OR "managed service" OR "MSP" for sale',
  'dealstream.com "IT staffing" OR "managed service" OR "MSP" for sale listing',
  'itexchangenet.com "for sale" IT OR MSP OR staffing',
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

// ── STEP 1: Search for individual listing URLs ────────────────
async function findListingUrls() {
  console.log("  Searching for individual listing URLs...");
  const allUrls = new Set();

  for (const query of SEARCH_QUERIES) {
    process.stdout.write(`  · "${query.slice(0,60)}..." `);
    try {
      const res = await postAnthropic({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Search for: ${query}

Return ONLY a JSON array of URLs that are direct links to individual business listing pages (not category pages, not homepages, not search result pages).

A valid listing URL looks like:
- https://www.bizbuysell.com/business-opportunity/some-title/1234567/
- https://www.bizquest.com/ad/some-title/BQ1234/
- https://www.businessbroker.net/listing/some-title/

An invalid URL looks like:
- https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/
- https://www.bizbuysell.com/california/...
- Any URL without a specific listing ID

Return format — raw JSON array only, no markdown:
["https://...", "https://..."]

If no valid individual listing URLs found, return: []`
        }]
      });

      const text = (res.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      const match = text.replace(/```json|```/g,"").match(/\[[\s\S]*?\]/);
      if (match) {
        const urls = JSON.parse(match[0]).filter(u => {
          try {
            const p = new URL(u).pathname;
            // Must have a path longer than a category page
            // BizBuySell listings: /business-opportunity/title/id/
            // BizQuest: /ad/title/id
            // Must not be a pure category/browse page
            if (p.split("/").filter(Boolean).length < 2) return false;
            if (/^\/(?:it-and-software|california|texas|new-york|florida|technology-businesses|business-for-sale)\/?$/.test(p)) return false;
            return true;
          } catch { return false; }
        });
        urls.forEach(u => allUrls.add(u));
        console.log(`${urls.length} listing URLs`);
      } else {
        console.log("0");
      }
    } catch(e) {
      console.log(`error: ${e.message}`);
    }
    await sleep(1000);
  }

  return [...allUrls];
}

// ── STEP 2: Fetch each listing page and extract details ───────
async function fetchListingDetails(urls) {
  console.log(`\n  Fetching details for ${urls.length} listings...`);
  const listings = [];
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // Process in batches of 5 — ask Claude to fetch and extract each one
  const BATCH = 5;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    process.stdout.write(`  · Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(urls.length/BATCH)} (${batch.length} listings)... `);

    try {
      const urlList = batch.map((u,j) => `${j+1}. ${u}`).join("\n");
      const res = await postAnthropic({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Fetch each of these business listing pages and extract the details:

${urlList}

We are looking for: IT Staffing, IT Consulting, or Managed Services (MSP) businesses for sale in the US, Canada, or Latin America with $1M-$30M revenue and $300K-$6M EBITDA.

For each listing, extract:
- name: the listing title
- listingUrl: the exact URL provided above (do not change it)
- askingPrice: e.g. "$2.5M" or null
- revenue: e.g. "$4.2M" or null
- ebitda: e.g. "$600K" or null
- location: city/state
- description: 2-3 sentences about the business
- isNew: true if listed after ${twoWeeksAgo.toDateString()}, else false
- listedDate: the listing date if shown, else null
- relevantToUs: true if it matches our IT staffing/consulting/MSP criteria, false if clearly unrelated

Return ONLY a raw JSON array, no markdown:
[{"name":"...","listingUrl":"...","askingPrice":"...","revenue":"...","ebitda":"...","location":"...","description":"...","isNew":false,"listedDate":null,"relevantToUs":true}]`
        }]
      });

      const text = (res.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      const match = text.replace(/```json|```/g,"").match(/\[[\s\S]*\]/);
      if (match) {
        const extracted = JSON.parse(match[0])
          .filter(l => l.relevantToUs !== false && l.name && l.listingUrl);
        // Always restore original URLs — never let Claude modify them
        extracted.forEach((l, idx) => {
          if (batch[idx]) l.listingUrl = batch[idx];
        });
        listings.push(...extracted);
        console.log(`${extracted.length} relevant`);
      } else {
        console.log("0 extracted");
      }
    } catch(e) {
      console.log(`error: ${e.message}`);
      // Add listings with just the URL so they still appear in email
      batch.forEach(url => listings.push({
        name: url.split("/").filter(Boolean).slice(-2, -1)[0]?.replace(/-/g," ") || "Listing",
        listingUrl: url,
        description: null, askingPrice: null, revenue: null,
        ebitda: null, location: null, isNew: false, listedDate: null,
      }));
    }
    await sleep(1500);
  }

  return listings;
}

// ── BUILD EMAIL ───────────────────────────────────────────────
function buildEmail(newListings, otherListings, date, total) {
  const card = (l) => `
  <tr><td style="padding:16px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
    <p style="margin:0 0 3px;color:#555;font-size:11px;font-weight:600;">
      ${l.source || new URL(l.listingUrl).hostname.replace("www.","")}${l.listedDate ? ` · ${l.listedDate}` : ""}${l.isNew ? ` · <span style="color:#3b82f6;font-weight:700;">NEW</span>` : ""}
    </p>
    <h3 style="margin:0 0 4px;color:#f0e6cc;font-size:14px;font-family:Georgia,serif;font-weight:normal;">${l.name}</h3>
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
      : `<tr><td style="padding:20px 0;text-align:center;color:#444;font-size:13px;">No additional listings today.</td></tr>`}`;

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
  console.log(`\n✓ Email sent (id: ${res.id})`);
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}\n`);

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY)    throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO)          throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM)        throw new Error("Missing EMAIL_FROM");

  // Step 1: Find real individual listing URLs
  console.log("① Finding listing URLs...");
  const urls = await findListingUrls();
  console.log(`\n  Found ${urls.length} unique listing URLs`);
  urls.forEach(u => console.log(`  · ${u}`));

  if (urls.length === 0) {
    console.log("  No listing URLs found — sending digest with gated sources only.");
    const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    await sendEmail(buildEmail([], [], date, 0), 0, 0);
    return;
  }

  // Step 2: Fetch each listing and extract real details
  console.log("\n② Fetching listing details...");
  const listings = await fetchListingDetails(urls);
  console.log(`\n  ${listings.length} relevant listings extracted`);

  const newListings   = listings.filter(l => l.isNew);
  const otherListings = listings.filter(l => !l.isNew);

  // Step 3: Send email
  console.log("\n③ Sending email...");
  const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmail(newListings, otherListings, date, listings.length);
  await sendEmail(html, newListings.length, listings.length);

  console.log("\n✓ Done.\n");
}

main().catch(err => { console.error("\n✗ Failed:", err.message); process.exit(1); });
