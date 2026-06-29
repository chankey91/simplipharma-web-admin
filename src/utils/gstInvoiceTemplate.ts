export const GST_INVOICE_STYLES = `
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
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
    padding: 2px 3px;
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
  .title  { font-size: 16px; font-weight: bold; text-align: center; }
  .line-rejected td {
    text-decoration: line-through;
    color: #666;
  }
  .footer-terms { font-size: 10px; line-height: 1.35; }
  .signatory { vertical-align: bottom; }
  @media print {
    body { margin: 0; }
  }
`;

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
  sgst: string;
  cgst: string;
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
    <tr class="center ${item.rowClass || ''}">
      <td>${item.sn}</td>
      <td style="text-align:left">${item.name}</td>
      <td class="ellipsis-cell">${item.pack}</td>
      <td>${item.hsn}</td>
      <td class="ellipsis-cell">${item.batch}</td>
      <td>${item.exp}</td>
      <td>${item.qty}</td>
      <td>${item.free}</td>
      <td>${item.totalQty}</td>
      <td>${item.mrp}</td>
      <td>${item.rate}</td>
      <td>${item.disc}</td>
      <td>${item.sgst}</td>
      <td>${item.cgst}</td>
      <td class="right">${item.amount}</td>
    </tr>`
    )
    .join('');
}

export function buildGstInvoiceItemTableHtml(items: GstInvoiceLineItem[]): string {
  return `
<table>
  <thead>
    <tr class="center bold">
      <th style="width:3%">SN</th>
      <th style="width:18%">PRODUCT NAME</th>
      <th style="width:6%">PACK</th>
      <th style="width:6%">HSN</th>
      <th style="width:7%">BATCH</th>
      <th style="width:5%">EXP</th>
      <th style="width:4%">QTY</th>
      <th style="width:4%">FREE</th>
      <th style="width:4%">TQT</th>
      <th style="width:6%">MRP</th>
      <th style="width:6%">RATE</th>
      <th style="width:4%">DISC</th>
      <th style="width:5%">SGST</th>
      <th style="width:5%">CGST</th>
      <th style="width:7%">AMOUNT</th>
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
      <div class="totals-row"><span>SGST</span><span>${summary.sgst}</span></div>
      <div class="totals-row"><span>CGST</span><span>${summary.cgst}</span></div>
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
  termsHtml = DEFAULT_SALES_TERMS
): string {
  return `
<table>
  <tr>
    <td width="60%" class="footer-terms">
      <b>Terms & Conditions</b><br>
      ${termsHtml}<br><br>
      <b>Remarks:</b> ${remarks}<br>
      <b>Rs.</b> ${amountInWords}
    </td>
    <td width="40%" class="center signatory">
      For ${signatoryFor}<br><br><br>
      <b>Authorised Signatory</b>
    </td>
  </tr>
</table>`;
}
