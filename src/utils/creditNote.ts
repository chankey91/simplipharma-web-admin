import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { format } from 'date-fns';
import { CreditNote } from '../types';
import { getUserProfile } from '../services/firebase';

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

const getCreditNoteHTML = async (note: CreditNote) => {
  const creditDate =
    note.creditNoteDate instanceof Date ? note.creditNoteDate : new Date(note.creditNoteDate);

  const company = {
    name: 'SimpliPharma Solution Pvt. Ltd.',
    address: 'AG 50, Scheme No. 74, Indore, Madhya Pradesh. 452010',
    email: 'simplipharma.2025@gmail.com',
    dl: '20B/2876/12/2021,20B/2876/12/2021',
    gstin: '23AALCP3728L1Z4',
  };

  let party = {
    name: note.retailerName || note.retailerEmail || 'Retailer',
    address: note.retailerAddress || '',
    phone: note.retailerPhone || '',
    dl: note.retailerDl || '',
    gstin: note.retailerGstin || '',
  };

  if (note.retailerId) {
    try {
      const retailer = await getUserProfile(note.retailerId);
      if (retailer) {
        party = {
          name: retailer.shopName || retailer.displayName || retailer.email || party.name,
          address: retailer.address || retailer.location?.address || party.address,
          phone: retailer.phoneNumber || party.phone,
          dl: retailer.licenceNumber || party.dl,
          gstin: retailer.gst || party.gstin,
        };
      }
    } catch {
      /* use note fields */
    }
  }

  const itemsHTML = note.items
    .map((item, index) => {
      const exp =
        item.expiryDate instanceof Date
          ? format(item.expiryDate, 'MM/yyyy')
          : item.expiryDate
            ? format(new Date(item.expiryDate), 'MM/yyyy')
            : '—';
      const gstRate = item.gstRate ?? note.taxPercentage ?? 5;
      const taxable = item.refundAmount / (1 + gstRate / 100);
      const cgst = (item.refundAmount - taxable) / 2;
      const sgst = cgst;
      return `
      <tr class="center">
        <td>${index + 1}</td>
        <td style="text-align:left">${item.medicineName}</td>
        <td>${item.hsn || '—'}</td>
        <td>${item.batchNumber || '—'}</td>
        <td>${exp}</td>
        <td>${item.quantity}</td>
        <td>${item.unitRefundPrice.toFixed(2)}</td>
        <td>${(gstRate / 2).toFixed(1)}%</td>
        <td>${(gstRate / 2).toFixed(1)}%</td>
        <td class="right">${item.refundAmount.toFixed(2)}</td>
      </tr>
      <tr class="center muted">
        <td colspan="7"></td>
        <td>${cgst.toFixed(2)}</td>
        <td>${sgst.toFixed(2)}</td>
        <td></td>
      </tr>`;
    })
    .join('');

  const grandTotal = Math.round(note.totalAmount);
  const roundoff = grandTotal - note.totalAmount;

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Credit Note</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; margin: 0; padding: 12px; color: #111; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #333; padding: 4px; vertical-align: top; }
  .no-border td, .no-border th { border: none; }
  .center { text-align: center; }
  .right { text-align: right; }
  .title { font-size: 18px; font-weight: bold; text-align: center; margin: 8px 0; }
  .muted td { font-size: 10px; color: #555; border-top: none; }
  .header-box { border: 1px solid #333; padding: 8px; margin-bottom: 8px; }
</style>
</head>
<body>
<div class="header-box">
  <div style="font-size:16px;font-weight:bold;">${company.name}</div>
  <div>${company.address}</div>
  <div>Email: ${company.email} | DL: ${company.dl}</div>
  <div>GSTIN: ${company.gstin}</div>
</div>

<div class="title">CREDIT NOTE</div>

<table class="no-border" style="margin-bottom:8px;">
  <tr>
    <td width="50%">
      <b>Credit to:</b><br>
      ${party.name}<br>
      ${party.address || ''}<br>
      ${party.phone ? `Phone: ${party.phone}<br>` : ''}
      ${party.dl ? `DL: ${party.dl}<br>` : ''}
      ${party.gstin ? `GSTIN: ${party.gstin}` : ''}
    </td>
    <td width="50%">
      <b>Credit Note No:</b> ${note.creditNoteNumber}<br>
      <b>Date:</b> ${format(creditDate, 'yyyy-MM-dd')}<br>
      <b>Original Invoice:</b> ${note.originalInvoiceNumber || '—'}<br>
      <b>Order Ref:</b> ${note.orderId}<br>
      <b>Return Ref:</b> ${note.orderReturnRequestId}
    </td>
  </tr>
</table>

<table>
  <thead>
    <tr class="center">
      <th>S.N.</th>
      <th>Product</th>
      <th>HSN</th>
      <th>Batch</th>
      <th>Exp</th>
      <th>Qty</th>
      <th>Rate</th>
      <th>CGST</th>
      <th>SGST</th>
      <th>Amount</th>
    </tr>
  </thead>
  <tbody>${itemsHTML}</tbody>
</table>

<table class="no-border" style="margin-top:8px;">
  <tr>
    <td width="60%">
      <b>Amount in words:</b> ${numberToWords(grandTotal)}
    </td>
    <td width="40%">
      <table>
        <tr><td>Taxable Value</td><td class="right">${note.subTotal.toFixed(2)}</td></tr>
        <tr><td>Total Tax</td><td class="right">${note.taxAmount.toFixed(2)}</td></tr>
        <tr><td>Round Off</td><td class="right">${roundoff.toFixed(2)}</td></tr>
        <tr><td><b>Credit Total</b></td><td class="right"><b>${grandTotal.toFixed(2)}</b></td></tr>
      </table>
    </td>
  </tr>
</table>

<table class="no-border" style="margin-top:16px;">
  <tr>
    <td width="60%">
      Credit issued against returned goods from the original tax invoice listed above.
    </td>
    <td width="40%" class="center">
      For ${company.name}<br><br><br>
      <b>Authorised Signatory</b>
    </td>
  </tr>
</table>
</body>
</html>`;
};

export const generateCreditNotePdf = async (note: CreditNote) => {
  const html = await getCreditNoteHTML(note);
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

    pdf.save(`credit-note-${note.creditNoteNumber}.pdf`);
  } catch (error) {
    console.error('Error generating credit note PDF:', error);
    alert('Failed to generate credit note. Please try again.');
  } finally {
    document.body.removeChild(element);
  }
};
