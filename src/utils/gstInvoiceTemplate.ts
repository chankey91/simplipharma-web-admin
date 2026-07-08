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
    border: 1px solid #000;
    padding: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  td, th {
    border: 1px solid #000;
    padding: 1px 3px;
    vertical-align: top;
    word-wrap: break-word;
  }
  table tbody tr td {
    border-top: none;
    border-bottom: none;
  }
  table tbody tr:first-child td {
    border-top: 1px solid #000;
  }
  table tbody tr:last-child td {
    border-bottom: 1px solid #000;
  }
  .ellipsis-cell {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .items-table td,
  .items-table th {
    padding: 1px 2px;
    line-height: 1.2;
    vertical-align: middle;
  }
  .items-table thead th {
    white-space: nowrap;
    font-size: 10px;
    padding: 2px 2px;
    font-weight: bold;
  }
  .items-table tbody tr td {
    border-top: none;
    border-bottom: none;
  }
  .items-table tbody tr:first-child td {
    border-top: 1px solid #000;
  }
  .items-table tbody tr:last-child td {
    border-bottom: 1px solid #000;
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
  .footer-terms { font-size: 10px; line-height: 1.2; }
  .signatory { vertical-align: bottom; }
  .pay-qr { text-align: center; vertical-align: top; }
  .pay-qr img { width: 90px; height: 90px; display: block; margin: 0 auto 2px; }
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
      <td class="col-center ellipsis-cell">${item.batch}</td>
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
      <th class="col-left" style="width:26%">PRODUCT NAME</th>
      <th class="col-center" style="width:6%">PACK</th>
      <th class="col-center" style="width:6%">HSN</th>
      <th class="col-center" style="width:7%">BATCH</th>
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

export function buildGstInvoiceTotalsSection(
  tax: { taxable: string; cgst: string; sgst: string; rate: string },
  summary: GstInvoiceSummary,
  gstRateHalf: number,
  totalLabel = 'GRAND TOTAL'
): string {
  const roundOffSign = parseFloat(summary.roundOff) >= 0 ? '+' : '';
  const totalGst = (parseFloat(summary.sgst) + parseFloat(summary.cgst)).toFixed(2);
  return `
<table>
  <tr>
    <td width="70%">
      <b>Tax Summary</b><br>
      Amt ${tax.rate}%: ${tax.taxable} |
      CGST ${gstRateHalf.toFixed(1)}%: ${tax.cgst} |
      SGST ${gstRateHalf.toFixed(1)}%: ${tax.sgst}
    </td>
    <td width="30%" class="totals-panel">
      <div class="totals-row"><span>SUB TOTAL</span><span>${summary.subTotal}</span></div>
      <div class="totals-row"><span>PRODUCT DISCOUNT</span><span>-${summary.discount}</span></div>
      <div class="totals-row"><span>GST</span><span>${totalGst}</span></div>
      <div class="totals-row"><span>Round Off</span><span>${roundOffSign}${summary.roundOff}</span></div>
      <div class="totals-row grand-total"><span>${totalLabel}</span><span>${summary.grandTotal}</span></div>
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
      For ${signatoryFor}<br><br><br>
      <b>Authorised Signatory</b>
    </td>
  </tr>
</table>`;
}
