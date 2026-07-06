import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { COMPANY_INVOICE_DETAILS } from './invoicePartyDefaults';
import {
  formatLedgerAmount,
  type VendorLedgerResult,
} from './vendorLedger';
import { istDateStampCompact } from './dateTime';

const ledgerDateFmt = (d: Date) => format(d, 'd-MMM-yy');
const periodFmt = (d: Date) => format(d, 'd-MMM-yy');

function buildLedgerHtml(ledger: VendorLedgerResult): string {
  const rows = ledger.entries
    .map((e) => {
      const particulars =
        e.particularsBold != null
          ? `${e.particulars}<strong>${e.particularsBold}</strong>`
          : e.particulars;
      const rowStyle = e.isSummary ? 'font-weight:600;background:#f5f5f5;' : '';
      return `<tr style="${rowStyle}">
        <td style="padding:4px 6px;border-bottom:1px solid #ccc;">${ledgerDateFmt(e.date)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #ccc;">${particulars}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #ccc;">${e.vchType === 'Opening' ? '' : e.vchType}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #ccc;">${e.vchNo}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #ccc;text-align:right;">${formatLedgerAmount(e.debit)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #ccc;text-align:right;">${formatLedgerAmount(e.credit)}</td>
      </tr>`;
    })
    .join('');

  const closingRow = `<tr style="font-weight:700;background:#eee;">
    <td colspan="4" style="padding:6px;border-top:2px solid #333;">Closing Balance</td>
    <td style="padding:6px;border-top:2px solid #333;text-align:right;">${ledger.closingBalance > 0 ? formatLedgerAmount(ledger.closingBalance) : ''}</td>
    <td style="padding:6px;border-top:2px solid #333;text-align:right;">${ledger.closingBalance < 0 ? formatLedgerAmount(Math.abs(ledger.closingBalance)) : ''}</td>
  </tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 16px; }
    .center { text-align: center; }
    .title { font-size: 14px; font-weight: bold; }
    .subtitle { font-size: 12px; font-weight: bold; margin-top: 8px; }
    .period { margin: 8px 0 12px; }
    table { width: 100%; border-collapse: collapse; }
    th { border-bottom: 2px solid #333; padding: 6px; text-align: left; font-size: 11px; }
    th.num { text-align: right; }
  </style></head><body>
    <div class="center title">${COMPANY_INVOICE_DETAILS.name}</div>
    <div class="center">${COMPANY_INVOICE_DETAILS.address}</div>
    <hr style="margin:12px 0;" />
    <div class="center subtitle">${ledger.vendorName}</div>
    <div class="center">Ledger Account</div>
    <div class="center" style="margin-top:4px;">${ledger.vendorAddress}</div>
    <div class="center period">${periodFmt(ledger.fromDate)} to ${periodFmt(ledger.toDate)}</div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Particulars</th>
          <th>Vch Type</th>
          <th>Vch No.</th>
          <th class="num">Debit</th>
          <th class="num">Credit</th>
        </tr>
      </thead>
      <tbody>${rows}${closingRow}</tbody>
    </table>
  </body></html>`;
}

export async function downloadVendorLedgerPdf(ledger: VendorLedgerResult): Promise<void> {
  const html = buildLedgerHtml(ledger);
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 210;
    const pageHeight = 297;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const safeName = ledger.vendorName.replace(/[^\w\-]+/g, '_').slice(0, 40);
    pdf.save(`vendor-ledger-${safeName}-${istDateStampCompact()}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

export function downloadVendorLedgerExcel(ledger: VendorLedgerResult): void {
  const headerRows: (string | number)[][] = [
    [COMPANY_INVOICE_DETAILS.name],
    [COMPANY_INVOICE_DETAILS.address],
    [],
    [ledger.vendorName],
    ['Ledger Account'],
    [ledger.vendorAddress],
    [`${periodFmt(ledger.fromDate)} to ${periodFmt(ledger.toDate)}`],
    [],
    ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Balance'],
  ];

  const dataRows = ledger.entries.map((e) => [
    ledgerDateFmt(e.date),
    e.particularsBold ? `${e.particulars}${e.particularsBold}` : e.particulars,
    e.vchType === 'Opening' ? '' : e.vchType,
    e.vchNo,
    e.debit || '',
    e.credit || '',
    e.balance,
  ]);

  dataRows.push([
    '',
    'Closing Balance',
    '',
    '',
    ledger.closingBalance > 0 ? ledger.closingBalance : '',
    ledger.closingBalance < 0 ? Math.abs(ledger.closingBalance) : '',
    ledger.closingBalance,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
  const safeName = ledger.vendorName.replace(/[^\w\-]+/g, '_').slice(0, 40);
  XLSX.writeFile(wb, `vendor-ledger-${safeName}-${istDateStampCompact()}.xlsx`);
}
