// ============================================================
// M&A Sourcing Agent — Daily Runner (Web Search Edition)
// Uses Claude's built-in web search to find REAL listings
// with real URLs, then scores and emails the digest.
// ============================================================

const https = require("https");

// ── CONFIG ───────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

// ── YOUR ACQUISITION CRITERIA ────────────────────────────────
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

// ── GATED SOURCES (always shown in email footer) ──────────────
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

// ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function post(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── SEARCH FOR REAL LISTINGS USING CLAUDE WEB SEARCH ─────────
async function searchForListings(searchQuery, sourceHint) {
  const res = await post(
    "api.anthropic.com",
    "/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Search for: ${searchQuery}

Find real, currently active business-for-sale listings. For each listing you find, extract:
- The exact listing title/business name
- The direct URL to that specific listing page
- Any financial details mentioned (asking price, revenue, EBITDA)
- Location/geography
- Brief description

Return ONLY a JSON array of listings found. No markdown fences. Example format:
[{"name":"IT MSP - Pacific Northwest","listingUrl":"https://www.bizbuysell.com/listing/it-msp-12345","source":"${sourceHint}","askingPrice":"$2.1M","revenue":"$3.2M","ebitda":"$480k","geography":"Washington, US","description":"Managed IT services provider serving SMBs..."}]

If you find no relevant listings, return an empty array: []`,
      }],
    },
    { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
  );

  if (res.error) throw new Error(res.error.message);

  // Extract text from response (may include tool_use blocks)
  const textBlocks = (res.content || []).filter(b => b.type === "text");
  const raw = textBlocks.map(b => b.text || "").join("").trim();
  if (!raw) return [];

  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    // Find JSON array in response
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.log(`     Parse error for "${sourceHint}": ${e.message}`);
    return [];
  }
}

// ── SEARCH QUERIES ────────────────────────────────────────────
const SEARCH_QUERIES = [
  { query: 'site:bizbuysell.com "IT staffing" OR "IT consulting" OR "managed service provider" business for sale',         source: "BizBuySell" },
  { query: 'site:bizbuysell.com "MSP" OR "managed IT" OR "IT services" business for sale United States',                   source: "BizBuySell" },
  { query: 'site:bizquest.com "IT staffing" OR "managed service" OR "IT consulting" business for sale',                    source: "BizQuest" },
  { query: 'site:dealstream.com IT staffing OR managed service provider OR IT consulting for sale',                        source: "DealStream" },
  { query: 'site:itexchangenet.com MSP OR "IT staffing" OR "IT consulting" for sale',                                      source: "IT ExchangeNet" },
  { query: 'site:synergybb.com "IT staffing" OR "managed service" OR "IT consulting" for sale',                            source: "Synergy Business Brokers" },
  { query: 'site:businessbroker.net "IT staffing" OR "managed IT services" OR "IT consulting" for sale',                   source: "BusinessBroker.net" },
  { query: 'site:bramptoncapital.com managed service OR IT staffing OR IT consulting for sale',                            source: "Brampton Capital" },
  { query: 'site:websiteclosers.com "IT staffing" OR "managed service provider" OR "IT consulting" for sale',              source: "WebsiteClosers" },
  { query: 'site:businessesforsale.com "IT staffing" OR "managed IT" OR "IT consulting" business for sale',                source: "BusinessesForSale.com" },
  { query: '"IT staffing company for sale" OR "MSP for sale" OR "managed service provider for sale" 2025 United States',   source: "General Web" },
  { query: '"IT consulting firm for sale" OR "IT services business for sale" 2025 asking price revenue',                   source: "General Web" },
];

// ── SCORE ALL LISTINGS WITH CLAUDE ───────────────────────────
async function scoreListings(listings) {
  const criteriaBlock = `
ACQUISITION CRITERIA:
- Sectors: ${CRITERIA.sectors}
- Geography: ${CRITERIA.geography}
- Revenue: ${CRITERIA.revenueMin}–${CRITERIA.revenueMax}
- EBITDA: ${CRITERIA.ebitdaMin}–${CRITERIA.ebitdaMax}
- Max Multiple: ${CRITERIA.multipleMax}
- Must-Have: ${CRITERIA.mustHave.join("; ")}
- Deal Breakers: ${CRITERIA.dealBreakers.join("; ")}
- Notes: ${CRITERIA.notes}`.trim();

  const listingLines = listings.map((l, i) =>
    `[${i}] SOURCE:${l.source} | NAME:${l.name} | URL:${l.listingUrl} | PRICE:${l.askingPrice||"?"} | REV:${l.revenue||"?"} | EBITDA:${l.ebitda||"?"} | GEO:${l.geography||"?"} | DESC:${(l.description||"").slice(0,200)}`
  ).join("\n");

  const res = await post(
    "api.anthropic.com",
    "/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: `You are an expert M&A analyst. Score each real business listing against the acquisition criteria.

${criteriaBlock}

REAL LISTINGS TO SCORE:
${listingLines}

Return ONLY a valid JSON array, no markdown, no preamble. One object per listing in the same order:
[
  {
    "index": 0,
    "name": "exact name from input",
    "listingUrl": "exact URL from input — do NOT modify",
    "source": "exact source from input",
    "askingPrice": "from input or Not disclosed",
    "revenue": "from input or Not disclosed",
    "ebitda": "from input or Not disclosed",
    "multiple": "calculate if possible or Not disclosed",
    "sector": "inferred specific sector",
    "geography": "from input or inferred",
    "employees": "Not disclosed",
    "founded": "Not disclosed",
    "score": 82,
    "tier": "STRONG",
    "headline": "One sentence on what this business does",
    "whyFits": "2 sentences on why this fits the criteria",
    "concerns": "1 sentence on main concern, or null",
    "keyMetrics": "summarize any known financials, else Not disclosed"
  }
]

Scoring: 80-100=clearly IT staffing/MSP/consulting, right geography, financials fit; 60-79=likely relevant, some ambiguity; 40-59=possibly relevant; 0-39=not a fit.
Tiers: STRONG>=75, MODERATE 40-74, WEAK<40.`,
      }],
    },
    { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
  );

  if (res.error) throw new Error(res.error.message);
  const raw   = res.content.map(b => b.text || "").join("");
  const clean = raw.replace(/```json|```/g, "").trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in scoring response");
  const scored = JSON.parse(match[0]);

  // Always restore original URLs — never trust model to keep them unchanged
  scored.forEach((r, i) => {
    r.listingUrl = listings[i].listingUrl;
    r.source     = listings[i].source;
  });

  return scored;
}

// ── BUILD EMAIL HTML ──────────────────────────────────────────
function buildEmailHtml(listings, date, totalFound) {
  const strong   = listings.filter(l => l.score >= 75);
  const moderate = listings.filter(l => l.score >= 40 && l.score < 75);
  const weak     = listings.filter(l => l.score < 40);

  const listingRows = listings.map(l => `
    <tr><td style="padding:18px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:${l.score>=75?"#4ade8022":l.score>=40?"#facc1522":"#f8717122"};border:1.5px solid ${l.score>=75?"#4ade80":l.score>=40?"#facc15":"#f87171"};border-radius:20px;padding:2px 12px;font-size:11px;font-weight:700;color:${l.score>=75?"#4ade80":l.score>=40?"#facc15":"#f87171"};font-family:monospace;white-space:nowrap;">${l.score}% MATCH</td>
          <td style="padding-left:10px;color:#555;font-size:12px;">${l.source} · ${l.tier}</td>
        </tr></table>
        <h3 style="margin:8px 0 2px;color:#f0e6cc;font-size:15px;font-family:Georgia,serif;">${l.name}</h3>
        <p style="margin:0 0 6px;color:#777;font-size:12px;">${l.sector} · ${l.geography}</p>
        <p style="margin:0 0 10px;color:#aaa;font-size:13px;line-height:1.6;">${l.headline}</p>
        ${(l.askingPrice && l.askingPrice !== "Not disclosed") || (l.revenue && l.revenue !== "Not disclosed") ? `
        <table cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>
          ${l.askingPrice && l.askingPrice !== "Not disclosed" ? `<td style="background:#111;border:1px solid #222;border-radius:6px;padding:6px 14px;text-align:center;"><div style="color:#c8a84b;font-size:14px;font-weight:700;">${l.askingPrice}</div><div style="color:#555;font-size:10px;letter-spacing:1px;">ASK</div></td><td style="width:8px;"></td>` : ""}
          ${l.revenue && l.revenue !== "Not disclosed" ? `<td style="background:#111;border:1px solid #222;border-radius:6px;padding:6px 14px;text-align:center;"><div style="color:#ddd;font-size:14px;font-weight:700;">${l.revenue}</div><div style="color:#555;font-size:10px;letter-spacing:1px;">REVENUE</div></td><td style="width:8px;"></td>` : ""}
          ${l.ebitda && l.ebitda !== "Not disclosed" ? `<td style="background:#111;border:1px solid #222;border-radius:6px;padding:6px 14px;text-align:center;"><div style="color:#ddd;font-size:14px;font-weight:700;">${l.ebitda}</div><div style="color:#555;font-size:10px;letter-spacing:1px;">EBITDA</div></td>` : ""}
        </tr></table>` : ""}
        <p style="margin:0 0 4px;color:#4ade80;font-size:12px;font-weight:600;">✓ WHY IT FITS</p>
        <p style="margin:0 0 8px;color:#aaa;font-size:13px;line-height:1.6;">${l.whyFits}</p>
        ${l.concerns ? `<p style="margin:0 0 4px;color:#f87171;font-size:12px;font-weight:600;">⚠ CONCERNS</p><p style="margin:0 0 10px;color:#aaa;font-size:13px;line-height:1.6;">${l.concerns}</p>` : ""}
        <a href="${l.listingUrl}" style="display:inline-block;padding:7px 18px;background:#c8a84b1a;border:1px solid #c8a84b55;border-radius:6px;color:#c8a84b;font-size:12px;font-weight:600;text-decoration:none;">View Real Listing →</a>
      </td></tr></table>
    </td></tr>`).join("");

  const gatedRows = GATED_SOURCES.map(s => `
    <tr><td style="padding:7px 0;border-bottom:1px solid #181818;">
      <a href="${s.url}" style="color:#c8a84b;font-size:13px;font-weight:600;text-decoration:none;">${s.name} →</a>
      <span style="color:#444;font-size:12px;margin-left:8px;">${s.note}</span>
    </td></tr>`).join("");

  return `<!DOCTYPE html><html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
<tr><td align="center">
<table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;">

  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:12px 12px 0 0;padding:26px 30px;border-bottom:none;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <span style="background:#c8a84b;border-radius:5px;display:inline-block;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;color:#0a0a0a;font-weight:900;margin-bottom:8px;">◈</span>
        <h1 style="margin:0;color:#f0e6cc;font-size:19px;font-family:Georgia,serif;font-weight:normal;">M&amp;A Deal Digest</h1>
        <p style="margin:3px 0 0;color:#3a3a3a;font-size:11px;">${date} &nbsp;·&nbsp; ${totalFound} listings found &nbsp;·&nbsp; ${listings.length} shown after scoring</p>
      </td>
      <td align="right" style="vertical-align:top;">
        <p style="margin:2px 0;color:#4ade80;font-size:12px;">● ${strong.length} Strong</p>
        <p style="margin:2px 0;color:#facc15;font-size:12px;">● ${moderate.length} Moderate</p>
        <p style="margin:2px 0;color:#f87171;font-size:12px;">● ${weak.length} Weak</p>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#0c0c0c;border:1px solid #1e1e1e;border-top:none;border-bottom:none;padding:10px 30px;">
    <p style="margin:0;color:#3a3a3a;font-size:11px;font-family:monospace;letter-spacing:.5px;">
      ${CRITERIA.sectors} &nbsp;·&nbsp; ${CRITERIA.geography} &nbsp;·&nbsp; ${CRITERIA.revenueMin}–${CRITERIA.revenueMax} rev &nbsp;·&nbsp; max ${CRITERIA.multipleMax}
    </p>
  </td></tr>

  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-top:none;padding:0 30px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0">${listingRows.length ? listingRows : '<tr><td style="padding:30px 0;text-align:center;color:#444;font-size:13px;">No listings matched your criteria today. Check the sources below.</td></tr>'}</table>
  </td></tr>

  <tr><td style="background:#0a0a0a;border:1px solid #1e1e1e;border-top:none;padding:20px 30px;">
    <p style="margin:0 0 10px;color:#3a3a3a;font-size:10px;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;">Also Check — Login Required Sources</p>
    <table width="100%" cellpadding="0" cellspacing="0">${gatedRows}</table>
  </td></tr>

  <tr><td style="background:#080808;border:1px solid #1e1e1e;border-top:none;border-radius:0 0 12px 12px;padding:14px 30px;text-align:center;">
    <p style="margin:0;color:#2a2a2a;font-size:10px;letter-spacing:.5px;">M&amp;A Sourcing Agent &nbsp;·&nbsp; Real listings found via web search daily &nbsp;·&nbsp; Powered by Claude</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── SEND EMAIL ────────────────────────────────────────────────
async function sendEmail(html, strongCount, totalShown) {
  const subject = `M&A Digest ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})} — ${strongCount} strong match${strongCount!==1?"es":""} from ${totalShown} real listings`;
  const res = await post(
    "api.resend.com", "/emails",
    { from: EMAIL_FROM, to: [EMAIL_TO], subject, html },
    { Authorization: `Bearer ${RESEND_API_KEY}` }
  );
  if (res.error) throw new Error(`Resend: ${res.error.message || JSON.stringify(res.error)}`);
  console.log(`✓ Email sent → ${EMAIL_TO} (id: ${res.id})`);
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}`);
  console.log("─".repeat(52));

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY)    throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO)          throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM)        throw new Error("Missing EMAIL_FROM");

  // 1. Search for real listings using Claude web search
  console.log(`\n① Searching for real listings (${SEARCH_QUERIES.length} queries)...`);
  const allListings = [];
  const seenUrls = new Set();

  for (const { query, source } of SEARCH_QUERIES) {
    console.log(`   Searching: ${source} — "${query.slice(0, 60)}..."`);
    try {
      const found = await searchForListings(query, source);
      let added = 0;
      for (const l of found) {
        if (!l.listingUrl || seenUrls.has(l.listingUrl)) continue;
        // Basic quality filter — must have a real URL and a name
        if (!l.name || l.name.length < 5) continue;
        seenUrls.add(l.listingUrl);
        allListings.push(l);
        added++;
      }
      console.log(`     → ${added} new listings`);
    } catch (e) {
      console.log(`     Error: ${e.message}`);
    }
    await sleep(1000); // be polite between searches
  }

  console.log(`\n   Total unique listings found: ${allListings.length}`);

  if (allListings.length === 0) {
    console.log("   No listings found — sending gated-sources-only digest.");
    const dateStr = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    const html = buildEmailHtml([], dateStr, 0);
    await sendEmail(html, 0, 0);
    return;
  }

  // 2. Score all listings with Claude
  console.log("\n② Scoring listings with Claude...");
  let scored = [];
  const BATCH = 20;
  for (let i = 0; i < allListings.length; i += BATCH) {
    const batch = allListings.slice(i, i + BATCH);
    console.log(`   Scoring batch ${Math.floor(i/BATCH)+1} (${batch.length} listings)...`);
    try {
      const results = await scoreListings(batch);
      scored.push(...results);
    } catch (e) {
      console.log(`   Batch error: ${e.message} — using fallback`);
      batch.forEach(l => scored.push({
        ...l, score:50, tier:"MODERATE", sector:"Unknown", geography:"Unknown",
        multiple:"Not disclosed", employees:"Not disclosed", founded:"Not disclosed",
        headline:"See listing for details.",
        whyFits:"Could not score automatically — review listing directly.",
        concerns:null, keyMetrics:"Not disclosed",
      }));
    }
    await sleep(800);
  }

  // 3. Sort, filter to score >= 40, cap at top 25
  const final = scored
    .sort((a, b) => b.score - a.score)
    .filter(l => l.score >= 40)
    .slice(0, 25);

  const strong = final.filter(l => l.score >= 75);
  console.log(`\n   Showing ${final.length} listings (${strong.length} strong matches)`);
  final.forEach(l => {
    const bar = "█".repeat(Math.round(l.score/10)) + "░".repeat(10-Math.round(l.score/10));
    console.log(`   ${bar} ${l.score}% — ${(l.name||"").slice(0,55)} [${l.source}]`);
  });

  // 4. Generate and send email
  console.log("\n③ Generating & sending email...");
  const dateStr = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmailHtml(final, dateStr, allListings.length);
  await sendEmail(html, strong.length, final.length);

  console.log("\n✓ Done.\n");
}

main().catch(err => {
  console.error("\n✗ Agent failed:", err.message);
  process.exit(1);
});
