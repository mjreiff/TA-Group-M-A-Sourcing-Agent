// ============================================================
// M&A Sourcing Agent
// Extracts listing details from Google search snippets.
// No page fetching needed — works around 403 blocks.
// ============================================================

const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

const THREE_WEEKS_MS = 21 * 24 * 60 * 60 * 1000;

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

// ── SEARCH QUERIES ────────────────────────────────────────────
// Grouped by source. For poorly-indexed sites we use open-web
// queries that still surface their listings via aggregators,
// Google cache, and cross-listing sites.
const SEARCH_QUERIES = [

  // ── BizBuySell (well indexed, use site: for precision)
  { q: 'site:bizbuysell.com/business-opportunity "IT staffing" OR "staff augmentation"',            src: "BizBuySell" },
  { q: 'site:bizbuysell.com/business-opportunity "managed service provider" OR "managed services"', src: "BizBuySell" },
  { q: 'site:bizbuysell.com/business-opportunity "MSP" profitable recurring revenue',               src: "BizBuySell" },
  { q: 'site:bizbuysell.com/business-opportunity "IT consulting" OR "technology consulting"',       src: "BizBuySell" },
  { q: 'site:bizbuysell.com/business-opportunity "IT services" staffing OR consulting OR managed',  src: "BizBuySell" },

  // ── BizQuest
  { q: 'site:bizquest.com "IT staffing" OR "managed service" OR "IT consulting" OR "MSP" for sale', src: "BizQuest" },
  { q: 'site:bizquest.com "technology staffing" OR "IT services" OR "managed IT" for sale',         src: "BizQuest" },

  // ── BusinessBroker.net
  { q: 'site:businessbroker.net "IT staffing" OR "managed service" OR "IT consulting" for sale',   src: "BusinessBroker.net" },
  { q: 'site:businessbroker.net "MSP" OR "technology staffing" OR "IT services" for sale',         src: "BusinessBroker.net" },

  // ── BusinessesForSale.com
  { q: 'site:businessesforsale.com "IT staffing" OR "managed service" OR "IT consulting" for sale United States', src: "BusinessesForSale.com" },
  { q: 'site:businessesforsale.com "MSP" OR "technology staffing" OR "IT services" for sale',      src: "BusinessesForSale.com" },

  // ── DealStream — try site: and natural language
  { q: 'site:dealstream.com "IT staffing" OR "managed service" OR "MSP" OR "IT consulting"',       src: "DealStream" },
  { q: 'dealstream.com IT staffing OR managed service provider OR MSP for sale listing 2025',       src: "DealStream" },

  // ── Synergy Business Brokers
  { q: 'site:synergybb.com "IT staffing" OR "managed service" OR "MSP" OR "IT consulting"',        src: "Synergy Business Brokers" },
  { q: 'synergybb.com IT staffing OR MSP OR managed service provider for sale listing',             src: "Synergy Business Brokers" },

  // ── IT ExchangeNet
  { q: 'site:itexchangenet.com "for sale" IT OR MSP OR staffing OR consulting',                    src: "IT ExchangeNet" },
  { q: 'itexchangenet.com IT staffing OR MSP OR managed service provider for sale',                 src: "IT ExchangeNet" },

  // ── Brampton Capital
  { q: 'site:bramptoncapital.com "managed service" OR "IT staffing" OR "MSP" for sale',            src: "Brampton Capital" },
  { q: 'bramptoncapital.com MSP OR managed service provider OR IT staffing for sale listing',       src: "Brampton Capital" },

  // ── WebsiteClosers
  { q: 'site:websiteclosers.com "IT staffing" OR "managed service" OR "MSP" OR "IT consulting"',   src: "WebsiteClosers" },

  // ── Lion Business Brokers
  { q: 'site:lionbusinessbrokers.com "IT staffing" OR "managed service" OR "IT consulting"',       src: "Lion Business Brokers" },
  { q: 'lionbusinessbrokers.com IT staffing OR MSP OR managed service for sale listing',            src: "Lion Business Brokers" },

  // ── Acquire.com (tech-focused marketplace)
  { q: 'site:acquire.com "IT staffing" OR "managed service" OR "MSP" OR "IT consulting" for sale', src: "Acquire.com" },

  // ── MicroAcquire / Acquire
  { q: 'acquire.com MSP OR "managed service provider" OR "IT staffing" for sale profitable',       src: "Acquire.com" },

  // ── Open web — catches listings on ANY platform
  { q: '"IT staffing company for sale" "asking price" OR "revenue" 2025 United States',            src: "General Web" },
  { q: '"IT staffing business for sale" profitable 2025 United States OR Canada',                  src: "General Web" },
  { q: '"managed service provider for sale" "asking price" OR "cash flow" 2025 United States',     src: "General Web" },
  { q: '"MSP for sale" profitable revenue 2025 United States OR Canada',                           src: "General Web" },
  { q: '"IT consulting firm for sale" "asking price" OR revenue 2025 United States',               src: "General Web" },
  { q: '"IT consulting company for sale" profitable 2025 United States OR Canada',                 src: "General Web" },
  { q: '"managed IT services" company for sale 2025 United States revenue profitable',             src: "General Web" },
  { q: '"technology staffing" company for sale 2025 United States asking price',                   src: "General Web" },
  { q: 'acquire "IT staffing" OR "managed service provider" OR "MSP" business for sale 2025',     src: "General Web" },
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

// ── SEARCH AND EXTRACT ────────────────────────────────────────
async function searchForListings(query, source) {
  const threeWeeksAgo = new Date(Date.now() - THREE_WEEKS_MS);

  const res = await postAnthropic({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2500,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{
      role: "user",
      content: `Search for: ${query}

Extract every individual business-for-sale listing from the search results. Get all details visible in the snippets — title, price, revenue, location, description, date.

VALID listing URL examples (specific listings, not browse pages):
- https://www.bizbuysell.com/business-opportunity/some-title/1234567/
- https://www.bizquest.com/ad/some-title/BQ1234/
- https://www.businessbroker.net/listing/some-title/
- https://dealstream.com/deal/buy/some-title--123456
- https://synergybb.com/us-businesses-for-sale/some-title/
- https://websiteclosers.com/listing/some-title/
- https://lionbusinessbrokers.com/listing/some-title/

INVALID (reject these):
- Any URL that is just a category/browse page with no specific listing ID or title slug
- Homepages

Today is ${new Date().toDateString()}. Mark isNew:true if listed after ${threeWeeksAgo.toDateString()}.

Return ONLY a raw JSON array, no markdown:
[{
  "name": "exact listing title",
  "listingUrl": "exact URL — do not modify",
  "source": "${source}",
  "askingPrice": "$X.XM or null",
  "revenue": "$X.XM or null",
  "ebitda": "$XXXk or null",
  "location": "City, State or null",
  "description": "2-3 sentences from snippet",
  "isNew": false,
  "listedDate": "date string or null"
}]

If nothing found: []`
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
        const p = new URL(l.listingUrl).pathname;
        if (p.split("/").filter(Boolean).length < 2) return false;
        if (/^\/(it-and-software|california|texas|florida|new-york|technology-businesses|business-for-sale|businesses-for-sale|it-services)\/?$/i.test(p)) return false;
        return true;
      } catch { return false; }
    }).map(l => ({ ...l, source: l.source || source }));
  } catch(e) {
    console.log(`    parse error: ${e.message}`);
    return [];
  }
}

// ── BUILD EMAIL ───────────────────────────────────────────────
function buildEmail(newListings, otherListings, date, total) {
  const card = (l) => {
    const title  = l.name || l.listingUrl.split("/").filter(Boolean).slice(-2,-1)[0]?.replace(/-/g," ") || "View Listing";
    const source = l.source || new URL(l.listingUrl).hostname.replace("www.","");
    return `
  <tr><td style="padding:16px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
    <p style="margin:0 0 3px;color:#555;font-size:11px;font-weight:600;">${source}${l.listedDate ? ` · ${l.listedDate}` : ""}${l.isNew ? ` &nbsp;<span style="color:#3b82f6;font-weight:700;background:#1d3a6622;border:1px solid #3b82f644;border-radius:4px;padding:1px 6px;">NEW</span>` : ""}</p>
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
    `<tr><td style="padding:20px 0 4px;"><p style="margin:0;color:${color};font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${label} &nbsp;<span style="font-weight:400;opacity:.6;">(${count})</span></p></td></tr>`;

  const divider =
    `<tr><td style="height:1px;background:#1e1e1e;padding:0;margin:8px 0;"></td></tr>`;

  const newSection = newListings.length > 0 ? `
    ${sectionHeader("🆕 New — Listed in Last 3 Weeks", newListings.length, "#3b82f6")}
    ${newListings.map(card).join("")}
    ${divider}` : "";

  const otherSection = `
    ${sectionHeader("All Other Listings", otherListings.length, "#555")}
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
        <p style="margin:3px 0 0;color:#333;font-size:11px;">${date} · ${total} listings · ${newListings.length} new in last 3 weeks</p>
      </td>
      <td align="right" style="vertical-align:top;white-space:nowrap;">
        <p style="margin:2px 0;color:#3b82f6;font-size:12px;">🆕 ${newListings.length} New (3 wks)</p>
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
    <p style="margin:0;color:#1e1e1e;font-size:10px;">M&amp;A Sourcing Agent · ${SEARCH_QUERIES.length} searches daily · Powered by Claude</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

async function sendEmail(html, newCount, total) {
  const subject = `M&A Digest ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})} — ${newCount} new (3 wks) · ${total} total`;
  const res = await postResend({ from: EMAIL_FROM, to: [EMAIL_TO], subject, html });
  if (res.error) throw new Error(`Resend: ${res.error.message || JSON.stringify(res.error)}`);
  console.log(`✓ Email sent (id: ${res.id})`);
}

async function main() {
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}`);
  console.log(`  ${SEARCH_QUERIES.length} queries across ${[...new Set(SEARCH_QUERIES.map(q=>q.src))].length} source categories\n`);

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY)    throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO)          throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM)        throw new Error("Missing EMAIL_FROM");

  const allListings = [];
  const seenUrls    = new Set();
  const bySrc       = {};

  for (const { q, src } of SEARCH_QUERIES) {
    process.stdout.write(`  [${src}] ${q.slice(0,50)}... `);
    try {
      const results = await searchForListings(q, src);
      let added = 0;
      for (const l of results) {
        if (seenUrls.has(l.listingUrl)) continue;
        seenUrls.add(l.listingUrl);
        allListings.push(l);
        bySrc[src] = (bySrc[src]||0) + 1;
        added++;
      }
      console.log(`${added}`);
    } catch(e) {
      console.log(`ERR: ${e.message}`);
    }
    await sleep(1200);
  }

  console.log(`\n  Results by source:`);
  Object.entries(bySrc).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log(`    ${s}: ${n}`));
  console.log(`  Total: ${allListings.length} unique listings\n`);

  const newListings   = allListings.filter(l => l.isNew);
  const otherListings = allListings.filter(l => !l.isNew);

  const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmail(newListings, otherListings, date, allListings.length);
  await sendEmail(html, newListings.length, allListings.length);
  console.log("✓ Done.\n");
}

main().catch(err => { console.error("\n✗ Failed:", err.message); process.exit(1); });
