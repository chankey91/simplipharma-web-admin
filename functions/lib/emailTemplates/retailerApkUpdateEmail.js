"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRetailerApkUpdateEmail = buildRetailerApkUpdateEmail;
const BRAND = {
    teal: '#00A89C',
    navy: '#0D1B4D',
    lightTeal: '#E6F7F6',
};
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function buildRetailerApkUpdateEmail(params) {
    var _a;
    const version = escapeHtml(params.versionName || 'latest');
    const url = escapeHtml(params.downloadUrl);
    const notes = (params.notes || '').trim();
    const shop = (_a = params.shopName) === null || _a === void 0 ? void 0 : _a.trim();
    const subject = `SimpliPharma Android app update (v${params.versionName || 'new'})`;
    const notesHtml = notes
        ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">${escapeHtml(notes).replace(/\n/g, '<br />')}</p>`
        : '';
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
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:${BRAND.navy};padding:20px 32px;">
              <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">SimpliPharma</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.navy};">New Android app version</h1>
              ${shop ? `<p style="margin:0 0 12px;font-size:15px;color:#444;">Hello ${escapeHtml(shop)},</p>` : ''}
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
                Please install the latest SimpliPharma retailer app <strong>v${version}</strong> on your Android phone.
              </p>
              ${notesHtml}
              <p style="margin:0 0 16px;">
                <a href="${url}" style="display:inline-block;background:${BRAND.teal};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:15px;">Download APK (v${version})</a>
              </p>
              <p style="margin:0;font-size:13px;color:#666;word-break:break-all;">
                Or open this link in Chrome: <a href="${url}" style="color:${BRAND.teal};">${url}</a>
              </p>
              <p style="margin:16px 0 0;font-size:13px;color:#888;">
                If Android asks you to allow installs from this source, turn that on for Chrome, then tap the file to install.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    const text = [
        'SimpliPharma Android app update',
        shop ? `Hello ${shop},` : '',
        `Please install v${params.versionName || 'latest'}.`,
        notes,
        `Download: ${params.downloadUrl}`,
    ]
        .filter(Boolean)
        .join('\n');
    return { subject, html, text };
}
//# sourceMappingURL=retailerApkUpdateEmail.js.map