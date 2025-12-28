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
  
  // Company Details (Left Side)
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SimpliPharma', 20, 20);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  // You can update these with actual company details
  doc.text('Address Line 1', 20, 28);
  doc.text('Address Line 2', 20, 34);
  doc.text('City, State - PIN Code', 20, 40);
  doc.text('Email: info@simplipharma.com', 20, 46);
  doc.text('D.L.No.: XXXXXX/XXXX', 20, 52);
  doc.text('GSTIN: XXXXXX', 20, 58);
  
  // Invoice Details (Right Side)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('TAX INVOICE', 150, 20, { align: 'right' });
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const invoiceDate = order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate);
  doc.text(`Invoice No: ${order.id.substring(0, 12)}`, 150, 28, { align: 'right' });
  doc.text(`Date: ${format(invoiceDate, 'dd/MM/yyyy')}`, 150, 34, { align: 'right' });
  doc.text(`Due Date: ${format(invoiceDate, 'dd/MM/yyyy')}`, 150, 40, { align: 'right' });
  doc.text('USER: Admin', 150, 46, { align: 'right' });
  // Tray No can be added if available
  
  // Bill To Section
  let yPos = 70;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Bill To:', 20, yPos);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  yPos += 7;
  doc.text(order.retailerName || order.retailerEmail || 'N/A', 20, yPos);
  if (order.deliveryAddress) {
    yPos += 6;
    const addressLines = doc.splitTextToSize(order.deliveryAddress, 50);
    doc.text(addressLines, 20, yPos);
    yPos += addressLines.length * 5;
  }
  // Add more retailer details if available (State, Phone, D.L. No., GST No.)
  
  // Items Table Header
  yPos = Math.max(yPos + 10, 100);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(220, 220, 220);
  doc.rect(10, yPos - 4, 190, 5, 'F');
  
  // Table columns: SN, Product Name, Package, HSN, Batch No, EXP, QTY, FREE QTY, OMRP, M.R.P., RATE, DISC, GST, AMOUNT
  let xPos = 11;
  doc.text('SN', xPos, yPos);
  xPos += 7;
  doc.text('Product Name', xPos, yPos);
  xPos += 32;
  doc.text('HSN', xPos, yPos);
  xPos += 11;
  doc.text('Batch', xPos, yPos);
  xPos += 14;
  doc.text('EXP', xPos, yPos);
  xPos += 9;
  doc.text('QTY', xPos, yPos);
  xPos += 9;
  doc.text('RATE', xPos, yPos);
  xPos += 11;
  doc.text('DISC', xPos, yPos);
  xPos += 9;
  doc.text('GST', xPos, yPos);
  xPos += 9;
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
    x += 7;
    doc.text('Product Name', x, y);
    x += 32;
    doc.text('HSN', x, y);
    x += 11;
    doc.text('Batch', x, y);
    x += 14;
    doc.text('EXP', x, y);
    x += 9;
    doc.text('QTY', x, y);
    x += 9;
    doc.text('RATE', x, y);
    x += 11;
    doc.text('DISC', x, y);
    x += 9;
    doc.text('GST', x, y);
    x += 9;
    doc.text('AMOUNT', x, y);
    doc.setFont('helvetica', 'normal');
  };
  
  order.medicines.forEach((item, index) => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
      redrawHeader(yPos);
      yPos += 5;
    }
    
    const price = item.price || 0;
    const quantity = item.quantity || 0;
    const amount = price * quantity;
    const discount = 0; // Can be calculated if discount is stored
    const gstRate = order.taxPercentage || 18;
    
    xPos = 11;
    doc.text((index + 1).toString(), xPos, yPos);
    xPos += 7;
    const itemName = (item.name || 'Unknown').substring(0, 18);
    doc.text(itemName, xPos, yPos);
    xPos += 32;
    doc.text('300490', xPos, yPos); // Default HSN, can be from medicine data
    xPos += 11;
    doc.text((item.batchNumber || '-').substring(0, 8), xPos, yPos);
    xPos += 14;
    if (item.expiryDate) {
      const expDate = item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate();
      doc.text(format(expDate, 'MM/yy'), xPos, yPos);
    } else {
      doc.text('-', xPos, yPos);
    }
    xPos += 9;
    doc.text(quantity.toFixed(2), xPos, yPos);
    xPos += 9;
    doc.text(price.toFixed(2), xPos, yPos);
    xPos += 11;
    doc.text(discount.toFixed(2), xPos, yPos);
    xPos += 9;
    doc.text(`${gstRate}%`, xPos, yPos);
    xPos += 9;
    doc.text(amount.toFixed(2), xPos, yPos);
    
    yPos += 4;
  });
  
  // Financial Summary
  yPos = Math.max(yPos + 5, 260);
  const calculatedSubTotal = order.subTotal || order.medicines.reduce((sum, m) => sum + ((m.price || 0) * (m.quantity || 0)), 0);
  const productDiscount = 0; // Can be calculated from items
  const billDiscount = 0; // Can be from order
  const calculatedTax = order.taxAmount || 0;
  const calculatedTotal = order.totalAmount || (calculatedSubTotal + calculatedTax);
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  doc.text('SUB TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`₹${calculatedSubTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('PRODUCT DISCOUNT:', 130, yPos, { align: 'right' });
  doc.text(`₹${productDiscount.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('BILL DISCOUNT:', 130, yPos, { align: 'right' });
  doc.text(`₹${billDiscount.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('GST:', 130, yPos, { align: 'right' });
  doc.text(`₹${calculatedTax.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('Roundoff:', 130, yPos, { align: 'right' });
  doc.text(`₹${roundoff.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GRAND TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`₹${grandTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  // GST Breakdown
  yPos += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const gstRate = order.taxPercentage || 18;
  const taxableAmount = calculatedSubTotal - productDiscount - billDiscount;
  const cgst = calculatedTax / 2;
  const sgst = calculatedTax / 2;
  
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
  doc.text(`Rs. ${amountInWords}`, 20, yPos);
  
  // Terms & Conditions
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Terms & Conditions:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 5;
  doc.setFontSize(7);
  doc.text('1. Bills not paid by the due date will attract interest as per terms.', 20, yPos);
  yPos += 4;
  doc.text('2. All disputes are subject to jurisdiction only.', 20, yPos);
  yPos += 4;
  doc.text('3. Prescribed Sales Tax declaration will be given.', 20, yPos);
  yPos += 4;
  doc.text('4. Both the MRPs are for reference. Cold storage items will not be returned.', 20, yPos);
  
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
  
  // Company Details (Left Side)
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SimpliPharma', 20, 20);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  // You can update these with actual company details
  doc.text('Address Line 1', 20, 28);
  doc.text('Address Line 2', 20, 34);
  doc.text('City, State - PIN Code', 20, 40);
  doc.text('Email: info@simplipharma.com', 20, 46);
  doc.text('D.L.No.: XXXXXX/XXXX', 20, 52);
  doc.text('GSTIN: XXXXXX', 20, 58);
  
  // Invoice Details (Right Side)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('PURCHASE INVOICE', 150, 20, { align: 'right' });
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const invoiceDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate);
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, 150, 28, { align: 'right' });
  doc.text(`Date: ${format(invoiceDate, 'dd/MM/yyyy')}`, 150, 34, { align: 'right' });
  doc.text(`Due Date: ${format(invoiceDate, 'dd/MM/yyyy')}`, 150, 40, { align: 'right' });
  doc.text('USER: Admin', 150, 46, { align: 'right' });
  
  // Vendor Details Section
  let yPos = 70;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Vendor Details:', 20, yPos);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  yPos += 7;
  doc.text(invoice.vendorName || 'N/A', 20, yPos);
  // Add more vendor details if available
  
  // Items Table Header
  yPos = Math.max(yPos + 10, 100);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(220, 220, 220);
  doc.rect(10, yPos - 4, 190, 5, 'F');
  
  // Table columns: SN, Product Name, HSN, Batch No, EXP, QTY, RATE, MRP, AMOUNT
  let xPos = 11;
  doc.text('SN', xPos, yPos);
  xPos += 7;
  doc.text('Product Name', xPos, yPos);
  xPos += 35;
  doc.text('HSN', xPos, yPos);
  xPos += 11;
  doc.text('Batch', xPos, yPos);
  xPos += 14;
  doc.text('EXP', xPos, yPos);
  xPos += 9;
  doc.text('QTY', xPos, yPos);
  xPos += 9;
  doc.text('RATE', xPos, yPos);
  xPos += 11;
  doc.text('MRP', xPos, yPos);
  xPos += 11;
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
    x += 7;
    doc.text('Product Name', x, y);
    x += 35;
    doc.text('HSN', x, y);
    x += 11;
    doc.text('Batch', x, y);
    x += 14;
    doc.text('EXP', x, y);
    x += 9;
    doc.text('QTY', x, y);
    x += 9;
    doc.text('RATE', x, y);
    x += 11;
    doc.text('MRP', x, y);
    x += 11;
    doc.text('AMOUNT', x, y);
    doc.setFont('helvetica', 'normal');
  };
  
  invoice.items.forEach((item, index) => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
      redrawHeader(yPos);
      yPos += 5;
    }
    
    const price = item.purchasePrice || 0;
    const quantity = item.quantity || 0;
    const amount = item.totalAmount || (price * quantity);
    const mrp = item.mrp || 0;
    
    xPos = 11;
    doc.text((index + 1).toString(), xPos, yPos);
    xPos += 7;
    const itemName = (item.medicineName || 'Unknown').substring(0, 20);
    doc.text(itemName, xPos, yPos);
    xPos += 35;
    doc.text('300490', xPos, yPos); // Default HSN, can be from medicine data
    xPos += 11;
    doc.text((item.batchNumber || '-').substring(0, 8), xPos, yPos);
    xPos += 14;
    if (item.expiryDate) {
      const expDate = item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate();
      doc.text(format(expDate, 'MM/yy'), xPos, yPos);
    } else {
      doc.text('-', xPos, yPos);
    }
    xPos += 9;
    doc.text(quantity.toFixed(2), xPos, yPos);
    xPos += 9;
    doc.text(price.toFixed(2), xPos, yPos);
    xPos += 11;
    doc.text(mrp > 0 ? mrp.toFixed(2) : '-', xPos, yPos);
    xPos += 11;
    doc.text(amount.toFixed(2), xPos, yPos);
    
    yPos += 4;
  });
  
  // Financial Summary
  yPos = Math.max(yPos + 5, 260);
  const calculatedSubTotal = invoice.subTotal || 0;
  const discount = invoice.discount || 0;
  const calculatedTax = invoice.taxAmount || 0;
  const calculatedTotal = invoice.totalAmount || (calculatedSubTotal + calculatedTax - discount);
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  doc.text('SUB TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`₹${calculatedSubTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  if (discount > 0) {
    yPos += 6;
    doc.text('DISCOUNT:', 130, yPos, { align: 'right' });
    doc.text(`-₹${discount.toFixed(2)}`, 190, yPos, { align: 'right' });
  }
  
  yPos += 6;
  doc.text('GST:', 130, yPos, { align: 'right' });
  doc.text(`₹${calculatedTax.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.text('Roundoff:', 130, yPos, { align: 'right' });
  doc.text(`₹${roundoff.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  yPos += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GRAND TOTAL:', 130, yPos, { align: 'right' });
  doc.text(`₹${grandTotal.toFixed(2)}`, 190, yPos, { align: 'right' });
  
  // GST Breakdown
  yPos += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const gstRate = invoice.taxPercentage || 18;
  const taxableAmount = calculatedSubTotal - discount;
  const cgst = calculatedTax / 2;
  const sgst = calculatedTax / 2;
  
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
  doc.text(`Rs. ${amountInWords}`, 20, yPos);
  
  // Payment Status
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Payment Status:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 5;
  doc.text(invoice.paymentStatus || 'Unpaid', 20, yPos);
  
  // Notes
  if (invoice.notes) {
    yPos += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Notes:', 20, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    yPos += 5;
    const notesLines = doc.splitTextToSize(invoice.notes, 80);
    doc.text(notesLines, 20, yPos);
  }
  
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
