export const GST_INVOICE_STYLES = `
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.15;
    background: #fff;
  }
  .invoice-box {
    width: 100%;
    max-width: 1000px;
    margin: auto;
    border: none;
    padding: 2px;
    box-sizing: border-box;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    margin: 0;
    border: none;
  }
  td, th {
    border: none;
    border-right: 1px solid #000;
    border-bottom: 1px solid #000;
    padding: 2px 4px;
    vertical-align: top;
    word-wrap: break-word;
  }
  tr > *:first-child {
    border-left: 1px solid #000;
  }
  .invoice-box > table:first-child tr:first-child > *,
  .invoice-box [data-invoice-section="header"] table:first-of-type tr:first-child > * {
    border-top: 1px solid #000;
  }
  .ellipsis-cell {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .items-table td,
  .items-table th {
    padding: 3px 3px;
    line-height: 1.25;
    vertical-align: middle;
  }
  .items-table thead th {
    white-space: nowrap;
    font-size: 10px;
    padding: 3px 2px;
    font-weight: bold;
  }
  .items-table td.col-batch {
    white-space: normal;
    overflow: visible;
    word-break: break-word;
    line-height: 1.25;
  }
  .nowrap-cell {
    white-space: nowrap;
  }
  .items-table .col-left {
    text-align: left;
  }
  .items-table .col-center {
    text-align: center;
  }
  .items-table .col-right {
    text-align: right;
  }
  .totals-panel {
    padding: 2px 3px;
    vertical-align: top;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 1px 0;
    white-space: nowrap;
  }
  .totals-row.grand-total {
    border-top: 1px solid #000;
    margin-top: 2px;
    padding-top: 3px;
    font-weight: bold;
  }
  .totals-row.amount-due {
    font-weight: bold;
  }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: bold; }
  .title-cell { padding: 2px 3px; vertical-align: middle; }
  .title-cell .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title-cell .title {
    font-size: 16px;
    font-weight: bold;
    text-align: left;
  }
  .title-cell .title-licenses {
    text-align: right;
    font-size: 11px;
    font-weight: normal;
    line-height: 1.2;
    white-space: nowrap;
  }
  .title  { font-size: 16px; font-weight: bold; text-align: center; }
  .line-rejected td {
    text-decoration: line-through;
    color: #666;
  }
  .invoice-header,
  .invoice-items,
  .invoice-footer {
    width: 100%;
    flex: 0 0 auto;
  }
  .invoice-spacer {
    flex: 1 1 auto;
    min-height: 4px;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
  }
  .invoice-footer table:first-of-type tr:first-child > * {
    border-top: 1px solid #000;
  }
  .footer-terms { font-size: 10px; line-height: 1.2; }
  .signatory { vertical-align: bottom; }
  .pay-qr { text-align: center; vertical-align: top; }
  .pay-qr img { width: 70px; height: 70px; display: block; margin: 0 auto 2px; }
  .pay-qr .pay-qr-label { font-size: 9px; font-weight: bold; }
  @media print {
    body { margin: 0; }
  }
`;

/** Clean product name for printed GST invoices (scheme tags, trailing pack suffixes). */
export function formatInvoiceProductName(name: string): string {
  return name
    .replace(/\s*\[Sch\s+\d+\+\d+\]/gi, '')
    .replace(
      /\s*\(\d+\s*(?:TAB|TABLET|TABLETS|CAP|CAPS|CAPSULE|CAPSULES|TABS?)\b[^)]*\)\s*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildGstCompanyLicenseHtml(dl: string, gstin: string): string {
  return `<b>D.L. No:</b> ${dl}<br>
      <b>GSTIN:</b> ${gstin}`;
}

/** Title cell with heading on the left and D.L. No + GSTIN on the right. */
export function buildGstInvoiceTitleCell(title: string, dl: string, gstin: string): string {
  return `
    <td colspan="2" class="title-cell">
      <div class="title-row">
        <div class="title">${title}</div>
        <div class="title-licenses">${buildGstCompanyLicenseHtml(dl, gstin)}</div>
      </div>
    </td>`;
}

export function formatInvoiceLineGst(gstRatePercent: number): string {
  return `${gstRatePercent.toFixed(1)}%`;
}

export type GstInvoiceLineItem = {
  sn: number;
  name: string;
  pack: string;
  hsn: string;
  batch: string;
  exp: string;
  qty: string;
  free: string;
  totalQty: string;
  mrp: string;
  rate: string;
  disc: string;
  gst: string;
  amount: string;
  rowClass?: string;
};

export type GstInvoiceSummary = {
  subTotal: string;
  discount: string;
  sgst: string;
  cgst: string;
  roundOff: string;
  grandTotal: string;
  amountInWords: string;
  /** Whole-invoice extra discount in rupees (purchase payable). */
  additionalDiscount?: string;
  /** Wallet (credit notes) applied as payment — GST grand total is unchanged. */
  walletApplied?: string;
  /** Credit-note numbers consumed for the wallet amount, shown under tax summary. */
  walletRefs?: string;
  amountDue?: string;
};

export function buildGstInvoiceItemsHtml(items: GstInvoiceLineItem[]): string {
  return items
    .map(
      (item) => `
    <tr class="${item.rowClass || ''}">
      <td class="col-center">${item.sn}</td>
      <td class="col-left">${item.name}</td>
      <td class="col-center ellipsis-cell">${item.pack}</td>
      <td class="col-center">${item.hsn}</td>
      <td class="col-center col-batch">${item.batch}</td>
      <td class="col-center">${item.exp}</td>
      <td class="col-center nowrap-cell">${item.qty}</td>
      <td class="col-center nowrap-cell">${item.free}</td>
      <td class="col-center nowrap-cell">${item.totalQty}</td>
      <td class="col-center">${item.mrp}</td>
      <td class="col-center">${item.rate}</td>
      <td class="col-center">${item.disc}</td>
      <td class="col-center nowrap-cell">${item.gst}</td>
      <td class="col-right">${item.amount}</td>
    </tr>`
    )
    .join('');
}

export function buildGstInvoiceItemTableHtml(items: GstInvoiceLineItem[]): string {
  return `
<table class="items-table">
  <thead>
    <tr>
      <th class="col-center" style="width:3%">SN</th>
      <th class="col-left" style="width:24%">PRODUCT NAME</th>
      <th class="col-center" style="width:6%">PACK</th>
      <th class="col-center" style="width:6%">HSN</th>
      <th class="col-center" style="width:9%">BATCH</th>
      <th class="col-center" style="width:5%">EXP</th>
      <th class="col-center" style="width:4%">QTY</th>
      <th class="col-center" style="width:5%">FREE</th>
      <th class="col-center" style="width:4%">TQT</th>
      <th class="col-center" style="width:6%">MRP</th>
      <th class="col-center" style="width:6%">RATE</th>
      <th class="col-center" style="width:4%">DISC</th>
      <th class="col-center" style="width:6%">GST</th>
      <th class="col-right" style="width:7%">AMOUNT</th>
    </tr>
  </thead>
  <tbody>
    ${buildGstInvoiceItemsHtml(items)}
  </tbody>
</table>`;
}

export function parseInvoiceLineGstPercent(gst: string): number {
  const n = parseFloat(String(gst || '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
}

export function summarizeGstInvoicePageItems(items: GstInvoiceLineItem[]): {
  subTotal: number;
  discount: number;
  gst: number;
  cgst: number;
  sgst: number;
  pageTotal: number;
  byRate: Map<number, { taxable: number; gst: number }>;
} {
  const byRate = new Map<number, { taxable: number; gst: number }>();
  let subTotal = 0;
  let discount = 0;
  let gst = 0;
  for (const item of items) {
    const amount = parseFloat(item.amount) || 0;
    const discPct = parseFloat(item.disc) || 0;
    const gstPct = parseInvoiceLineGstPercent(item.gst);
    const discAmt = amount * discPct / 100;
    const taxable = Math.max(0, amount - discAmt);
    const gstAmt = taxable * gstPct / 100;
    subTotal += amount;
    discount += discAmt;
    gst += gstAmt;
    const bucket = byRate.get(gstPct) || { taxable: 0, gst: 0 };
    bucket.taxable += taxable;
    bucket.gst += gstAmt;
    byRate.set(gstPct, bucket);
  }
  return {
    subTotal,
    discount,
    gst,
    cgst: gst / 2,
    sgst: gst / 2,
    pageTotal: subTotal - discount + gst,
    byRate,
  };
}

function formatPageTaxSummary(page: ReturnType<typeof summarizeGstInvoicePageItems>): string {
  const rates = [...page.byRate.keys()].sort((a, b) => a - b);
  if (rates.length === 0) {
    return 'Amt: 0.00 | CGST: 0.00 | SGST: 0.00';
  }
  return rates
    .map((rate) => {
      const bucket = page.byRate.get(rate)!;
      const half = rate / 2;
      return `Amt ${rate.toFixed(0)}%: ${bucket.taxable.toFixed(2)} | CGST ${half.toFixed(1)}%: ${(bucket.gst / 2).toFixed(2)} | SGST ${half.toFixed(1)}%: ${(bucket.gst / 2).toFixed(2)}`;
    })
    .join('<br>');
}

export function buildGstInvoicePageTotalsSection(opts: {
  pageItems: GstInvoiceLineItem[];
  carriedForward: number;
  isLast: boolean;
  pageCount?: number;
  lastSummary?: GstInvoiceSummary;
  lastTax?: { taxable: string; cgst: string; sgst: string; igst?: string; rate: string; summaryAmt?: string };
  gstRateHalf: number;
}): string {
  if (opts.isLast && opts.lastSummary) {
    return buildGstInvoiceTotalsSection(
      opts.lastTax || {
        taxable: opts.lastSummary.subTotal,
        cgst: opts.lastSummary.cgst,
        sgst: opts.lastSummary.sgst,
        rate: String(opts.gstRateHalf * 2),
      },
      opts.lastSummary,
      opts.gstRateHalf
    );
  }

  const page = summarizeGstInvoicePageItems(opts.pageItems);
  const showPageTotal =
    (opts.pageCount || 1) > 2 &&
    Math.abs(page.pageTotal - opts.carriedForward) > 0.001;
  const cfClass = showPageTotal ? 'totals-row grand-total' : 'totals-row';

  return `
<table>
  <tr>
    <td width="70%">
      <b>Tax Summary</b><br>
      ${formatPageTaxSummary(page)}
    </td>
    <td width="30%" class="totals-panel">
      ${
        showPageTotal
          ? `<div class="totals-row"><span>PAGE TOTAL</span><span>${page.pageTotal.toFixed(2)}</span></div>`
          : ''
      }
      <div class="${cfClass}"><span>TOTAL C/F</span><span>${opts.carriedForward.toFixed(2)}</span></div>
    </td>
  </tr>
</table>`;
}

export function buildGstInvoiceHalfPageFooter(opts: {
  pageItems: GstInvoiceLineItem[];
  carriedForward: number;
  isLast: boolean;
  pageCount?: number;
  remarks: string;
  signatoryFor: string;
  amountInWords: string;
  paymentQrDataUri?: string;
  termsHtml?: string;
  lastSummary?: GstInvoiceSummary;
  lastTax?: { taxable: string; cgst: string; sgst: string; igst?: string; rate: string; summaryAmt?: string };
  gstRateHalf: number;
}): string {
  return `
${buildGstInvoicePageTotalsSection(opts)}
${buildGstInvoiceFooter(
  opts.remarks,
  opts.amountInWords,
  opts.signatoryFor,
  opts.termsHtml,
  opts.paymentQrDataUri
)}`;
}

export function buildGstInvoiceTotalsSection(
  tax: { taxable: string; cgst: string; sgst: string; igst?: string; rate: string; summaryAmt?: string },
  summary: GstInvoiceSummary,
  gstRateHalf: number,
  totalLabel = 'GRAND TOTAL'
): string {
  const roundOffSign = parseFloat(summary.roundOff) >= 0 ? '+' : '';
  const igstAmt = parseFloat(tax.igst || '0');
  const totalGst =
    igstAmt > 0
      ? igstAmt.toFixed(2)
      : (parseFloat(summary.sgst) + parseFloat(summary.cgst)).toFixed(2);
  const amtLine =
    tax.summaryAmt ||
    `Amt ${tax.rate}%: ${tax.taxable}`;
  const cgstSgstLabel =
    igstAmt > 0
      ? `IGST: ${tax.igst}`
      : tax.rate === 'mixed'
      ? `CGST: ${tax.cgst} | SGST: ${tax.sgst}`
      : `CGST ${gstRateHalf.toFixed(1)}%: ${tax.cgst} | SGST ${gstRateHalf.toFixed(1)}%: ${tax.sgst}`;
  return `
<table>
  <tr>
    <td width="70%">
      <b>Tax Summary</b><br>
      ${amtLine} |
      ${cgstSgstLabel}
      ${
        summary.walletRefs
          ? `<div style="margin-top:8px"><b>Wallet adjustment from credit note</b><br>${summary.walletRefs}</div>`
          : ''
      }
    </td>
    <td width="30%" class="totals-panel">
      <div class="totals-row"><span>SUB TOTAL</span><span>${summary.subTotal}</span></div>
      <div class="totals-row"><span>PRODUCT DISCOUNT</span><span>-${summary.discount}</span></div>
      <div class="totals-row"><span>GST</span><span>${totalGst}</span></div>
      ${
        summary.additionalDiscount && parseFloat(summary.additionalDiscount) > 0.001
          ? `<div class="totals-row"><span>ADDITIONAL DISCOUNT</span><span>-${summary.additionalDiscount}</span></div>`
          : ''
      }
      <div class="totals-row"><span>Round Off</span><span>${roundOffSign}${summary.roundOff}</span></div>
      <div class="totals-row grand-total"><span>${totalLabel}</span><span>${summary.grandTotal}</span></div>
      ${
        summary.walletApplied && parseFloat(summary.walletApplied) > 0.01
          ? `<div class="totals-row"><span>WALLET</span><span>-${summary.walletApplied}</span></div>`
          : ''
      }
      ${
        summary.amountDue != null && summary.amountDue !== ''
          ? `<div class="totals-row amount-due"><span>AMOUNT DUE</span><span>${summary.amountDue}</span></div>`
          : ''
      }
    </td>
  </tr>
</table>`;
}

const DEFAULT_SALES_TERMS = `Bills not paid by due date will attract 24% interest.<br>
      Subject to Indore jurisdiction only.<br>
      Goods once sold will not be taken back.<br>
      Cold storage items will not be returned.`;

export function buildGstInvoiceFooter(
  remarks: string,
  amountInWords: string,
  signatoryFor: string,
  termsHtml = DEFAULT_SALES_TERMS,
  paymentQrDataUri?: string
): string {
  const qrCell = paymentQrDataUri
    ? `
    <td width="18%" class="pay-qr">
      <img src="${paymentQrDataUri}" alt="Scan to Pay">
      <div class="pay-qr-label">Scan to Pay</div>
    </td>`
    : '';
  const termsWidth = paymentQrDataUri ? '42%' : '60%';
  return `
<table>
  <tr>
    <td width="${termsWidth}" class="footer-terms">
      <b>Terms & Conditions</b><br>
      ${termsHtml}<br><br>
      <b>Remarks:</b> ${remarks}<br>
      <b>Rs.</b> ${amountInWords}
    </td>${qrCell}
    <td width="40%" class="center signatory">
      For ${signatoryFor}<br><br>
      <b>Authorised Signatory</b>
    </td>
  </tr>
</table>`;
}
