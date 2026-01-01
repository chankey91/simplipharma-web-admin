import jsPDF from 'jspdf';
import { Order, PurchaseInvoice } from '../types';
import { format } from 'date-fns';

// Function to convert number to words
const numberToWords = (num: number): string => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
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
    if (n > 0) {
      result += ones[n] + ' ';
    }
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
  
  if (num > 0) {
    words += convertHundreds(num);
  }
  
  return words.trim() + ' Rupees Only';
};

export const generateOrderInvoice = (order: Order) => {
  const doc = new jsPDF();
  
  // Seller Details (Left Side)
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SimpliPharma', 20, 20);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Address Line 1', 20, 28);
  doc.text('Address Line 2', 20, 34);
  doc.text('City, State - PIN Code', 20, 40);
  doc.text('Phone:', 20, 46);
  doc.text('E-Mail: info@simplipharma.com', 20, 52);
  doc.text('D.L.No.: XXXXXX/XXXX', 20, 58);
  doc.text('GSTIN: XXXXXX', 20, 64);
  
  // Invoice Title and Details (Right Side)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('SALES GST INVOICE', 150, 20, { align: 'right' });
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const invoiceDate = order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate);
  doc.text(`Invoice No.: ${order.id.substring(0, 12)}`, 150, 28, { align: 'right' });
  doc.text(`Date: ${format(invoiceDate, 'yyyy-MM-dd')}`, 150, 34, { align: 'right' });
  doc.text(`Due Date: ${format(invoiceDate, 'yyyy-MM-dd')}`, 150, 40, { align: 'right' });
  doc.text('USER: Admin', 150, 46, { align: 'right' });
  doc.text('Tray No:', 150, 52, { align: 'right' });
  
  // Buyer Details (Right Side, below invoice details)
  let yPos = 60;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Buyer Information:', 100, yPos);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  yPos += 7;
  doc.text(`Name: ${order.retailerName || order.retailerEmail || 'N/A'}`, 100, yPos);
  yPos += 6;
  if (order.deliveryAddress) {
    doc.text(`Party Address: ${order.deliveryAddress}`, 100, yPos);
    yPos += 6;
  }
  doc.text('State:', 100, yPos);
  yPos += 6;
  doc.text('Ph.No.:', 100, yPos);
  yPos += 6;
  doc.text('Party D.L No:', 100, yPos);
  yPos += 6;
  doc.text('GST No:', 100, yPos);
  
  // Items Table Header
  yPos = Math.max(yPos + 10, 100);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(220, 220, 220);
  doc.rect(10, yPos - 4, 190, 5, 'F');
  
  // Table columns: SN, PRODUCT NAME, PACKAG., HSN, BATCH NO, EXP., QTY, FREE, TQT, M.R.P., RATE, DISC, SGST, CGST, AMOUNT
  let xPos = 11;
  doc.text('SN', xPos, yPos);
  xPos += 6;
  doc.text('PRODUCT NAME', xPos, yPos);
  xPos += 25;
  doc.text('PACKAG.', xPos, yPos);
  xPos += 8;
  doc.text('HSN', xPos, yPos);
  xPos += 9;
  doc.text('BATCH NO', xPos, yPos);
  xPos += 11;
  doc.text('EXP.', xPos, yPos);
  xPos += 7;
  doc.text('QTY', xPos, yPos);
  xPos += 6;
  doc.text('FREE', xPos, yPos);
  xPos += 6;
  doc.text('TQT', xPos, yPos);
  xPos += 6;
  doc.text('M.R.P.', xPos, yPos);
  xPos += 8;
  doc.text('RATE', xPos, yPos);
  xPos += 8;
  doc.text('DISC', xPos, yPos);
  xPos += 7;
  doc.text('SGST', xPos, yPos);
  xPos += 7;
  doc.text('CGST', xPos, yPos);
  xPos += 7;
  doc.text('AMOUNT', xPos, yPos);
  
  // Items
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  yPos += 5;
  
  const redrawHeader = (y: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(220, 220, 220);
    doc.rect(10, y - 4, 190, 5, 'F');
    let x = 11;
    doc.text('SN', x, y);
    x += 6;
    doc.text('PRODUCT NAME', x, y);
    x += 25;
    doc.text('PACKAG.', x, y);
    x += 8;
    doc.text('HSN', x, y);
    x += 9;
    doc.text('BATCH NO', x, y);
    x += 11;
    doc.text('EXP.', x, y);
    x += 7;
    doc.text('QTY', x, y);
    x += 6;
    doc.text('FREE', x, y);
    x += 6;
    doc.text('TQT', x, y);
    x += 6;
    doc.text('M.R.P.', x, y);
    x += 8;
    doc.text('RATE', x, y);
    x += 8;
    doc.text('DISC', x, y);
    x += 7;
    doc.text('SGST', x, y);
    x += 7;
    doc.text('CGST', x, y);
    x += 7;
    doc.text('AMOUNT', x, y);
    doc.setFont('helvetica', 'normal');
  };
  
  let totalSubTotal = 0;
  let totalProductDiscount = 0;
  let totalSGST = 0;
  let totalCGST = 0;
  
  order.medicines.forEach((item, index) => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
      redrawHeader(yPos);
      yPos += 5;
    }
    
    const price = item.price || 0;
    const quantity = item.quantity || 0;
    const freeQuantity = 0; // Order items don't have free quantity typically
    const totalQty = quantity + freeQuantity;
    const mrp = (item as any).mrp || price || 0;
    const discountPercentage = 0; // Can be from item if available
    const gstRate = order.taxPercentage || 18;
    
    // Calculate amounts
    const baseAmount = price * quantity;
    const discountAmount = (baseAmount * discountPercentage) / 100;
    const amountAfterDiscount = baseAmount - discountAmount;
    const sgstAmount = (amountAfterDiscount * (gstRate / 2)) / 100;
    const cgstAmount = (amountAfterDiscount * (gstRate / 2)) / 100;
    const itemAmount = amountAfterDiscount + sgstAmount + cgstAmount;
    
    totalSubTotal += baseAmount;
    totalProductDiscount += discountAmount;
    totalSGST += sgstAmount;
    totalCGST += cgstAmount;
    
    xPos = 11;
    doc.text((index + 1).toString(), xPos, yPos);
    xPos += 6;
    const itemName = (item.name || 'Unknown').substring(0, 15);
    doc.text(itemName, xPos, yPos);
    xPos += 25;
    doc.text('-', xPos, yPos); // Package - not available in order
    xPos += 8;
    doc.text('300490', xPos, yPos); // Default HSN
    xPos += 9;
    doc.text((item.batchNumber || '-').substring(0, 8), xPos, yPos);
    xPos += 11;
    // Expiry Date
    if (item.expiryDate) {
      let expDate: Date;
      if (item.expiryDate instanceof Date) {
        expDate = item.expiryDate;
      } else if (item.expiryDate && typeof item.expiryDate.toDate === 'function') {
        expDate = item.expiryDate.toDate();
      } else if (typeof item.expiryDate === 'string' || typeof item.expiryDate === 'number') {
        expDate = new Date(item.expiryDate);
      } else {
        expDate = new Date();
      }
      doc.text(format(expDate, 'MM/yy'), xPos, yPos);
    } else {
      doc.text('-', xPos, yPos);
    }
    xPos += 7;
    doc.text(quantity.toFixed(1), xPos, yPos);
    xPos += 6;
    doc.text(freeQuantity > 0 ? freeQuantity.toFixed(1) : '0.0', xPos, yPos);
    xPos += 6;
    doc.text(totalQty.toFixed(0), xPos, yPos);
    xPos += 6;
    doc.text(mrp > 0 ? mrp.toFixed(2) : '-', xPos, yPos);
    xPos += 8;
    doc.text(price.toFixed(2), xPos, yPos);
    xPos += 8;
    doc.text(discountPercentage > 0 ? discountPercentage.toFixed(2) : '0.00', xPos, yPos);
    xPos += 7;
    doc.text(sgstAmount.toFixed(2), xPos, yPos);
    xPos += 7;
    doc.text(cgstAmount.toFixed(2), xPos, yPos);
    xPos += 7;
    doc.text(itemAmount.toFixed(2), xPos, yPos);
    
    yPos += 4;
  });
  
  // Financial Summary (Right Side)
  yPos = Math.max(yPos + 5, 260);
  const billDiscount = 0;
  const calculatedTotal = totalSubTotal - totalProductDiscount - billDiscount + totalSGST + totalCGST;
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  doc.text('SUB TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`${totalSubTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('PRODUCT DISCOUNT:', 130, yPos, { align: 'right' });
  doc.text(`${totalProductDiscount.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('BILL DISCOUNT:', 130, yPos, { align: 'right' });
  doc.text(`${billDiscount.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('SGST:', 130, yPos, { align: 'right' });
  doc.text(`${totalSGST.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('CGST:', 130, yPos, { align: 'right' });
  doc.text(`${totalCGST.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('Roundoff:', 130, yPos, { align: 'right' });
  doc.text(`${roundoff.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GRAND TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`${grandTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  // GST Breakdown (Left Side)
  yPos = Math.max(yPos + 10, 260);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const gstRate = order.taxPercentage || 18;
  const taxableAmount = totalSubTotal - totalProductDiscount - billDiscount;
  const cgst = totalCGST;
  const sgst = totalSGST;
  
  doc.text(`Amt ${gstRate}%: ${taxableAmount.toFixed(2)}`, 20, yPos);
  yPos += 5;
  doc.text(`CGST ${gstRate / 2}%: ${cgst.toFixed(2)}`, 20, yPos);
  yPos += 5;
  doc.text(`SGST ${gstRate / 2}%: ${sgst.toFixed(2)}`, 20, yPos);
  
  // Amount in Words
  yPos += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const amountInWords = numberToWords(grandTotal);
  doc.text(`Grand Total in words: Rs. ${amountInWords}`, 20, yPos);
  
  // Terms & Conditions
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Terms & Conditions:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 5;
  doc.setFontSize(7);
  doc.text('Bills not paid by the due date will attract 24% interest.', 20, yPos);
  yPos += 4;
  doc.text('All disputes are subject to INDORE Jurisdiction only.', 20, yPos);
  yPos += 4;
  doc.text('Prescribed Sales Tax declaration will be given.', 20, yPos);
  yPos += 4;
  doc.text('Cold storage items will not be returned.', 20, yPos);
  
  // Signature Section
  yPos = 280;
  doc.setFontSize(8);
  doc.text('For SimpliPharma', 20, yPos);
  yPos += 15;
  doc.text('Authorised Signatory', 20, yPos);
  
  // Footer
  doc.setFontSize(7);
  doc.text('This is a computer generated invoice.', 105, 290, { align: 'center' });
  
  // Save PDF
  doc.save(`invoice-${order.id.substring(0, 8)}.pdf`);
};

export const generatePurchaseInvoice = (invoice: PurchaseInvoice) => {
  const doc = new jsPDF();
  
  // Seller Details (Left Side)
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SimpliPharma', 20, 20);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Address Line 1', 20, 28);
  doc.text('Address Line 2', 20, 34);
  doc.text('City, State - PIN Code', 20, 40);
  doc.text('Phone:', 20, 46);
  doc.text('E-Mail: info@simplipharma.com', 20, 52);
  doc.text('D.L.No.: XXXXXX/XXXX', 20, 58);
  doc.text('GSTIN: XXXXXX', 20, 64);
  
  // Invoice Title and Details (Right Side)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('PURCHASE GST INVOICE', 150, 20, { align: 'right' });
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const invoiceDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate);
  doc.text(`Invoice No.: ${invoice.invoiceNumber}`, 150, 28, { align: 'right' });
  doc.text(`Date: ${format(invoiceDate, 'yyyy-MM-dd')}`, 150, 34, { align: 'right' });
  doc.text(`Due Date: ${format(invoiceDate, 'yyyy-MM-dd')}`, 150, 40, { align: 'right' });
  doc.text('USER: Admin', 150, 46, { align: 'right' });
  doc.text('Tray No:', 150, 52, { align: 'right' });
  
  // Vendor Details (Right Side, below invoice details)
  let yPos = 60;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Vendor Information:', 100, yPos);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  yPos += 7;
  doc.text(`Name: ${invoice.vendorName || 'N/A'}`, 100, yPos);
  yPos += 6;
  doc.text('Party Address:', 100, yPos);
  yPos += 6;
  doc.text('State:', 100, yPos);
  yPos += 6;
  doc.text('Ph.No.:', 100, yPos);
  yPos += 6;
  doc.text('Party D.L No:', 100, yPos);
  yPos += 6;
  doc.text('GST No:', 100, yPos);
  
  // Items Table Header
  yPos = Math.max(yPos + 10, 100);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(220, 220, 220);
  doc.rect(10, yPos - 4, 190, 5, 'F');
  
  // Table columns: SN, PRODUCT NAME, PACKAG., HSN, BATCH NO, EXP., QTY, FREE, TQT, M.R.P., RATE, DISC, SGST, CGST, AMOUNT
  let xPos = 11;
  doc.text('SN', xPos, yPos);
  xPos += 6;
  doc.text('PRODUCT NAME', xPos, yPos);
  xPos += 25;
  doc.text('PACKAG.', xPos, yPos);
  xPos += 8;
  doc.text('HSN', xPos, yPos);
  xPos += 9;
  doc.text('BATCH NO', xPos, yPos);
  xPos += 11;
  doc.text('EXP.', xPos, yPos);
  xPos += 7;
  doc.text('QTY', xPos, yPos);
  xPos += 6;
  doc.text('FREE', xPos, yPos);
  xPos += 6;
  doc.text('TQT', xPos, yPos);
  xPos += 6;
  doc.text('M.R.P.', xPos, yPos);
  xPos += 8;
  doc.text('RATE', xPos, yPos);
  xPos += 8;
  doc.text('DISC', xPos, yPos);
  xPos += 7;
  doc.text('SGST', xPos, yPos);
  xPos += 7;
  doc.text('CGST', xPos, yPos);
  xPos += 7;
  doc.text('AMOUNT', xPos, yPos);
  
  // Items
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  yPos += 5;
  
  const redrawHeader = (y: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(220, 220, 220);
    doc.rect(10, y - 4, 190, 5, 'F');
    let x = 11;
    doc.text('SN', x, y);
    x += 6;
    doc.text('PRODUCT NAME', x, y);
    x += 25;
    doc.text('PACKAG.', x, y);
    x += 8;
    doc.text('HSN', x, y);
    x += 9;
    doc.text('BATCH NO', x, y);
    x += 11;
    doc.text('EXP.', x, y);
    x += 7;
    doc.text('QTY', x, y);
    x += 6;
    doc.text('FREE', x, y);
    x += 6;
    doc.text('TQT', x, y);
    x += 6;
    doc.text('M.R.P.', x, y);
    x += 8;
    doc.text('RATE', x, y);
    x += 8;
    doc.text('DISC', x, y);
    x += 7;
    doc.text('SGST', x, y);
    x += 7;
    doc.text('CGST', x, y);
    x += 7;
    doc.text('AMOUNT', x, y);
    doc.setFont('helvetica', 'normal');
  };
  
  let totalSubTotal = 0;
  let totalProductDiscount = 0;
  let totalSGST = 0;
  let totalCGST = 0;
  
  invoice.items.forEach((item, index) => {
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
      redrawHeader(yPos);
      yPos += 5;
    }
    
    const price = item.purchasePrice || 0;
    const quantity = item.quantity || 0;
    const freeQuantity = item.freeQuantity || 0;
    const totalQty = quantity + freeQuantity;
    const mrp = item.mrp || 0;
    const discountPercentage = item.discountPercentage || 0;
    const gstRate = item.gstRate || 0;
    
    // Calculate amounts
    const baseAmount = price * quantity;
    const discountAmount = (baseAmount * discountPercentage) / 100;
    const amountAfterDiscount = baseAmount - discountAmount;
    const sgstAmount = (amountAfterDiscount * (gstRate / 2)) / 100;
    const cgstAmount = (amountAfterDiscount * (gstRate / 2)) / 100;
    const itemAmount = amountAfterDiscount + sgstAmount + cgstAmount;
    
    totalSubTotal += baseAmount;
    totalProductDiscount += discountAmount;
    totalSGST += sgstAmount;
    totalCGST += cgstAmount;
    
    xPos = 11;
    doc.text((index + 1).toString(), xPos, yPos);
    xPos += 6;
    const itemName = (item.medicineName || 'Unknown').substring(0, 15);
    doc.text(itemName, xPos, yPos);
    xPos += 25;
    doc.text('-', xPos, yPos); // Package - not available
    xPos += 8;
    doc.text('300490', xPos, yPos); // Default HSN
    xPos += 9;
    doc.text((item.batchNumber || '-').substring(0, 8), xPos, yPos);
    xPos += 11;
    // Expiry Date
    if (item.expiryDate) {
      let expDate: Date;
      if (item.expiryDate instanceof Date) {
        expDate = item.expiryDate;
      } else if (item.expiryDate && typeof item.expiryDate.toDate === 'function') {
        expDate = item.expiryDate.toDate();
      } else if (typeof item.expiryDate === 'string' || typeof item.expiryDate === 'number') {
        expDate = new Date(item.expiryDate);
      } else {
        expDate = new Date();
      }
      doc.text(format(expDate, 'MM/yy'), xPos, yPos);
    } else {
      doc.text('-', xPos, yPos);
    }
    xPos += 7;
    doc.text(quantity.toFixed(1), xPos, yPos);
    xPos += 6;
    doc.text(freeQuantity > 0 ? freeQuantity.toFixed(1) : '0.0', xPos, yPos);
    xPos += 6;
    doc.text(totalQty.toFixed(0), xPos, yPos);
    xPos += 6;
    doc.text(mrp > 0 ? mrp.toFixed(2) : '-', xPos, yPos);
    xPos += 8;
    doc.text(price.toFixed(2), xPos, yPos);
    xPos += 8;
    doc.text(discountPercentage > 0 ? discountPercentage.toFixed(2) : '0.00', xPos, yPos);
    xPos += 7;
    doc.text(sgstAmount.toFixed(2), xPos, yPos);
    xPos += 7;
    doc.text(cgstAmount.toFixed(2), xPos, yPos);
    xPos += 7;
    doc.text(itemAmount.toFixed(2), xPos, yPos);
    
    yPos += 5;
  });
  
  // Financial Summary (Right Side)
  yPos = Math.max(yPos + 5, 260);
  const billDiscount = invoice.discount || 0;
  const calculatedTotal = totalSubTotal - totalProductDiscount - billDiscount + totalSGST + totalCGST;
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  doc.text('SUB TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`${totalSubTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('PRODUCT DISCOUNT:', 130, yPos, { align: 'right' });
  doc.text(`${totalProductDiscount.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('BILL DISCOUNT:', 130, yPos, { align: 'right' });
  doc.text(`${billDiscount.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('SGST:', 130, yPos, { align: 'right' });
  doc.text(`${totalSGST.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('CGST:', 130, yPos, { align: 'right' });
  doc.text(`${totalCGST.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('Roundoff:', 130, yPos, { align: 'right' });
  doc.text(`${roundoff.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GRAND TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`${grandTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  // GST Breakdown (Left Side)
  yPos = Math.max(yPos + 10, 260);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const avgGstRate = invoice.items.length > 0 
    ? invoice.items.reduce((sum, item) => sum + (item.gstRate || 0), 0) / invoice.items.length 
    : 18;
  const taxableAmount = totalSubTotal - totalProductDiscount - billDiscount;
  const cgst = totalCGST;
  const sgst = totalSGST;
  
  doc.text(`Amt ${avgGstRate.toFixed(0)}%: ${taxableAmount.toFixed(2)}`, 20, yPos);
  yPos += 5;
  doc.text(`CGST ${(avgGstRate / 2).toFixed(1)}%: ${cgst.toFixed(2)}`, 20, yPos);
  yPos += 5;
  doc.text(`SGST ${(avgGstRate / 2).toFixed(1)}%: ${sgst.toFixed(2)}`, 20, yPos);
  
  // Amount in Words
  yPos += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const amountInWords = numberToWords(grandTotal);
  doc.text(`Grand Total in words: Rs. ${amountInWords}`, 20, yPos);
  
  // Terms & Conditions
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Terms & Conditions:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 5;
  doc.setFontSize(7);
  doc.text('Bills not paid by the due date will attract 24% interest.', 20, yPos);
  yPos += 4;
  doc.text('All disputes are subject to INDORE Jurisdiction only.', 20, yPos);
  yPos += 4;
  doc.text('Prescribed Sales Tax declaration will be given.', 20, yPos);
  yPos += 4;
  doc.text('Cold storage items will not be returned.', 20, yPos);
  
  // Signature Section
  yPos = 280;
  doc.setFontSize(8);
  doc.text('For SimpliPharma', 20, yPos);
  yPos += 15;
  doc.text('Authorised Signatory', 20, yPos);
  
  // Footer
  doc.setFontSize(7);
  doc.text('This is a computer generated invoice.', 105, 290, { align: 'center' });
  
  // Save PDF
  doc.save(`purchase-invoice-${invoice.invoiceNumber}.pdf`);
};
