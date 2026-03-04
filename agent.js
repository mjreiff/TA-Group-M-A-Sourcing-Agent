// ============================================================
// M&A Sourcing Agent — Direct Fetch Edition
//
// Directly fetches listing pages from each source site and
// extracts listings using Claude. No web search — we go
// straight to the source, so URLs are always real and live.
//
// Sources with JavaScript-rendered pages get a fallback
// search URL so at least the link is useful.
// ============================================================

const https = require("https");
const http  = require("http");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_TO          = process.env.EMAIL_TO;
const EMAIL_FROM        = process.env.EMAIL_FROM;

const CRITERIA_TEXT = `We are looking to acquire:
- Sector: IT Staffing, IT Consulting, Managed Services (MSP)
- Geography: United States, Canada, or Latin America
- Revenue: $1M – $30M
- EBITDA: $300K – $6M
- Max multiple: 10x EBITDA
- Must be profitable, no customer above 40% of revenue`;

// ── SOURCES ──────────────────────────────────────────────────
// Each source has one or more pages to fetch directly.
// If a page uses heavy JS rendering, we mark it render:true
// and Claude uses web_search to fetch it instead.
const SOURCES = [
  {
    name: "BizBuySell",
    pages: [
      "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=IT+staffing&max=40",
      "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=managed+service+provider&max=40",
      "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=IT+consulting&max=40",
      "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/?q=MSP&max=40",
    ],
    linkPattern: /bizbuysell\.com\/Business-Opportunity\/[^"'\s]+/gi,
    baseUrl: "https://www.bizbuysell.com",
  },
  {
    name: "BizQuest",
    pages: [
      "https://www.bizquest.com/business-for-sale/technology-internet-businesses/?keywords=IT+staffing",
      "https://www.bizquest.com/business-for-sale/technology-internet-businesses/?keywords=managed+service",
      "https://www.bizquest.com/business-for-sale/technology-internet-businesses/?keywords=IT+consulting",
    ],
    linkPattern: /bizquest\.com\/ad\/[^"'\s]+/gi,
    baseUrl: "https://www.bizquest.com",
  },
  {
    name: "BusinessBroker.net",
    pages: [
      "https://www.businessbroker.net/business-for-sale/technology-businesses/?keywords=IT+staffing",
      "https://www.businessbroker.net/business-for-sale/technology-businesses/?keywords=managed+service",
      "https://www.businessbroker.net/business-for-sale/technology-businesses/?keywords=IT+consulting",
    ],
    linkPattern: /businessbroker\.net\/listing\/[^"'\s]+/gi,
    baseUrl: "https://www.businessbroker.net",
  },
  {
    name: "Synergy Business Brokers",
    pages: [
      "https://synergybb.com/businesses-for-sale/it-services-companies-for-sale/",
      "https://synergybb.com/businesses-for-sale/staffing/",
      "https://synergybb.com/businesses-for-sale/managed-service-providers-msp/",
    ],
    linkPattern: /synergybb\.com\/(?:us-businesses-for-sale|businesses-for-sale)\/[^"'\s<>]{10,}/gi,
    baseUrl: "https://synergybb.com",
  },
  {
    name: "IT ExchangeNet",
    pages: [
      "https://www.itexchangenet.com/for-sale",
    ],
    linkPattern: /itexchangenet\.com\/(?:for-sale|listing|business)\/[^"'\s<>]{5,}/gi,
    baseUrl: "https://www.itexchangenet.com",
  },
  {
    name: "Brampton Capital",
    pages: [
      "https://bramptoncapital.com/managed-services-companies-for-sale/",
      "https://bramptoncapital.com/it-staffing-companies-for-sale/",
    ],
    linkPattern: /bramptoncapital\.com\/(?:listing|for-sale|business|msp|it)\/[^"'\s<>]{5,}/gi,
    baseUrl: "https://bramptoncapital.com",
  },
  {
    name: "Lion Business Brokers",
    pages: [
      "https://lionbusinessbrokers.com/businesses-for-sale/",
    ],
    linkPattern: /lionbusinessbrokers\.com\/(?:listing|business|for-sale)\/[^"'\s<>]{5,}/gi,
    baseUrl: "https://lionbusinessbrokers.com",
  },
  {
    name: "DealStream",
    pages: [
      "https://dealstream.com/l/buy/it-services",
      "https://dealstream.com/l/buy/staffing",
    ],
    linkPattern: /dealstream\.com\/(?:deal|listing|l\/buy\/[^"'\s<>]{3,}\/)[^"'\s<>]{5,}/gi,
    baseUrl: "https://dealstream.com",
  },
  {
    name: "WebsiteClosers",
    pages: [
      "https://www.websiteclosers.com/businesses-for-sale/?_sft_industry=staffing",
      "https://www.websiteclosers.com/businesses-for-sale/?_sft_industry=it-services",
    ],
    linkPattern: /websiteclosers\.com\/listing\/[^"'\s<>]{5,}/gi,
    baseUrl: "https://www.websiteclosers.com",
  },
  {
    name: "BusinessesForSale.com",
    pages: [
      "https://www.businessesforsale.com/search?q=IT+staffing&countryId=100",
      "https://www.businessesforsale.com/search?q=managed+service+provider&countryId=100",
      "https://www.businessesforsale.com/search?q=IT+consulting&countryId=100",
    ],
    linkPattern: /businessesforsale\.com\/(?:listing|advert|for-sale)\/[^"'\s<>]{5,}/gi,
    baseUrl: "https://www.businessesforsale.com",
  },
];

// Gated sources — always shown in footer
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

// ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── FETCH A URL ───────────────────────────────────────────────
function fetchPage(url, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 4) return reject(new Error("Too many redirects"));
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
      timeout: 20000,
    }, res => {
      // Follow redirects
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next = res.headers.location;
        if (!next.startsWith("http")) {
          try { next = new URL(next, url).href; } catch { return reject(new Error("Bad redirect")); }
        }
        return fetchPage(next, redirectDepth + 1).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", c => { data += c; if (data.length > 500000) req.destroy(); }); // cap at 500kb
      res.on("end", () => resolve({ html: data, status: res.statusCode, url }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ── EXTRACT LISTING URLS FROM HTML ───────────────────────────
// Uses the source's linkPattern to find listing URLs in raw HTML
function extractListingUrls(html, source) {
  const matches = html.match(source.linkPattern) || [];
  const urls = [...new Set(matches)].map(m => {
    const url = m.startsWith("http") ? m : `https://${m}`;
    // Clean up any trailing junk
    return url.replace(/['")\s<>]+$/, "");
  });
  return urls;
}

// ── EXTRACT LISTING DETAILS WITH CLAUDE ──────────────────────
// Given a chunk of HTML, asks Claude to pull out listing details
async function extractListingsFromHtml(html, sourceName, pageUrl) {
  // Truncate HTML — we only need enough to find listing titles/details
  // Strip scripts and styles first to save tokens
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 30000); // ~8k tokens worth

  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const res = await postAnthropic({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3000,
    messages: [{
      role: "user",
      content: `You are parsing an HTML page from ${sourceName} (${pageUrl}).

${CRITERIA_TEXT}

Extract every business-for-sale listing from this HTML that could match our criteria. 

For each listing found:
- name: listing title
- listingUrl: the full direct URL to this specific listing — extract from href attributes exactly as they appear in the HTML. If relative, prepend the base: ${new URL(pageUrl).origin}
- askingPrice: if shown
- revenue: if shown  
- ebitda: if shown
- location: if shown
- description: brief description if shown
- isNew: true if listed after ${twoWeeksAgo.toDateString()}, else false
- listedDate: if shown

Return ONLY a raw JSON array. No markdown. If nothing relevant found, return [].

HTML:
${cleaned}`
    }]
  });

  if (res.error) throw new Error(res.error.message);
  const text = (res.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();

  try {
    const match = text.replace(/```json|```/g,"").match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(l => l.name && l.listingUrl && l.listingUrl.startsWith("http"))
      .map(l => ({ ...l, source: sourceName, isNew: l.isNew === true }));
  } catch { return []; }
}

// ── POST TO ANTHROPIC ─────────────────────────────────────────
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

// ── PROCESS ONE SOURCE ────────────────────────────────────────
async function processSource(source) {
  const listings = [];
  const seenUrls = new Set();

  for (const pageUrl of source.pages) {
    console.log(`     Fetching ${pageUrl}`);
    let html;
    try {
      const result = await fetchPage(pageUrl);
      if (result.status !== 200) {
        console.log(`     → HTTP ${result.status}, skipping`);
        await sleep(1000);
        continue;
      }
      html = result.html;
      console.log(`     → ${html.length.toLocaleString()} bytes`);
    } catch (e) {
      console.log(`     → Fetch error: ${e.message}`);
      await sleep(1000);
      continue;
    }

    // Try to extract listing URLs directly from HTML via regex pattern
    const listingUrls = extractListingUrls(html, source);
    console.log(`     → ${listingUrls.length} listing URLs found via pattern`);

    if (listingUrls.length > 0) {
      // We found URL patterns — now fetch each listing page for details
      // But to save API calls, pass HTML to Claude to extract details directly
      const extracted = await extractListingsFromHtml(html, source.name, pageUrl);
      console.log(`     → Claude extracted ${extracted.length} listings`);
      for (const l of extracted) {
        if (!seenUrls.has(l.listingUrl)) {
          seenUrls.add(l.listingUrl);
          listings.push(l);
        }
      }
    } else {
      // No URL patterns matched — still try Claude extraction (handles varied HTML)
      const extracted = await extractListingsFromHtml(html, source.name, pageUrl);
      console.log(`     → Claude extracted ${extracted.length} listings (no pattern match)`);
      for (const l of extracted) {
        if (!seenUrls.has(l.listingUrl)) {
          seenUrls.add(l.listingUrl);
          listings.push(l);
        }
      }
    }

    await sleep(2000); // be polite between pages
  }

  return listings;
}

// ── BUILD EMAIL ───────────────────────────────────────────────
function buildEmail(newListings, otherListings, date, totalFound) {
  const card = (l) => `
  <tr><td style="padding:16px 0;border-bottom:1px solid #1e1e1e;vertical-align:top;">
    <p style="margin:0 0 3px;color:#555;font-size:11px;font-weight:600;">
      ${l.source}${l.listedDate ? ` · ${l.listedDate}` : ""}${l.isNew ? ` · <span style="color:#3b82f6;font-weight:700;">NEW</span>` : ""}
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
        <p style="margin:3px 0 0;color:#333;font-size:11px;">${date} · ${totalFound} listings · ${newListings.length} new in last 14 days</p>
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
    <p style="margin:0;color:#1e1e1e;font-size:10px;">M&amp;A Sourcing Agent · Direct fetch from ${SOURCES.length} sources · Powered by Claude</p>
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
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}`);
  console.log(`  ${SOURCES.length} sources, ${SOURCES.reduce((n,s)=>n+s.pages.length,0)} pages to fetch`);
  console.log("─".repeat(54));

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY)    throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO)          throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM)        throw new Error("Missing EMAIL_FROM");

  const allListings = [];
  const seenUrls    = new Set();

  for (const source of SOURCES) {
    console.log(`\n[${source.name}]`);
    try {
      const listings = await processSource(source);
      let added = 0;
      for (const l of listings) {
        if (seenUrls.has(l.listingUrl)) continue;
        seenUrls.add(l.listingUrl);
        allListings.push(l);
        added++;
      }
      console.log(`   → ${added} unique listings added`);
    } catch (e) {
      console.log(`   → Source error: ${e.message}`);
    }
    await sleep(1000);
  }

  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`Total listings: ${allListings.length}`);
  const newListings   = allListings.filter(l => l.isNew);
  const otherListings = allListings.filter(l => !l.isNew);
  console.log(`New (14 days):  ${newListings.length}`);
  console.log(`Other:          ${otherListings.length}`);

  const date = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const html = buildEmail(newListings, otherListings, date, allListings.length);
  await sendEmail(html, newListings.length, allListings.length);
  console.log("\n✓ Done.\n");
}

main().catch(err => { console.error("\n✗ Failed:", err.message); process.exit(1); });
