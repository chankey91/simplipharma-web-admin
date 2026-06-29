import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { format } from 'date-fns';
import { DebitNote } from '../types';
import { appAlert } from './appDialog';
import { getUserProfile } from '../services/firebase';
import { getMedicineById } from '../services/inventory';
import { invoiceStateHtml, resolveInvoiceState } from './invoicePartyDefaults';
import {
  GST_INVOICE_STYLES,
  buildGstInvoiceFooter,
  buildGstInvoiceItemTableHtml,
  buildGstInvoiceTotalsSection,
  type GstInvoiceLineItem,
} from './gstInvoiceTemplate';

const numberToWords = (num: number): string => {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';

  const convertHundreds = (n: number): string => {
    let result = '';
    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) result += ones[n] + ' ';
    return result.trim();
  };

  let words = '';
  const crore = Math.floor(num / 10000000);
  if (crore > 0) {
    words += convertHundreds(crore) + 'Crore ';
    num %= 10000000;
  }
  const lakh = Math.floor(num / 100000);
  if (lakh > 0) {
    words += convertHundreds(lakh) + 'Lakh ';
    num %= 100000;
  }
  const thousand = Math.floor(num / 1000);
  if (thousand > 0) {
    words += convertHundreds(thousand) + 'Thousand ';
    num %= 1000;
  }
  if (num > 0) words += convertHundreds(num);
  return words.trim() + ' Rupees Only';
};

type DebitNoteItemRow = GstInvoiceLineItem;

async function prepareDebitNoteItemRows(note: DebitNote): Promise<DebitNoteItemRow[]> {
  return Promise.all(
    note.items.map(async (item, index) => {
      const gstRate = item.gstRate ?? note.taxPercentage ?? 5;
      const exp =
        item.expiryDate instanceof Date
          ? format(item.expiryDate, 'MM/yy')
          : item.expiryDate
            ? format(new Date(item.expiryDate), 'MM/yy')
            : '—';

      let pack = '—';
      try {
        const medicine = await getMedicineById(item.medicineId);
        if (medicine?.unit) {
          pack = medicine.unit;
        } else if (medicine?.description) {
          const packagingMatch = medicine.description.match(/Packaging:\s*(.+)/i);
          if (packagingMatch?.[1]) pack = packagingMatch[1].trim();
        }
      } catch {
        /* ignore */
      }

      const qty = item.quantity;
      return {
        sn: index + 1,
        name: item.medicineName,
        pack,
        hsn: item.hsn || '—',
        batch: item.batchNumber || '—',
        exp,
        qty: qty.toFixed(2),
        free: '0.00',
        totalQty: qty.toFixed(2),
        mrp: '-',
        rate: item.unitRefundPrice.toFixed(2),
        disc: '0.00',
        sgst: `${(gstRate / 2).toFixed(1)}%`,
        cgst: `${(gstRate / 2).toFixed(1)}%`,
        amount: item.refundAmount.toFixed(2),
      };
    })
  );
}

const getDebitNoteHTML = async (note: DebitNote) => {
  const debitDate =
    note.debitNoteDate instanceof Date ? note.debitNoteDate : new Date(note.debitNoteDate);

  const company = {
    name: 'SimpliPharma Solution Pvt. Ltd.',
    address: 'AG 50, Scheme No. 74, Indore, Madhya Pradesh. 452010',
    phone: '',
    email: 'simplipharma.2025@gmail.com',
    dl: '20B/2876/12/2021,20B/2876/12/2021',
    gstin: '23AALCP3728L1Z4',
  };

  let party = {
    name: note.retailerName || note.retailerEmail || 'N/A',
    address: note.retailerAddress || '',
    phone: note.retailerPhone || '',
    dl: note.retailerDl || '',
    gstin: note.retailerGstin || '',
    ...resolveInvoiceState(),
  };

  if (note.retailerId) {
    try {
      const retailer = await getUserProfile(note.retailerId);
      if (retailer) {
        party = {
          name: retailer.shopName || retailer.displayName || retailer.email || party.name,
          address: retailer.address || retailer.location?.address || party.address,
          phone: retailer.phoneNumber || party.phone,
          dl: retailer.licenceNumber || retailer.licenceHolderName || party.dl,
          gstin: retailer.gst || party.gstin,
          ...resolveInvoiceState(),
        };
      }
    } catch {
      /* use note fields */
    }
  }

  const companyState = resolveInvoiceState();

  const items = await prepareDebitNoteItemRows(note);
  const gstRatePercent = note.taxPercentage ?? 5;
  const totalCGST = note.taxAmount / 2;
  const totalSGST = note.taxAmount / 2;
  const calculatedTotal = note.subTotal + note.taxAmount;
  const grandTotal = Math.round(calculatedTotal);
  const roundoff = grandTotal - calculatedTotal;

  const documentData = {
    no: note.debitNoteNumber,
    date: format(debitDate, 'yyyy-MM-dd'),
    originalInvoice: note.originalInvoiceNumber || '—',
    orderRef: note.orderId || '—',
    reason: note.reason || note.sourceType || '—',
    user: 'Admin',
  };

  const tax = {
    taxable: note.subTotal.toFixed(2),
    cgst: totalCGST.toFixed(2),
    sgst: totalSGST.toFixed(2),
    rate: gstRatePercent.toFixed(0),
  };

  const summary = {
    subTotal: note.subTotal.toFixed(2),
    discount: '0.00',
    sgst: totalSGST.toFixed(2),
    cgst: totalCGST.toFixed(2),
    roundOff: roundoff.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    amountInWords: numberToWords(grandTotal),
  };

  const debitNoteTerms = `Debit note issued for expiry returns or billing corrections against the original tax invoice referenced above.<br>
      Subject to Indore jurisdiction only.<br>
      Goods once sold will not be taken back.<br>
      Cold storage items will not be returned.`;

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Debit Note</title>
<style>${GST_INVOICE_STYLES}</style>
</head>
<body>
<div class="invoice-box">
<!-- HEADER -->
<table>
  <tr>
    <td width="50%">
      <b>${company.name}</b><br>
      ${company.address}<br>
      ${invoiceStateHtml(companyState.state, companyState.stateCode)}
      Phone: ${company.phone}<br>
      Email: ${company.email}<br><br>
      <b>D.L. No:</b> ${company.dl}<br>
      <b>GSTIN:</b> ${company.gstin}
    </td>
    <td width="50%">
      <b>${party.name}</b><br>
      Party Address: ${party.address}<br>
      ${invoiceStateHtml(party.state, party.stateCode)}
      Ph.No: ${party.phone}<br>
      Party D.L No: ${party.dl}<br>
      GST No: ${party.gstin}
    </td>
  </tr>
</table>
<!-- DEBIT NOTE INFO -->
<table>
  <tr>
    <td colspan="2" class="title">DEBIT NOTE</td>
    <td>
      Debit Note No: ${documentData.no}<br>
      Original Invoice: ${documentData.originalInvoice}<br>
      Order Ref: ${documentData.orderRef}<br>
      User: ${documentData.user}
    </td>
    <td>
      Date: ${documentData.date}<br>
      Reason: ${documentData.reason}
    </td>
  </tr>
</table>
<!-- ITEM TABLE -->
${buildGstInvoiceItemTableHtml(items)}
<!-- TOTAL SECTION -->
${buildGstInvoiceTotalsSection(tax, summary, gstRatePercent / 2, 'DEBIT TOTAL')}
<!-- FOOTER -->
${buildGstInvoiceFooter(note.reason || '', summary.amountInWords, company.name, debitNoteTerms)}
</div>
</body>
</html>`;
};

export const generateDebitNotePdf = async (note: DebitNote) => {
  const html = await getDebitNoteHTML(note);
  const element = document.createElement('div');
  element.innerHTML = html;
  element.style.width = '210mm';
  element.style.padding = '0';
  element.style.margin = '0';
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  element.style.top = '0';
  document.body.appendChild(element);

  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      width: element.scrollWidth,
      height: element.scrollHeight,
    });

    const imgData = canvas.toDataURL('image/png');
    const imgWidth = 210;
    const pageHeight = 297;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;

    const pdf = new jsPDF('p', 'mm', 'a4');
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`debit-note-${note.debitNoteNumber}.pdf`);
  } catch (error) {
    console.error('Error generating debit note PDF:', error);
    await appAlert('Failed to generate debit note. Please try again.', { severity: 'error' });
  } finally {
    document.body.removeChild(element);
  }
};
