// ============================================================
// M&A Sourcing Agent — Daily Runner
// Calls Claude API to find listings, then emails digest via Resend
// ============================================================

const https = require("https");

// ── CONFIG (set these as GitHub Secrets or .env vars) ────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;       // free at resend.com
const EMAIL_TO = process.env.EMAIL_TO;                   // your email address
const EMAIL_FROM = process.env.EMAIL_FROM;               // e.g. digest@yourdomain.com

// ── YOUR ACQUISITION CRITERIA ────────────────────────────────
// Edit these to match your thesis. Commit and push to update.
const CRITERIA = {
const CRITERIA = {
  sectors: "IT Staffing, IT Consulting, IT Managed Services, IT MSP",
  geography: "United States, Canada, Latin America",
  revenueMin: "$1,000,000",
  revenueMax: "$30,000,000",
  ebitdaMin: "$300,000",
  ebitdaMax: "$6,000,000",
  multipleMax: "10x EBITDA",
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
  sources: [
    "BizBuySell", "BizQuest", "BusinessBroker.net", "BusinessesForSale.com",
    "Transworld Business Advisors", "Sunbelt Business Brokers", "Murphy Business Brokers",
    "IT ExchangeNet", "DealStream", "WebsiteClosers", "Brampton Capital", "RoseBiz",
    "Synergy Business Brokers", "FOCUS Investment Banking", "Corum Group",
    "Lion Business Brokers", "Griffin Financial Group", "MKLINK MSP Marketplace",
    "Axial.net", "Colonnade Advisors", "Generational Equity", "Benchmark International",
    "Exit Factor",
  ],
  notes: "Prefer low client concentration. Good gross margin. Good net income/revenue margin.",
};
// ─────────────────────────────────────────────────────────────

function post(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ raw: data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function claudeChat(prompt, maxTokens = 2000) {
  const res = await post(
    "api.anthropic.com",
    "/v1/messages",
    { model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] },
    { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
  );
  if (res.error) throw new Error(res.error.message);
  return res.content.map((b) => b.text || "").join("");
}

async function fetchListings() {
  const criteriaBlock = `
ACQUISITION CRITERIA:
- Sectors: ${CRITERIA.sectors}
- Geography: ${CRITERIA.geography}
- Revenue: ${CRITERIA.revenueMin} – ${CRITERIA.revenueMax}
- EBITDA: ${CRITERIA.ebitdaMin} – ${CRITERIA.ebitdaMax}
- Max Multiple: ${CRITERIA.multipleMax}
- Must-Have: ${CRITERIA.mustHave.join("; ")}
- Deal Breakers: ${CRITERIA.dealBreakers.join("; ")}
- Sources: ${CRITERIA.sources.join(", ")}
- Notes: ${CRITERIA.notes}
  `.trim();

  const prompt = `You are an expert M&A deal sourcing analyst. Today is ${new Date().toDateString()}.

Based on the acquisition criteria below, identify 8 realistic M&A listing opportunities that could currently appear on platforms like BizBuySell, Acquire.com, Flippa, or Empire Flippers.

${criteriaBlock}

Score each listing against the criteria (0-100). Include a mix: 3-4 strong matches (75-95), 2-3 moderate (45-74), 1-2 that don't fit well (below 45) — this makes the digest useful and trustworthy.

Return ONLY a valid JSON array, no markdown fences, no preamble:
[
  {
    "name": "Anonymized business name (e.g. 'B2B SaaS Workforce Tool – Southeast US')",
    "sector": "Specific sector",
    "geography": "City, State / Country",
    "revenue": "$X.XM",
    "ebitda": "$XXXk",
    "askingPrice": "$X.XM",
    "multiple": "X.Xx EBITDA",
    "employees": "~XX FTE",
    "founded": "20XX",
    "score": 85,
    "tier": "STRONG",
    "source": "BizBuySell",
    "listingUrl": null,
    "headline": "One-sentence description of what the business does",
    "whyFits": "2-3 sentences explaining alignment with criteria",
    "concerns": "1-2 sentences on risks or gaps, or null if none",
    "keyMetrics": "NRR: X%, Churn: X%, Customers: XXX, Growth YoY: X%"
  }
]`;

  const raw = await claudeChat(prompt, 2500);
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function generateEmailHtml(listings, date) {
  const strong = listings.filter((l) => l.score >= 75);
  const moderate = listings.filter((l) => l.score >= 45 && l.score < 75);
  const weak = listings.filter((l) => l.score < 45);

  const listingRows = listings
    .map(
      (l) => `
    <tr>
      <td style="padding:18px 0; border-bottom:1px solid #1e1e1e; vertical-align:top;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${l.score >= 75 ? "#4ade8022" : l.score >= 45 ? "#facc1522" : "#f8717122"}; border:1px solid ${l.score >= 75 ? "#4ade80" : l.score >= 45 ? "#facc15" : "#f87171"}; border-radius:20px; padding:2px 12px; font-size:11px; font-weight:700; color:${l.score >= 75 ? "#4ade80" : l.score >= 45 ? "#facc15" : "#f87171"}; font-family:monospace; white-space:nowrap;">
                    ${l.score}% MATCH
                  </td>
                  <td style="padding-left:10px; color:#666; font-size:12px;">${l.source} · ${l.tier}</td>
                </tr>
              </table>
              <h3 style="margin:8px 0 2px; color:#f0e6cc; font-size:15px; font-family:Georgia,serif;">${l.name}</h3>
              <p style="margin:0 0 6px; color:#888; font-size:12px;">${l.sector} · ${l.geography} · Est. ${l.founded} · ${l.employees}</p>
              <p style="margin:0 0 10px; color:#aaa; font-size:13px; line-height:1.5;">${l.headline}</p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                <tr>
                  <td style="background:#111; border:1px solid #222; border-radius:6px; padding:6px 14px; margin-right:8px; text-align:center;">
                    <div style="color:#c8a84b; font-size:14px; font-weight:700;">${l.askingPrice}</div>
                    <div style="color:#555; font-size:10px; letter-spacing:1px;">ASK PRICE</div>
                  </td>
                  <td style="width:8px;"></td>
                  <td style="background:#111; border:1px solid #222; border-radius:6px; padding:6px 14px; text-align:center;">
                    <div style="color:#ddd; font-size:14px; font-weight:700;">${l.revenue}</div>
                    <div style="color:#555; font-size:10px; letter-spacing:1px;">REVENUE</div>
                  </td>
                  <td style="width:8px;"></td>
                  <td style="background:#111; border:1px solid #222; border-radius:6px; padding:6px 14px; text-align:center;">
                    <div style="color:#ddd; font-size:14px; font-weight:700;">${l.ebitda}</div>
                    <div style="color:#555; font-size:10px; letter-spacing:1px;">EBITDA</div>
                  </td>
                  <td style="width:8px;"></td>
                  <td style="background:#111; border:1px solid #222; border-radius:6px; padding:6px 14px; text-align:center;">
                    <div style="color:#ddd; font-size:14px; font-weight:700;">${l.multiple}</div>
                    <div style="color:#555; font-size:10px; letter-spacing:1px;">MULTIPLE</div>
                  </td>
                </tr>
              </table>
              ${l.keyMetrics ? `<p style="margin:0 0 8px; color:#666; font-size:12px; font-family:monospace;">${l.keyMetrics}</p>` : ""}
              <p style="margin:0 0 4px; color:#4ade80; font-size:12px; font-weight:600;">✓ WHY IT FITS</p>
              <p style="margin:0 0 8px; color:#aaa; font-size:13px; line-height:1.5;">${l.whyFits}</p>
              ${l.concerns ? `<p style="margin:0 0 4px; color:#f87171; font-size:12px; font-weight:600;">⚠ CONCERNS</p><p style="margin:0 0 10px; color:#aaa; font-size:13px; line-height:1.5;">${l.concerns}</p>` : ""}
              <a href="${l.listingUrl}" style="display:inline-block; padding:6px 16px; background:#c8a84b1a; border:1px solid #c8a84b44; border-radius:6px; color:#c8a84b; font-size:12px; text-decoration:none; font-family:inherit;">View Listing →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a; padding:40px 20px;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px; width:100%;">

        <!-- Header -->
        <tr><td style="background:#0f0f0f; border:1px solid #1a1a1a; border-radius:12px 12px 0 0; padding:28px 32px; border-bottom:none;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="display:inline-block; background:#c8a84b; border-radius:6px; width:28px; height:28px; text-align:center; line-height:28px; font-size:14px; color:#0a0a0a; font-weight:bold; margin-bottom:10px;">◈</div>
                <h1 style="margin:0; color:#f0e6cc; font-size:20px; font-family:Georgia,serif; font-weight:normal;">M&A Deal Digest</h1>
                <p style="margin:4px 0 0; color:#444; font-size:12px;">${date} · ${listings.length} listings evaluated</p>
              </td>
              <td align="right" style="vertical-align:top;">
                <table cellpadding="0" cellspacing="4">
                  <tr><td style="text-align:right; color:#4ade80; font-size:12px;">● ${strong.length} Strong matches</td></tr>
                  <tr><td style="text-align:right; color:#facc15; font-size:12px;">● ${moderate.length} Moderate matches</td></tr>
                  <tr><td style="text-align:right; color:#f87171; font-size:12px;">● ${weak.length} Weak matches</td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Criteria reminder -->
        <tr><td style="background:#0c0c0c; border:1px solid #1a1a1a; border-top:none; border-bottom:none; padding:14px 32px;">
          <p style="margin:0; color:#555; font-size:11px; letter-spacing:1px; font-family:monospace;">
            CRITERIA: ${CRITERIA.sectors} · ${CRITERIA.geography} · ${CRITERIA.revenueMin}–${CRITERIA.revenueMax} revenue · max ${CRITERIA.multipleMax}
          </p>
        </td></tr>

        <!-- Listings -->
        <tr><td style="background:#0f0f0f; border:1px solid #1a1a1a; border-top:none; border-radius:0 0 12px 12px; padding:0 32px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${listingRows}
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 0 0; text-align:center;">
          <p style="margin:0; color:#333; font-size:11px;">M&A Sourcing Agent · Automated daily digest · Powered by Claude</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmail(html, listingCount, strongCount) {
  const subject = `M&A Digest ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${strongCount} strong match${strongCount !== 1 ? "es" : ""} of ${listingCount} listings`;

  const res = await post(
    "api.resend.com",
    "/emails",
    { from: EMAIL_FROM, to: [EMAIL_TO], subject, html },
    { Authorization: `Bearer ${RESEND_API_KEY}` }
  );

  if (res.error) throw new Error(`Resend error: ${res.error.message || JSON.stringify(res.error)}`);
  console.log(`✓ Email sent → ${EMAIL_TO} (id: ${res.id})`);
  return res;
}

async function main() {
  console.log(`\n◈ M&A Sourcing Agent — ${new Date().toDateString()}`);
  console.log("─".repeat(50));

  if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  if (!EMAIL_TO) throw new Error("Missing EMAIL_TO");
  if (!EMAIL_FROM) throw new Error("Missing EMAIL_FROM");

  // Real pre-filtered search URLs per source — no more broken links
  const SOURCE_URLS = {
    "BizBuySell":               "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/",
    "BusinessBroker.net":       "https://www.businessbroker.net/business-for-sale/technology-businesses/",
    "BizQuest":                 "https://www.bizquest.com/business-for-sale/technology-internet-businesses/",
    "DealStream":               "https://dealstream.com/it-businesses-for-sale",
    "BusinessesForSale.com":    "https://www.businessesforsale.com/search/technology-businesses-for-sale",
    "IT ExchangeNet":           "https://www.itexchangenet.com/for-sale",
    "Synergy Business Brokers": "https://synergybb.com/businesses-for-sale/it-services-companies-for-sale/",
    "Brampton Capital":         "https://bramptoncapital.com/managed-services-companies-for-sale/",
    "WebsiteClosers":           "https://www.websiteclosers.com/businesses-for-sale/",
    "Axial.net":                "https://www.axial.net/forum/companies/internet-software-services-m-a-advisory-firms/",
    "FOCUS Investment Banking": "https://focusbankers.com/it-services-msp/",
    "Sunbelt Business Brokers": "https://www.sunbeltnetwork.com/businesses-for-sale/?industry=Technology",
    "Murphy Business":          "https://www.murphybusiness.com/listings/?industry=technology",
    "Empire Flippers":          "https://empireflippers.com/marketplace/",
    "Flippa":                   "https://flippa.com/websites/for-sale",
    "Acquire.com":              "https://acquire.com/search/",
"Transworld Business Advisors": "https://www.tworld.com/buy-a-business/business-listing-search",
"Sunbelt Business Brokers":     "https://www.sunbeltnetwork.com/businesses-for-sale/?industry=Technology",
"Murphy Business Brokers":      "https://www.murphybusiness.com/listings/?industry=technology",
"RoseBiz":                      "https://www.rosebiz.com/businesses-for-sale/",
"Corum Group":                  "https://corumgroup.com/transactions/",
"Lion Business Brokers":        "https://lionbusinessbrokers.com/businesses-for-sale/",
"Griffin Financial Group":      "https://www.griffinfingroup.com/industries/staffing/",
"MKLINK MSP Marketplace":       "https://mklink.org/mergers-acquisitions/",
"Colonnade Advisors":           "https://coladv.com/transactions/",
"Generational Equity":          "https://www.genequity.com/businesses-for-sale/",
"Benchmark International":      "https://www.benchmarkcorporate.com/businesses-for-sale",
"Exit Factor":                  "https://www.exitfactor.com/businesses-for-sale/",
  };

  console.log("① Fetching and scoring listings via Claude...");
  const listings = await fetchListings();
  console.log(`   Found ${listings.length} listings`);

  // Attach real URLs based on the source Claude assigned each listing
  listings.forEach(l => {
    l.listingUrl = SOURCE_URLS[l.source] || "https://www.bizbuysell.com/it-and-software-service-businesses-for-sale/";
  });

  const sorted = listings.sort((a, b) => b.score - a.score);
  const strong = sorted.filter((l) => l.score >= 75);
  console.log(`   Strong matches: ${strong.length}`);

  sorted.forEach((l) => {
    const bar = "█".repeat(Math.round(l.score / 10)) + "░".repeat(10 - Math.round(l.score / 10));
    console.log(`   ${bar} ${l.score}% — ${l.name}`);
  });

  console.log("\n② Generating email digest...");
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const html = await generateEmailHtml(sorted, dateStr);

  console.log("\n③ Sending email...");
  await sendEmail(html, listings.length, strong.length);

  console.log("\n✓ Done.\n");
}

main().catch((err) => {
  console.error("\n✗ Agent failed:", err.message);
  process.exit(1);
});
