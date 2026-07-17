"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRetailerLandingUrl = getRetailerLandingUrl;
exports.buildRetailerWelcomeEmail = buildRetailerWelcomeEmail;
const functions = require("firebase-functions");
const BRAND = {
    teal: '#00A89C',
    navy: '#0D1B4D',
    lightTeal: '#E6F7F6',
};
const DEFAULT_RETAILER_LANDING_URL = 'https://simplipharmaapp.sanchet.in';
const SUPPORT_EMAIL = 'support.simplipharma@sanchet.in';
const SUPPORT_PHONE = '+91-8319801900';
const ONBOARDING_STEPS = [
    {
        file: 'banner-01-search-medicines.png',
        title: '1. Search medicines',
        caption: 'Browse and search the catalog to find the products you need.',
    },
    {
        file: 'banner-02-cart-place-order.png',
        title: '2. Add to cart & place order',
        caption: 'Review quantities, apply schemes, and submit your order in a few taps.',
    },
    {
        file: 'banner-03-pack-quality.png',
        title: '3. Quality packing',
        caption: 'Orders are picked and packed carefully before dispatch.',
    },
    {
        file: 'banner-04-delivery-manage.png',
        title: '4. Delivery & order tracking',
        caption: 'Track status, manage deliveries, and reorder with ease.',
    },
];
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** Public retailer web/app landing page; override via `app.retailer_landing_url`. */
function getRetailerLandingUrl() {
    const cfg = functions.config().app;
    const base = ((cfg === null || cfg === void 0 ? void 0 : cfg.retailer_landing_url) || DEFAULT_RETAILER_LANDING_URL).trim();
    return base.replace(/\/$/, '');
}
function buildRetailerWelcomeEmail(params) {
    var _a, _b, _c;
    const landingUrl = getRetailerLandingUrl();
    const email = escapeHtml(params.email);
    const password = escapeHtml(params.password);
    const shopName = (_a = params.shopName) === null || _a === void 0 ? void 0 : _a.trim();
    const storeCode = (_b = params.storeCode) === null || _b === void 0 ? void 0 : _b.trim();
    const intro = escapeHtml(params.intro);
    const subject = ((_c = params.subject) === null || _c === void 0 ? void 0 : _c.trim()) || 'Welcome to SimpliPharma — Your retailer account is ready';
    const storeLine = shopName
        ? `<p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Store:</strong> ${escapeHtml(shopName)}</p>`
        : '';
    const codeLine = storeCode
        ? `<p style="margin:0;color:#333;font-size:15px;"><strong>Store code:</strong> ${escapeHtml(storeCode)}</p>`
        : '';
    const stepBlocks = ONBOARDING_STEPS.map((step) => {
        const imgUrl = `${landingUrl}/banners/${step.file}`;
        return `
      <tr>
        <td style="padding:0 0 20px;">
          <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:${BRAND.navy};">${escapeHtml(step.title)}</p>
          <p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.5;">${escapeHtml(step.caption)}</p>
          <img src="${imgUrl}" alt="${escapeHtml(step.title)}" width="560" style="max-width:100%;height:auto;border-radius:8px;display:block;border:1px solid #e0e0e0;" />
        </td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#222;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:${BRAND.navy};padding:28px 32px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">SimpliPharma</p>
              <p style="margin:8px 0 0;font-size:14px;color:${BRAND.teal};">Smart medicine supply for retailers</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 12px;font-size:22px;color:${BRAND.navy};">Welcome to SimpliPharma</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">${intro}</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.lightTeal};border-left:4px solid ${BRAND.teal};border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:18px 20px;">
                    ${storeLine}
                    ${codeLine}
                    <p style="margin:${storeLine || codeLine ? '12px' : '0'} 0 8px;font-size:15px;color:#333;"><strong>Login email:</strong> ${email}</p>
                    <p style="margin:0;font-size:15px;color:#333;"><strong>Temporary password:</strong> <code style="background:#fff;padding:4px 10px;border-radius:4px;font-size:15px;border:1px solid #cce8e6;">${password}</code></p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:14px;color:#c62828;font-weight:600;">Please change your password after your first login.</p>

              <h2 style="margin:0 0 12px;font-size:18px;color:${BRAND.navy};">Access the app</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:16px;background:#f8f9fa;border-radius:8px;border:1px solid #e8e8e8;">
                    <p style="margin:0 0 10px;font-size:14px;color:#444;">Open SimpliPharma on the web or install the mobile app:</p>
                    <p style="margin:0 0 12px;">
                      <a href="${landingUrl}/" style="display:inline-block;background:${BRAND.teal};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:15px;">Open SimpliPharma</a>
                    </p>
                    <p style="margin:0;font-size:13px;color:#666;">
                      Web: <a href="${landingUrl}/" style="color:${BRAND.teal};">${landingUrl}/</a><br />
                      Android app: <strong>Coming soon</strong>
                    </p>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 16px;font-size:18px;color:${BRAND.navy};">How to use SimpliPharma</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${stepBlocks}
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;border-top:1px solid #eee;padding-top:20px;">
                <tr>
                  <td>
                    <p style="margin:0 0 6px;font-size:14px;color:#666;">Need help?</p>
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#444;">
                      Email: <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.teal};">${SUPPORT_EMAIL}</a><br />
                      Phone: <a href="tel:+918319801900" style="color:${BRAND.teal};">${SUPPORT_PHONE}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f0f2f5;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#888;">&copy; SimpliPharma. This email contains confidential login details — do not share it.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    const text = [
        'Welcome to SimpliPharma',
        '',
        params.intro,
        shopName ? `Store: ${shopName}` : '',
        storeCode ? `Store code: ${storeCode}` : '',
        `Login email: ${params.email}`,
        `Temporary password: ${params.password}`,
        '',
        'Please change your password after your first login.',
        '',
        `Open SimpliPharma: ${landingUrl}/`,
        'Android app: Coming soon',
        '',
        'How to use:',
        ...ONBOARDING_STEPS.map((s) => `- ${s.title}: ${s.caption}`),
        '',
        `Support: ${SUPPORT_EMAIL} | ${SUPPORT_PHONE}`,
    ]
        .filter(Boolean)
        .join('\n');
    return { subject, html, text };
}
//# sourceMappingURL=retailerWelcomeEmail.js.map