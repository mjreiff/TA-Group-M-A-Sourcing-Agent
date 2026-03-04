// ============================================================
// M&A Sourcing Agent — Daily Runner
// Strategy: 25+ diverse search queries using Claude web search.
// - BizBuySell/BizQuest: site: queries (well indexed)
// - Specialist brokers: natural language + site name (not site:)
// - Broad queries: catch listings anywhere on the web
// - NEW listings (last 2 weeks) surfaced at top of email
// - ALL listings shown below, sorted by score
// ============================================================

const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

const CRITERIA = {
  sectors:    "IT Staffing, IT Consulting, IT Managed Services, IT MSP",
  geography:  "United States, Canada, Latin America",
  revenueMin: "$1,000,000",
  revenueMax: "$30,000,000",
  ebitdaMin:  "$300,000",
  ebitdaMax:  "$6,000,000",
  multipleMax:"10x EBITDA",
  mustHave: [
    "IT staffing, consulting, or managed services focus",
    "Profitable with positive EBITDA",
    "Established client base",
    "Low single-client concentration",
    "Good gross margin and net income/revenue ratio",
  ],
  dealBreakers: [
    "No non-IT businesses",
    "No pre-revenue or loss-making businesses",
    "No single customer above 40% of revenue",
  ],
  notes: "Prefer low client concentration. Good gross margin. Good net income/revenue margin.",
};

const GATED_SOURCES = [
  { name:"Axial.net",                url:"https://www.axial.net/forum/companies/internet-software-services-m-a-advisory-firms/", note:"Free registration. Filter by IT Services / Staffing." },
  { name:"FOCUS Investment Banking", url:"https://focusbankers.com/it-services-msp/",                                           note:"Specialist MSP & IT M&A advisor. Contact for current listings." },
  { name:"Corum Group",              url:"https://corumgroup.com/transactions/",                                                note:"Tech M&A advisor. Review recent transactions for seller outreach." },
  { name:"Griffin Financial Group",  url:"https://www.griffinfingroup.com/industries/staffing/",                                note:"Staffing industry M&A specialist. Contact for off-market IT deals." },
  { name:"MKLINK MSP Marketplace",   url:"https://mklink.org/mergers-acquisitions/",                                           note:"MSP-exclusive broker. Register free to receive MSP listings." },
  { name:"Generational Equity",      url:"https://www.genequity.com/businesses-for-sale/",                                     note:"Mid-market M&A. Browse technology category." },
  { name:"Benchmark International",  url:"https://www.benchmarkcorporate.com/businesses-for-sale",                             note:"Global M&A firm. Filter by technology sector." },
  { name:"Colonnade Advisors",       url:"https://coladv.com/transactions/",                                                   note:"Staffing & tech M&A specialist. Review transaction pipeline." },
  { name:"Transworld Business Advisors", url:"https://www.tworld.com/buy-a-business/business-listing-search",                  note:"Large broker network. Search technology / staffing listings." },
  { name:"Sunbelt Business Brokers", url:"https://www.sunbeltnetwork.com/businesses-for-sale/?industry=Technology",             note:"National broker network. Filter to Technology industry." },
  { name:"Murphy Business Brokers",  url:"https://www.murphybusiness.com/listings/?industry=technology",                       note:"National broker. Technology listings section." },
  { name:"RoseBiz",                  url:"https://www.rosebiz.com/businesses-for-sale/",                                       note:"Specialist in MSPs, VARs, CSPs and Microsoft channel partners." },
  { name:"Exit Factor",              url:"https://www.exitfactor.com/businesses-for-sale/",                                    note:"Growing broker network focused on tech-enabled businesses." },
];

// ── SEARCH QUERIES ────────────────────────────────────────────
// Three tiers:
// 1. site: queries for big well-indexed marketplaces
// 2. Natural language mentioning specialist broker sites (no site: prefix)
// 3. Broad open-web queries to catch anything else
const SEARCH_QUERIES = [
  // ── BizBuySell (site: works, run 4 queries for max coverage)
  { q: 'site:bizbuysell.com "IT staffing" business for sale asking price revenue',                                   src: "BizBuySell" },
  { q: 'site:bizbuysell.com "managed service provider" OR "MSP" business for sale asking price',                    src: "BizBuySell" },
  { q: 'site:bizbuysell.com "IT consulting" business for sale revenue EBITDA',                                      src: "BizBuySell" },
  { q: 'site:bizbuysell.com "staff augmentation" OR "managed IT" business for sale United States',                  src: "BizBuySell" },

  // ── BizQuest (site: works)
  { q: 'site:bizquest.com "IT staffing" OR "managed service" OR "IT consulting" OR "MSP" business for sale',        src: "BizQuest" },
  { q: 'site:bizquest.com technology "IT services" OR "IT staffing" OR "managed IT" business for sale',             src: "BizQuest" },

  // ── BusinessBroker.net (site: works)
  { q: 'site:businessbroker.net "IT staffing" OR "managed service" OR "IT consulting" business for sale',           src: "BusinessBroker.net" },

  // ── Specialist brokers — natural language (site: returns nothing for these)
  { q: 'synergybb.com IT staffing company for sale OR managed service provider for sale listing',                   src: "Synergy Business Brokers" },
  { q: 'synergybb.com MSP for sale OR IT consulting firm for sale listing 2025',                                    src: "Synergy Business Brokers" },
  { q: 'itexchangenet.com IT staffing OR managed service provider OR MSP for sale listing',                         src: "IT ExchangeNet" },
  { q: 'itexchangenet.com IT consulting OR technology staffing business for sale 2025',                              src: "IT ExchangeNet" },
  { q: 'bramptoncapital.com managed service provider for sale OR IT staffing for sale listing',                     src: "Brampton Capital" },
  { q: 'lionbusinessbrokers.com IT staffing OR managed service OR IT consulting business for sale',                  src: "Lion Business Brokers" },
  { q: 'websiteclosers.com "IT staffing" OR "managed service provider" OR "MSP" for sale listing',                  src: "WebsiteClosers" },
  { q: 'dealstream.com IT staffing OR managed service provider OR IT consulting business for sale listing',          src: "DealStream" },
  { q: 'businessesforsale.com IT staffing OR managed service OR IT consulting for sale United States',               src: "BusinessesForSale.com" },

  // ── Broad web — catch listings anywhere
  { q: '"IT staffing company for sale" asking price revenue 2025 United States',                                     src: "General Web" },
  { q: '"IT staffing business for sale" EBITDA profitable 2025',                                                    src: "General Web" },
  { q: '"managed service provider for sale" OR "MSP for sale" 2025 revenue United States asking price',             src: "General Web" },
  { q: '"MSP acquisition" OR "buy MSP" for sale 2025 revenue EBITDA United States Canada',                          src: "General Web" },
  { q: '"IT consulting firm for sale" OR "IT consulting business for sale" 2025 United States asking price',        src: "General Web" },
  { q: '"IT consulting company for sale" revenue profitable 2025 United States',                                    src: "General Web" },
  { q: 'acquire "IT staffing" OR "managed IT services" OR "technology staffing" business for sale 2025 profitable', src: "General Web" },
  { q: '"staff augmentation company for sale" OR "IT services company for sale" 2025 United States revenue',        src: "General Web" },
  { q: 'buy "IT managed services" OR "managed service provider" business 2025 United States for sale',              src: "General Web" },
];

// ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function post(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers } },
      (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } }); }
    );
    req.on("error", reject); req.write(payload); req.end();
  });
}

// ── SANITIZE URLS ─────────────────────────────────────────────
// BizBuySell specific listing URLs are fragile — convert to search.
// All others: validate they look like a real non-homepage URL.
function sanitizeUrl(url, name, source) {
  if (!url) return null;

  // BizBuySell: convert to keyword search — specific listing URLs break
  if (source === "BizBuySell" || (url && url.includes("bizbuysell.com"))) {
    const kw = encodeURIComponent((name || "IT services").replace(/[^a-zA-Z0-9 ]/g, " ").trim().slice(0, 60));
    return `https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=${kw}`;
  }

  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (u.pathname.length < 3) return null; // reject bare domains
    if (/\/(login|register|signup|contact|about|terms|privacy)\/?$/i.test(u.pathname)) return null;
    return url;
  } catch { return null; }
}

// ── RUN ONE SEARCH WITH CLAUDE WEB SEARCH ────────────────────
async function runSearch(query, source) {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const prompt = `Today is ${new Date().toDateString()}. Run this web search and extract every business-for-sale listing you find:

SEARCH: ${query}

For EVERY listing found in search results, extract:
- name: exact listing title
- listingUrl: the direct URL to that specific listing page
- askingPrice: e.g. "$2.5M" or "Not disclosed"
- revenue: e.g. "$4.2M" or "Not disclosed"  
- ebitda: e.g. "$620k" or "Not disclosed"
- geography: city/state or region
- description: 1-2 sentences about the business
- isNew: true if listed after ${twoWeeksAgo.toDateString()}, else false
- listedDate: the listing date if visible, else "unknown"

Be thorough. Extract ALL listings you see — aim for 5-10+ if they exist. Include listings from any source in the results.

Return ONLY a raw JSON array (no markdown, no explanation):
[{"name":"...","listingUrl":"https://...","askingPrice":"...","revenue":"...","ebitda":"...","geography":"...","description":"...","isNew":false,"listedDate":"unknown"}]

If nothing found: []`;

  const res = await post(
    "api.anthropic.com", "/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    },
    { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
  );

  if (res.error) throw new Error(res.error.message);

  const text = (res.content || []).filter(b => b.type === "text").map(b => b.text || "").join("").trim();
  if (!text) return [];

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(l => l.name && l.name.length > 4)
      .map(l => ({
        ...l,
        source,
        listingUrl: sanitizeUrl(l.listingUrl, l.name, source),
        isNew: l.isNew === true,
      }))
      .filter(l => l.listingUrl); // drop any with null URLs
  } catch (e) {
    console.log(`     Parse error: ${e.message}`);
    return [];
  }
}

// ── SCORE LISTINGS WITH CLAUDE ────────────────────────────────
async function scoreListings(batch) {
  const criteria = `ACQUISITION CRITERIA:
- Sectors: ${CRITERIA.sectors}
- Geography: ${CRITERIA.geography}
- Revenue: ${CRITERIA.revenueMin}–${CRITERIA.revenueMax}
- EBITDA: ${CRITERIA.ebitdaMin}–${CRITERIA.ebitdaMax}
- Max Multiple: ${CRITERIA.multipleMax}
- Must-Have: ${CRITERIA.mustHave.join("; ")}
- Deal Breakers: ${CRITERIA.dealBreakers.join("; ")}
- Notes: ${CRITERIA.notes}`;

  const lines = batch.map((l, i) =>
    `[${i}] SRC:${l.source}|NAME:${l.name}|PRICE:${l.askingPrice||"?"}|REV:${l.revenue||"?"}|EBITDA:${l.ebitda||"?"}|GEO:${l.geography||"?"}|DESC:${(l.description||"").slice(0,160)}`
  ).join("\n");

  const res = await post(
    "api.anthropic.com", "/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: `You are an M&A analyst. Score each listing against the criteria. Be generous when the sector clearly matches.

${criteria}

LISTINGS:
${lines}

Return ONLY a JSON array, same order as input, no markdown:
[{"index":0,"name":"exact","listingUrl":"exact — do NOT change","source":"exact","askingPrice":"from input","revenue":"from input","ebitda":"from input","multiple":"calc or Not disclosed","sector":"specific sector","geography":"from input","score":82,"tier":"STRONG","headline":"What this business does in one sentence","whyFits":"2 sentences on fit","concerns":"1 sentence concern or null","keyMetrics":"known financials summary"}]

Scoring: 80-100=clear IT staffing/MSP/consulting fit; 60-79=likely relevant; 40-59=possible; 0-39=not a fit
Tiers: STRONG>=75, MODERATE 40-74, WEAK<40`,
      }],
    },
    { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
  );

  if (res.error) throw new Error(res.error.message);
  const raw   = (res.content || []).map(b => b.text || "").join("");
  const match = raw.replace(/```json|```/g,"").match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in scoring response");

  const scored = JSON.parse(match[0]);
  // Restore original URLs and metadata — never let model change them
  scored.forEach((r, i) => {
    if (!batch[i]) return;
    r.listingUrl = batch[i].listingUrl;
    r.source     = batch[i].source;
    r.isNew      = batch[i].isNew || false;
    r.listedDate = batch[i].listedDate || "unknown";
  });
  return scored;
}

// ── BUILD EMAIL ───────────────────────────────────────────────
function buildEmail(newListings, allListings, date, totalFound) {
  const strong   = allListings.filter(l => l.score >= 75);
  const moderate = allListings.filter(l => l.score >= 40 && l.score < 75);
  const weak     = allListings.filter(l => l.score < 40);

  const card = (l) => `
  <tr><td style="padding:18px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
    <table cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
      ${l.isNew ? `<td style="background:#1d3a6622;border:1.5px solid #3b82f6;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;color:#3b82f6;font-family:monospace;white-space:nowrap;">🆕 NEW</td><td style="width:6px"></td>` : ""}
      <td style="background:${l.score>=75?"#4ade8022":l.score>=40?"#facc1522":"#f8717122"};border:1.5px solid ${l.score>=75?"#4ade80":l.score>=40?"#facc15":"#f87171"};border-radius:20px;padding:2px 12px;font-size:11px;font-weight:700;color:${l.score>=75?"#4ade80":l.score>=40?"#facc15":"#f87171"};font-family:monospace;white-space:nowrap;">${l.score}% MATCH</td>
      <td style="padding-left:10px;color:#555;font-size:12px;">${l.source} · ${l.tier}${l.listedDate && l.listedDate !== "unknown" ? ` · ${l.listedDate}` : ""}</td>
    </tr></table>
    <h3 style="margin:6px 0 2px;color:#f0e6cc;font-size:15px;font-family:Georgia,serif;">${l.name}</h3>
    <p style="margin:0 0 6px;color:#666;font-size:12px;">${l.sector||""}${l.geography ? ` · ${l.geography}` : ""}</p>
    <p style="margin:0 0 10px;color:#aaa;font-size:13px;line-height:1.6;">${l.headline||""}</p>
    ${(l.askingPrice && l.askingPrice !== "Not disclosed") || (l.revenue && l.revenue !== "Not disclosed") ? `
    <table cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>
      ${l.askingPrice && l.askingPrice !== "Not disclosed" ? `<td style="background:#111;border:1px solid #222;border-radius:6px;padding:5px 12px;text-align:center;margin-right:6px;"><div style="color:#c8a84b;font-size:13px;font-weight:700;">${l.askingPrice}</div><div style="color:#555;font-size:10px;letter-spacing:1px;">ASK</div></td><td style="width:6px"></td>` : ""}
      ${l.revenue && l.revenue !== "Not disclosed" ? `<td style="background:#111;border:1px solid #222;border-radius:6px;padding:5px 12px;text-align:center;"><div style="color:#ddd;font-size:13px;font-weight:700;">${l.revenue}</div><div style="color:#555;font-size:10px;letter-spacing:1px;">REVENUE</div></td><td style="width:6px"></td>` : ""}
      ${l.ebitda && l.ebitda !== "Not disclosed" ? `<td style="background:#111;border:1px solid #222;border-radius:6px;padding:5px 12px;text-align:center;"><div style="color:#ddd;font-size:13px;font-weight:700;">${l.ebitda}</div><div style="color:#555;font-size:10px;letter-spacing:1px;">EBITDA</div></td>` : ""}
    </tr></table>` : ""}
    <p style="margin:0 0 3px;color:#4ade80;font-size:11px;font-weight:700;letter-spacing:.5px;">✓ WHY IT FITS</p>
    <p style="margin:0 0 8px;color:#aaa;font-size:13px;line-height:1.6;">${l.whyFits||""}</p>
    ${l.concerns ? `<p style="margin:0 0 3px;color:#f87171;font-size:11px;font-weight:700;letter-spacing:.5px;">⚠ CONCERNS</p><p style="margin:0 0 10px;color:#aaa;font-size:13px;line-height:1.6;">${l.concerns}</p>` : ""}
    <a href="${l.listingUrl}" style="display:inline-block;padding:6px 16px;background:#c8a84b15;border:1px solid #c8a84b55;border-radius:6px;color:#c8a84b;font-size:12px;font-weight:600;text-decoration:none;">View Listing →</a>
  </td></tr>`;

  const sectionHeader = (label, count, color) =>
    `<tr><td style="padding:20px 0 4px;"><p style="margin:0;color:${color};font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${label} (${count})</p></td></tr>`;

  const divider = `<tr><td style="height:1px;background:#1a1a1a;padding:0;"></td></tr>`;

  const newSection = newListings.length > 0 ? `
    ${sectionHeader("🆕 New Listings — Last 14 Days", newListings.length, "#3b82f6")}
    ${newListings.map(card).join("")}
    ${divider}` : "";

  const allSection = `
    ${sectionHeader("All Listings — Sorted by Match Score", allListings.length, "#888")}
    ${allListings.length > 0
      ? allListings.map(card).join("")
      : `<tr><td style="padding:24px 0;text-align:center;color:#444;font-size:13px;">No scored listings today. Check the sources below.</td></tr>`}`;

  const gatedRows = GATED_SOURCES.map(s => `
    <tr><td style="padding:7px 0;border-bottom:1px solid #161616;">
      <a href="${s.url}" style="color:#c8a84b;font-size:13px;font-weight:600;text-decoration:none;">${s.name} →</a>
      <span style="color:#3a3a3a;font-size:12px;margin-left:8px;">${s.note}</span>
    </td></tr>`).join("");

  return `<!DOCTYPE html><html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:28px 16px;">
<tr><td align="center"><table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;">

  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:12px 12px 0 0;padding:24px 28px;border-bottom:none;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <span style="background:#c8a84b;border-radius:5px;display:inline-block;width:22px;height:22px;text-align:center;line-height:22px;font-size:11px;color:#0a0a0a;font-weight:900;margin-bottom:8px;">◈</span>
        <h1 style="margin:0;color:#f0e6cc;font-size:18px;font-family:Georgia,serif;font-weight:normal;">M&amp;A Deal Digest</h1>
        <p style="margin:3px 0 0;color:#333;font-size:11px;">${date} · ${totalFound} listings found · ${newListings.length} new in last 14 days</p>
      </td>
      <td align="right" style="vertical-align:top;white-space:nowrap;">
        <p style="margin:1px 0;color:#3b82f6;font-size:12px;">🆕 ${newListings.length} New</p>
        <p style="margin:1px 0;color:#4ade80;font-size:12px;">● ${strong.length} Strong</p>
        <p style="margin:1px 0;color:#facc15;font-size:12px;">● ${moderate.length} Moderate</p>
        <p style="margin:1px 0;color:#f87171;font-size:12px;">● ${weak.length} Weak</p>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#0c0c0c;border:1px solid #1e1e1e;border-top:none;border-bottom:none;padding:9px 28px;">
    <p style="margin:0;color:#333;font-size:11px;font-family:monospace;">${CRITERIA.sectors} · ${CRITERIA.geography} · ${CRITERIA.revenueMin}–${CRITERIA.revenueMax} rev · max ${CRITERIA.multipleMax}</p>
  </td></tr>

  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-top:none;padding:0 28px 12px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${newSection}
      ${allSection}
    </table>
  </td></tr>

  <tr><td style="background:#090909;border:1px solid #1e1e1e;border-top:none;padding:18px 28px;">
    <p style="margin:0 0 10px;color:#2a2a2a;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Also Check — Login Required Sources</p>
    <table width="100%" cellpadding="0" cellspacing="0">${gatedRows}</table>
  </td></tr>

  <tr><td style="background:#070707;border:1px solid #1e1e1e;border-top:none;border-radius:0 0 12px 12px;padding:12px 28px;text-align:center;">
    <p style="margin:0;color:#222;font-size:10px;">M&amp;A Sourcing Agent · Powered by Claude · ${SEARCH_QUERIES.length} sources searched daily</p>
  </td></tr>

</table></td></tr>
</table></body></html>`;
}

// ── SEND EMAIL ────────────────────────────────────────────────
async function sendEmail(html, newCount, strongCount, total) {
  const subject = `M&A Digest ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})} — ${newCount} new · ${strongCount} strong · ${total} total listings`;
  const res = await post(
    "api.resend.com", "/emails",
    { from: EMAIL_FROM, to: [EMAIL_TO], subject, html },
    { Authorization: `Bearer ${RESEND_API_KEY}` }
  );
  if (res.error) throw new Error(`Resend: ${res.error.message||JSON.stringify(res.error)}`);
  console.log(`✓ Email sent (id: ${res.id})`);
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}`);
  console.log(`  ${SEARCH_QUERIES.length} queries across ${[...new Set(SEARCH_QUERIES.map(q=>q.src))].length} source categories`);
  console.log("─".repeat(54));

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY)    throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO)          throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM)        throw new Error("Missing EMAIL_FROM");

  // ── 1. Run all searches
  console.log(`\n① Running ${SEARCH_QUERIES.length} web searches...`);
  const allFound = [];
  const seenUrls = new Set();
  const sourceCounts = {};

  for (const { q, src } of SEARCH_QUERIES) {
    process.stdout.write(`   [${src}] searching... `);
    try {
      const results = await runSearch(q, src);
      let added = 0;
      for (const l of results) {
        if (!l.listingUrl || seenUrls.has(l.listingUrl)) continue;
        seenUrls.add(l.listingUrl);
        allFound.push(l);
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        added++;
      }
      console.log(`${added} found`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await sleep(1200);
  }

  console.log(`\n  Results by source:`);
  Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).forEach(([src,n]) => console.log(`    ${src}: ${n}`));
  console.log(`  Total unique: ${allFound.length}`);

  if (allFound.length === 0) {
    console.log("  No listings found — sending gated-sources digest.");
    const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    await sendEmail(buildEmail([], [], date, 0), 0, 0, 0);
    return;
  }

  // ── 2. Score in batches of 20
  console.log(`\n② Scoring ${allFound.length} listings...`);
  let scored = [];
  const BATCH = 20;

  for (let i = 0; i < allFound.length; i += BATCH) {
    const batch = allFound.slice(i, i + BATCH);
    console.log(`   Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(allFound.length/BATCH)}...`);
    try {
      scored.push(...await scoreListings(batch));
    } catch (e) {
      console.log(`   Error: ${e.message} — using fallback`);
      batch.forEach(l => scored.push({
        ...l, score:50, tier:"MODERATE", sector:"Unknown",
        multiple:"Not disclosed", headline:"See listing for details.",
        whyFits:"Could not score — review listing directly.",
        concerns:null, keyMetrics:"Not disclosed",
      }));
    }
    await sleep(800);
  }

  // ── 3. Sort and split
  scored.sort((a, b) => b.score - a.score);
  const newListings = scored.filter(l => l.isNew);
  const allListings = scored; // all listings, sorted by score

  console.log(`\n  Summary:`);
  console.log(`    New (last 14 days): ${newListings.length}`);
  console.log(`    Strong (>=75):      ${allListings.filter(l=>l.score>=75).length}`);
  console.log(`    Moderate (40-74):   ${allListings.filter(l=>l.score>=40&&l.score<75).length}`);
  console.log(`    Weak (<40):         ${allListings.filter(l=>l.score<40).length}`);
  console.log(`    Total:              ${allListings.length}`);
  console.log(`\n  Top listings:`);
  allListings.slice(0, 15).forEach(l => {
    const bar = "█".repeat(Math.round(l.score/10)) + "░".repeat(10-Math.round(l.score/10));
    console.log(`    ${bar} ${l.score}% ${l.isNew?"🆕":""} [${l.source}] ${(l.name||"").slice(0,50)}`);
  });

  // ── 4. Send email
  console.log(`\n③ Sending email...`);
  const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmail(newListings, allListings, date, allFound.length);
  await sendEmail(html, newListings.length, allListings.filter(l=>l.score>=75).length, allListings.length);

  console.log("\n✓ Done.\n");
}

main().catch(err => { console.error("\n✗ Failed:", err.message); process.exit(1); });
