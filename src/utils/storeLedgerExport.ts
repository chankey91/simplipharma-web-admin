import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '../services/firebase';
import { COMPANY_INVOICE_DETAILS } from './invoicePartyDefaults';
import { formatLedgerAmount, type StoreLedgerResult } from './storeLedger';
import { istDateStampCompact } from './dateTime';
import { buildWhatsAppUrl, normalizeWhatsAppPhone } from './orderWhatsAppItems';

const ledgerDateFmt = (d: Date) => format(d, 'd-MMM-yy');
const periodFmt = (d: Date) => format(d, 'd-MMM-yy');

function ledgerFileBase(ledger: StoreLedgerResult): string {
  const safeName = ledger.storeName.replace(/[^\w\-]+/g, '_').slice(0, 40);
  return `store-ledger-${safeName}-${istDateStampCompact()}`;
}

/** Compact text PDF (KB-scale, not MB image raster). */
export function buildStoreLedgerPdfBlob(ledger: StoreLedgerResult): {
  blob: Blob;
  fileName: string;
} {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (need: number) => {
    if (y + need <= pageHeight - margin) return;
    pdf.addPage();
    y = margin;
    drawTableHeader();
  };

  const centerText = (text: string, size: number, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.text(text, pageWidth / 2, y, { align: 'center' });
    y += size * 0.45 + 1.5;
  };

  // Column layout (mm)
  const cols = {
    date: margin,
    particulars: margin + 18,
    vchType: margin + 88,
    vchNo: margin + 108,
    debit: margin + 128,
    credit: margin + 148,
    balance: margin + 168,
  };
  const rightEdge = pageWidth - margin;

  const drawTableHeader = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setDrawColor(40);
    pdf.setLineWidth(0.3);
    pdf.line(margin, y - 3, rightEdge, y - 3);
    pdf.text('Date', cols.date, y);
    pdf.text('Particulars', cols.particulars, y);
    pdf.text('Vch Type', cols.vchType, y);
    pdf.text('Vch No.', cols.vchNo, y);
    pdf.text('Debit', cols.debit, y, { align: 'right' });
    pdf.text('Credit', cols.credit, y, { align: 'right' });
    pdf.text('Balance', rightEdge, y, { align: 'right' });
    y += 2;
    pdf.line(margin, y, rightEdge, y);
    y += 4;
    pdf.setFont('helvetica', 'normal');
  };

  centerText(COMPANY_INVOICE_DETAILS.name, 11, true);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  const addrLines = pdf.splitTextToSize(COMPANY_INVOICE_DETAILS.address, usableWidth);
  for (const line of addrLines) {
    pdf.text(line, pageWidth / 2, y, { align: 'center' });
    y += 3.5;
  }
  y += 2;
  pdf.setDrawColor(80);
  pdf.line(margin, y, rightEdge, y);
  y += 5;

  centerText(ledger.storeName, 10, true);
  centerText('Ledger Account', 9, false);
  if (ledger.storeCode !== '—') centerText(`Store code: ${ledger.storeCode}`, 8);
  if (ledger.storeAddress && ledger.storeAddress !== '—') {
    const storeAddr = pdf.splitTextToSize(ledger.storeAddress, usableWidth);
    for (const line of storeAddr) {
      pdf.setFontSize(8);
      pdf.text(line, pageWidth / 2, y, { align: 'center' });
      y += 3.5;
    }
  }
  if (ledger.storeGstNumber !== '—') centerText(`GSTIN: ${ledger.storeGstNumber}`, 8);
  centerText(`${periodFmt(ledger.fromDate)} to ${periodFmt(ledger.toDate)}`, 8);
  y += 2;

  drawTableHeader();

  const maxParticularsWidth = cols.vchType - cols.particulars - 2;

  const drawRow = (
    date: string,
    particulars: string,
    vchType: string,
    vchNo: string,
    debit: string,
    credit: string,
    balance: string,
    bold = false
  ) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(7.5);
    const partLines = pdf.splitTextToSize(particulars || '—', maxParticularsWidth);
    const rowHeight = Math.max(4, partLines.length * 3.2);
    ensureSpace(rowHeight + 1);
    const rowTop = y;
    pdf.text(date, cols.date, rowTop);
    pdf.text(partLines, cols.particulars, rowTop);
    pdf.text(vchType, cols.vchType, rowTop);
    pdf.text(vchNo, cols.vchNo, rowTop);
    if (debit) pdf.text(debit, cols.debit, rowTop, { align: 'right' });
    if (credit) pdf.text(credit, cols.credit, rowTop, { align: 'right' });
    pdf.text(balance, rightEdge, rowTop, { align: 'right' });
    y = rowTop + rowHeight;
  };

  for (const e of ledger.entries) {
    const particulars =
      e.particularsBold != null ? `${e.particulars}${e.particularsBold}` : e.particulars;
    drawRow(
      ledgerDateFmt(e.date),
      particulars,
      e.vchType === 'Opening' ? '' : e.vchType,
      e.vchNo,
      e.debit ? formatLedgerAmount(e.debit) : '',
      e.credit ? formatLedgerAmount(e.credit) : '',
      formatLedgerAmount(e.balance),
      e.isSummary === true
    );
  }

  drawRow(
    '',
    'Closing Balance',
    '',
    '',
    ledger.closingBalance > 0 ? formatLedgerAmount(ledger.closingBalance) : '',
    ledger.closingBalance < 0 ? formatLedgerAmount(Math.abs(ledger.closingBalance)) : '',
    formatLedgerAmount(ledger.closingBalance),
    true
  );

  const fileName = `${ledgerFileBase(ledger)}.pdf`;
  const blob = pdf.output('blob');
  return { blob, fileName };
}

export async function downloadStoreLedgerPdf(ledger: StoreLedgerResult): Promise<void> {
  const { blob, fileName } = buildStoreLedgerPdfBlob(ledger);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Upload compact PDF and open WhatsApp Web with a shareable link. */
export async function shareStoreLedgerPdfOnWhatsApp(
  ledger: StoreLedgerResult,
  phoneRaw?: string | null
): Promise<{ opened: boolean; downloadUrl: string; fileName: string }> {
  const { blob, fileName } = buildStoreLedgerPdfBlob(ledger);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in required to share ledger PDF');

  const path = `store_ledgers/${uid}/${Date.now()}_${fileName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blob, { contentType: 'application/pdf' });
  const downloadUrl = await getDownloadURL(fileRef);

  const period = `${periodFmt(ledger.fromDate)} to ${periodFmt(ledger.toDate)}`;
  const closing =
    ledger.closingBalance >= 0
      ? `Dr ${formatLedgerAmount(ledger.closingBalance)}`
      : `Cr ${formatLedgerAmount(Math.abs(ledger.closingBalance))}`;
  const text = [
    `SimpliPharma — Store ledger`,
    `Store: ${ledger.storeName}${ledger.storeCode !== '—' ? ` (${ledger.storeCode})` : ''}`,
    `Period: ${period}`,
    `Closing: *${closing}*`,
    '',
    `PDF: ${downloadUrl}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }

  const phone = normalizeWhatsAppPhone(phoneRaw);
  if (phone) {
    window.open(buildWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer');
    return { opened: true, downloadUrl, fileName };
  }
  return { opened: false, downloadUrl, fileName };
}

export function downloadStoreLedgerExcel(ledger: StoreLedgerResult): void {
  const headerRows: (string | number)[][] = [
    [COMPANY_INVOICE_DETAILS.name],
    [COMPANY_INVOICE_DETAILS.address],
    [],
    [ledger.storeName],
    ['Ledger Account'],
    ...(ledger.storeCode !== '—' ? [[`Store code: ${ledger.storeCode}`]] : []),
    [ledger.storeAddress],
    ...(ledger.storeGstNumber !== '—' ? [[`GSTIN: ${ledger.storeGstNumber}`]] : []),
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
  XLSX.writeFile(wb, `${ledgerFileBase(ledger)}.xlsx`);
}
