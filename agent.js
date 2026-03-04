// ============================================================
// M&A Sourcing Agent — Daily Runner (Real Scraper Edition)
// - Scrapes live listings from public sources
// - Provides direct deep links for login-required sources
// - Scores all listings with Claude AI
// - Emails a formatted digest with real working links
// ============================================================

const https = require("https");
const http  = require("http");

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
// ─────────────────────────────────────────────────────────────

// ── SOURCES CONFIG ────────────────────────────────────────────
// type "scrape" = fetch and parse live HTML
// type "link"   = gated/login-required; direct link sent in email
const SOURCES = [
  { name:"BizBuySell",            type:"scrape", urls:[
    "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=IT+staffing",
    "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=managed+service+provider",
    "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=IT+consulting",
  ]},
  { name:"BizQuest",              type:"scrape", urls:[
    "https://www.bizquest.com/business-for-sale/technology-internet-businesses/?q=IT+staffing",
    "https://www.bizquest.com/business-for-sale/technology-internet-businesses/?q=managed+services",
    "https://www.bizquest.com/business-for-sale/technology-internet-businesses/?q=IT+consulting",
  ]},
  { name:"BusinessBroker.net",    type:"scrape", urls:[
    "https://www.businessbroker.net/business-for-sale/technology-businesses/?keywords=IT+staffing",
    "https://www.businessbroker.net/business-for-sale/technology-businesses/?keywords=managed+service",
  ]},
  { name:"DealStream",            type:"scrape", urls:[
    "https://dealstream.com/it-businesses-for-sale",
  ]},
  { name:"IT ExchangeNet",        type:"scrape", urls:[
    "https://www.itexchangenet.com/for-sale",
  ]},
  { name:"Synergy Business Brokers", type:"scrape", urls:[
    "https://synergybb.com/businesses-for-sale/it-services-companies-for-sale/",
    "https://synergybb.com/businesses-for-sale/staffing/",
    "https://synergybb.com/businesses-for-sale/managed-service-providers-msp/",
  ]},
  { name:"Brampton Capital",      type:"scrape", urls:[
    "https://bramptoncapital.com/managed-services-companies-for-sale/",
  ]},
  { name:"WebsiteClosers",        type:"scrape", urls:[
    "https://www.websiteclosers.com/businesses-for-sale/",
  ]},
  { name:"BusinessesForSale.com", type:"scrape", urls:[
    "https://www.businessesforsale.com/search?industry=it-internet&keywords=IT+staffing",
    "https://www.businessesforsale.com/search?industry=it-internet&keywords=managed+services",
  ]},
  { name:"Lion Business Brokers", type:"scrape", urls:[
    "https://lionbusinessbrokers.com/businesses-for-sale/",
  ]},
  // ── Gated / login-required sources ──────────────────────────
  { name:"Axial.net",               type:"link", searchUrl:"https://www.axial.net/forum/companies/internet-software-services-m-a-advisory-firms/", note:"Free registration. Filter by IT Services / Staffing." },
  { name:"FOCUS Investment Banking", type:"link", searchUrl:"https://focusbankers.com/it-services-msp/",                                           note:"Specialist MSP & IT M&A advisor. Contact for current listings." },
  { name:"Corum Group",             type:"link", searchUrl:"https://corumgroup.com/transactions/",                                                 note:"Tech M&A advisor. Review recent transactions for seller outreach." },
  { name:"Griffin Financial Group", type:"link", searchUrl:"https://www.griffinfingroup.com/industries/staffing/",                                 note:"Staffing industry M&A specialist. Contact for off-market IT deals." },
  { name:"MKLINK MSP Marketplace",  type:"link", searchUrl:"https://mklink.org/mergers-acquisitions/",                                             note:"MSP-exclusive broker. Register free to receive MSP listings." },
  { name:"Generational Equity",     type:"link", searchUrl:"https://www.genequity.com/businesses-for-sale/",                                       note:"Mid-market M&A. Browse technology category." },
  { name:"Benchmark International", type:"link", searchUrl:"https://www.benchmarkcorporate.com/businesses-for-sale",                               note:"Global M&A firm. Filter by technology sector." },
  { name:"Colonnade Advisors",      type:"link", searchUrl:"https://coladv.com/transactions/",                                                     note:"Staffing & tech M&A specialist. Review transaction pipeline." },
  { name:"Transworld Business Advisors", type:"link", searchUrl:"https://www.tworld.com/buy-a-business/business-listing-search",                   note:"Large broker network. Search technology / staffing listings." },
  { name:"Sunbelt Business Brokers",type:"link", searchUrl:"https://www.sunbeltnetwork.com/businesses-for-sale/?industry=Technology",               note:"National broker network. Filter to Technology industry." },
  { name:"Murphy Business Brokers", type:"link", searchUrl:"https://www.murphybusiness.com/listings/?industry=technology",                          note:"National broker. Technology listings section." },
  { name:"RoseBiz",                 type:"link", searchUrl:"https://www.rosebiz.com/businesses-for-sale/",                                         note:"Specialist in MSPs, VARs, CSPs and Microsoft channel partners." },
  { name:"Exit Factor",             type:"link", searchUrl:"https://www.exitfactor.com/businesses-for-sale/",                                      note:"Growing broker network focused on tech-enabled businesses." },
];

// ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchUrl(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 3) return reject(new Error("Too many redirects"));
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
      },
      timeout: 15000,
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        let next = res.headers.location;
        if (!next.startsWith("http")) { try { next = new URL(next, url).href; } catch { return reject(new Error("Bad redirect")); } }
        res.resume();
        return fetchUrl(next, depth + 1).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ html: data, status: res.statusCode, finalUrl: url }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function post(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers } },
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

function stripTags(s = "") {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
          .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ")
          .replace(/\s+/g," ").trim();
}

function toAbsolute(href, base) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  try { return new URL(href, base).href; } catch { return null; }
}

function isJunkUrl(url) {
  if (!url) return true;
  return /privacy|terms|contact|about|login|register|faq|cart|checkout|sitemap|#/i.test(url)
    || /^https?:\/\/[^/]+\/?$/.test(url);
}

// ── GENERIC LISTING EXTRACTOR ─────────────────────────────────
function extractListings(html, baseUrl, sourceName) {
  const found = [];
  const seen  = new Set();

  const add = (href, rawName) => {
    const url  = toAbsolute(href, baseUrl);
    const name = stripTags(rawName || "").replace(/\s+/g, " ").slice(0, 140);
    if (!url || !name || name.length < 6 || seen.has(url) || isJunkUrl(url)) return;
    seen.add(url);
    found.push({ source: sourceName, name, listingUrl: url });
  };

  // Pattern 1: class="listing-title" or class="listing-name" containing anchor
  const re1 = /class="[^"]*listing[_-]?(?:title|name|link)[^"]*"[^>]*>[\s\S]{0,80}<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{3,140}?)<\/a/gi;
  let m;
  while ((m = re1.exec(html)) !== null) add(m[1], m[2]);

  // Pattern 2: anchor with class containing listing-title
  const re2 = /<a[^>]+class="[^"]*(?:listing[_-]?(?:title|name|link)|business[_-]?name)[^"]*"[^>]+href="([^"#]+)"[^>]*>([\s\S]{3,140}?)<\/a/gi;
  while ((m = re2.exec(html)) !== null) add(m[1], m[2]);

  // Pattern 3: h2/h3 wrapping anchor  
  const re3 = /<h[23][^>]*>\s*(?:<[^>]+>\s*)*<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{6,140}?)<\/a/gi;
  while ((m = re3.exec(html)) !== null) add(m[1], m[2]);

  // Pattern 4: data-title or title attributes on links
  const re4 = /<a[^>]+(?:data-title|title)="([^"]{8,140})"[^>]+href="([^"#]+)"[^>]*/gi;
  while ((m = re4.exec(html)) !== null) add(m[2], m[1]);

  return found;
}

// ── SCRAPE ALL PUBLIC SOURCES ─────────────────────────────────
async function scrapeAllSources() {
  const all = [];

  for (const source of SOURCES.filter(s => s.type === "scrape")) {
    console.log(`   Scraping ${source.name}...`);
    let count = 0;
    const seenUrls = new Set();

    for (const url of source.urls) {
      try {
        const { html, status } = await fetchUrl(url);
        if (status === 200 && html.length > 500) {
          const found = extractListings(html, url, source.name)
            .filter(l => !seenUrls.has(l.listingUrl))
            .slice(0, 10);
          found.forEach(l => seenUrls.add(l.listingUrl));
          all.push(...found);
          count += found.length;
        } else {
          console.log(`     HTTP ${status} — skipping`);
        }
        await sleep(1500);
      } catch (e) {
        console.log(`     Error: ${e.message}`);
        await sleep(500);
      }
    }
    console.log(`     → ${count} listings`);
  }

  return all;
}

// ── SCORE LISTINGS WITH CLAUDE ────────────────────────────────
async function scoreListings(batch) {
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

  const listingLines = batch.map((l, i) =>
    `[${i}] SOURCE: ${l.source} | NAME: ${l.name} | URL: ${l.listingUrl}`
  ).join("\n");

  const prompt = `You are an expert M&A analyst. Today is ${new Date().toDateString()}.

Evaluate each scraped business listing against the acquisition criteria. Infer sector and fit from the business name and source.

${criteriaBlock}

SCRAPED LISTINGS:
${listingLines}

Return ONLY a valid JSON array (no markdown, no preamble), one object per listing in the same order:
[
  {
    "index": 0,
    "name": "exact name from input",
    "listingUrl": "exact URL from input — do NOT change",
    "source": "exact source from input",
    "sector": "inferred sector",
    "geography": "inferred geography or Not specified",
    "revenue": "Not disclosed",
    "ebitda": "Not disclosed",
    "askingPrice": "Not disclosed",
    "multiple": "Not disclosed",
    "employees": "Not disclosed",
    "founded": "Not disclosed",
    "score": 75,
    "tier": "STRONG",
    "headline": "One sentence on what this business likely does",
    "whyFits": "2 sentences on fit with criteria",
    "concerns": "1 sentence on main concern, or null",
    "keyMetrics": "Not disclosed — see listing"
  }
]

Scoring: 80-100=clearly IT staffing/MSP/consulting in right geo; 60-79=likely relevant but ambiguous; 40-59=possibly relevant; 0-39=clearly not a fit.
Tiers: STRONG>=75, MODERATE 40-74, WEAK<40.`;

  const res = await post(
    "api.anthropic.com",
    "/v1/messages",
    { model: "claude-sonnet-4-20250514", max_tokens: 8000, messages: [{ role: "user", content: prompt }] },
    { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
  );

  if (res.error) throw new Error(res.error.message);
  const raw   = res.content.map(b => b.text || "").join("");
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── EMAIL BUILDER ─────────────────────────────────────────────
function buildEmailHtml(listings, date, totalScraped) {
  const strong   = listings.filter(l => l.score >= 75);
  const moderate = listings.filter(l => l.score >= 40 && l.score < 75);
  const weak     = listings.filter(l => l.score < 40);

  const rows = listings.map(l => `
    <tr><td style="padding:18px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:${l.score>=75?"#4ade8022":l.score>=40?"#facc1522":"#f8717122"};border:1.5px solid ${l.score>=75?"#4ade80":l.score>=40?"#facc15":"#f87171"};border-radius:20px;padding:2px 12px;font-size:11px;font-weight:700;color:${l.score>=75?"#4ade80":l.score>=40?"#facc15":"#f87171"};font-family:monospace;white-space:nowrap;">${l.score}% MATCH</td>
          <td style="padding-left:10px;color:#666;font-size:12px;">${l.source} · ${l.tier}</td>
        </tr></table>
        <h3 style="margin:8px 0 2px;color:#f0e6cc;font-size:15px;font-family:Georgia,serif;">${l.name}</h3>
        <p style="margin:0 0 6px;color:#888;font-size:12px;">${l.sector} · ${l.geography}</p>
        <p style="margin:0 0 10px;color:#aaa;font-size:13px;line-height:1.6;">${l.headline}</p>
        <p style="margin:0 0 4px;color:#4ade80;font-size:12px;font-weight:600;">✓ WHY IT FITS</p>
        <p style="margin:0 0 8px;color:#aaa;font-size:13px;line-height:1.6;">${l.whyFits}</p>
        ${l.concerns ? `<p style="margin:0 0 4px;color:#f87171;font-size:12px;font-weight:600;">⚠ CONCERNS</p><p style="margin:0 0 10px;color:#aaa;font-size:13px;line-height:1.6;">${l.concerns}</p>` : ""}
        <a href="${l.listingUrl}" style="display:inline-block;padding:7px 18px;background:#c8a84b1a;border:1px solid #c8a84b55;border-radius:6px;color:#c8a84b;font-size:12px;font-weight:600;text-decoration:none;">View Real Listing →</a>
      </td></tr></table>
    </td></tr>`).join("");

  const gatedRows = SOURCES.filter(s => s.type === "link").map(s => `
    <tr><td style="padding:7px 0;border-bottom:1px solid #181818;">
      <a href="${s.searchUrl}" style="color:#c8a84b;font-size:13px;font-weight:600;text-decoration:none;">${s.name} →</a>
      <span style="color:#444;font-size:12px;margin-left:8px;">${s.note}</span>
    </td></tr>`).join("");

  return `<!DOCTYPE html><html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
<tr><td align="center">
<table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:12px 12px 0 0;padding:26px 30px;border-bottom:none;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <span style="background:#c8a84b;border-radius:5px;display:inline-block;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;color:#0a0a0a;font-weight:900;margin-bottom:8px;">◈</span>
        <h1 style="margin:0;color:#f0e6cc;font-size:19px;font-family:Georgia,serif;font-weight:normal;">M&amp;A Deal Digest</h1>
        <p style="margin:3px 0 0;color:#3a3a3a;font-size:11px;">${date} &nbsp;·&nbsp; ${totalScraped} listings scraped &nbsp;·&nbsp; ${listings.length} shown after scoring</p>
      </td>
      <td align="right" style="vertical-align:top;">
        <p style="margin:2px 0;color:#4ade80;font-size:12px;">● ${strong.length} Strong</p>
        <p style="margin:2px 0;color:#facc15;font-size:12px;">● ${moderate.length} Moderate</p>
        <p style="margin:2px 0;color:#f87171;font-size:12px;">● ${weak.length} Weak</p>
      </td>
    </tr></table>
  </td></tr>

  <!-- Criteria bar -->
  <tr><td style="background:#0c0c0c;border:1px solid #1e1e1e;border-top:none;border-bottom:none;padding:10px 30px;">
    <p style="margin:0;color:#3a3a3a;font-size:11px;font-family:monospace;letter-spacing:.5px;">
      ${CRITERIA.sectors} &nbsp;·&nbsp; ${CRITERIA.geography} &nbsp;·&nbsp; ${CRITERIA.revenueMin}–${CRITERIA.revenueMax} rev &nbsp;·&nbsp; max ${CRITERIA.multipleMax}
    </p>
  </td></tr>

  <!-- Listings -->
  <tr><td style="background:#0f0f0f;border:1px solid #1e1e1e;border-top:none;padding:0 30px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>

  <!-- Gated sources -->
  <tr><td style="background:#0a0a0a;border:1px solid #1e1e1e;border-top:none;padding:20px 30px;">
    <p style="margin:0 0 10px;color:#3a3a3a;font-size:10px;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;">Also Check — Login Required Sources</p>
    <table width="100%" cellpadding="0" cellspacing="0">${gatedRows}</table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#080808;border:1px solid #1e1e1e;border-top:none;border-radius:0 0 12px 12px;padding:14px 30px;text-align:center;">
    <p style="margin:0;color:#2a2a2a;font-size:10px;letter-spacing:.5px;">M&amp;A Sourcing Agent &nbsp;·&nbsp; Real listings scraped daily &nbsp;·&nbsp; Powered by Claude</p>
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

  // 1. Scrape
  console.log("\n① Scraping live listings...");
  const scraped = await scrapeAllSources();
  console.log(`\n   Total: ${scraped.length} listings scraped`);

  // 2. Score in batches of 20
  console.log("\n② Scoring with Claude...");
  let scored = [];
  const BATCH = 20;
  for (let i = 0; i < scraped.length; i += BATCH) {
    const batch = scraped.slice(i, i + BATCH);
    console.log(`   Batch ${Math.floor(i/BATCH)+1}: ${batch.length} listings...`);
    try {
      const results = await scoreListings(batch);
      // Always restore the real scraped URLs — never trust Claude to keep them unchanged
      results.forEach((r, idx) => {
        r.listingUrl = batch[idx].listingUrl;
        r.name       = r.name || batch[idx].name;
        r.source     = batch[idx].source;
      });
      scored.push(...results);
    } catch (e) {
      console.log(`   Batch error: ${e.message} — using fallback scores`);
      batch.forEach(l => scored.push({
        ...l, score:50, tier:"MODERATE", sector:"Unknown", geography:"Unknown",
        revenue:"Not disclosed", ebitda:"Not disclosed", askingPrice:"Not disclosed",
        multiple:"Not disclosed", employees:"Not disclosed", founded:"Not disclosed",
        headline:"See listing for details.",
        whyFits:"Could not score automatically — review listing directly.",
        concerns:null, keyMetrics:"Not disclosed",
      }));
    }
    await sleep(800);
  }

  // 3. Sort, filter, cap at top 25
  const final = scored
    .sort((a, b) => b.score - a.score)
    .filter(l => l.score >= 40)
    .slice(0, 25);

  const strong = final.filter(l => l.score >= 75);
  console.log(`\n   Showing ${final.length} listings (${strong.length} strong matches)`);
  final.forEach(l => {
    const bar = "█".repeat(Math.round(l.score/10)) + "░".repeat(10-Math.round(l.score/10));
    console.log(`   ${bar} ${l.score}% — ${l.name.slice(0,60)} [${l.source}]`);
  });

  // 4. Email
  console.log("\n③ Generating & sending email...");
  const dateStr = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmailHtml(final, dateStr, scraped.length);
  await sendEmail(html, strong.length, final.length);

  console.log("\n✓ Done.\n");
}

main().catch(err => {
  console.error("\n✗ Agent failed:", err.message);
  process.exit(1);
});
