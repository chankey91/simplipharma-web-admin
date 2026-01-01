import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Order, PurchaseInvoice } from '../types';
import { format } from 'date-fns';
import { getVendorById } from '../services/vendors';
import { getUserProfile } from '../services/firebase';

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

// HTML Template for Order Invoice
const getOrderInvoiceHTML = async (order: Order) => {
  const invoiceDate = order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate);
  
  // Calculate totals
  let totalSubTotal = 0;
  let totalProductDiscount = 0;
  let totalGST = 0;
  
  const items = order.medicines.map((item, index) => {
    const price = item.price || 0;
    const quantity = item.quantity || 0;
    const freeQuantity = 0; // Order items don't have free quantity typically
    const totalQty = quantity + freeQuantity;
    const mrp = (item as any).mrp || price || 0;
    const discountPercentage = 0; // Can be from item if available
    const gstRate = order.taxPercentage || 5;
    
    // Calculate amounts
    const baseAmount = price * quantity;
    const discountAmount = (baseAmount * discountPercentage) / 100;
    const amountAfterDiscount = baseAmount - discountAmount;
    const sgstRate = gstRate / 2;
    const cgstRate = gstRate / 2;
    const sgstAmount = (amountAfterDiscount * sgstRate) / 100;
    const cgstAmount = (amountAfterDiscount * cgstRate) / 100;
    const itemGST = sgstAmount + cgstAmount;
    const itemAmount = amountAfterDiscount + itemGST;
    
    totalSubTotal += baseAmount;
    totalProductDiscount += discountAmount;
    totalGST += itemGST;
    
    // Format expiry date
    let expDate = '-';
    if (item.expiryDate) {
      let exp: Date;
      if (item.expiryDate instanceof Date) {
        exp = item.expiryDate;
      } else if (item.expiryDate && typeof item.expiryDate.toDate === 'function') {
        exp = item.expiryDate.toDate();
      } else if (typeof item.expiryDate === 'string' || typeof item.expiryDate === 'number') {
        exp = new Date(item.expiryDate);
      } else {
        exp = new Date();
      }
      expDate = format(exp, 'MM/yy');
    }
    
    return {
      sn: index + 1,
      name: item.name || 'Unknown',
      pack: (item as any).packaging || '-',
      hsn: (item as any).hsn || '300490',
      batch: item.batchNumber || '-',
      exp: expDate,
      qty: quantity.toFixed(1),
      free: freeQuantity > 0 ? freeQuantity.toFixed(1) : '0.0',
      totalQty: totalQty.toFixed(0),
      mrp: mrp > 0 ? mrp.toFixed(2) : '-',
      rate: price.toFixed(2),
      disc: discountPercentage > 0 ? discountPercentage.toFixed(2) : '0.00',
      sgst: `${(gstRate / 2).toFixed(1)}%`, // Show percentage instead of amount
      cgst: `${(gstRate / 2).toFixed(1)}%`, // Show percentage instead of amount
      amount: itemAmount.toFixed(2)
    };
  });
  
  const billDiscount = 0;
  const totalSGST = totalGST / 2;
  const totalCGST = totalGST / 2;
  const calculatedTotal = totalSubTotal - totalProductDiscount - billDiscount + totalGST;
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);
  
  const gstRate = order.taxPercentage || 5;
  const taxableAmount = totalSubTotal - totalProductDiscount - billDiscount;
  
  // Company details
  const company = {
    name: 'SimpliPharma Solution Pvt. Ltd.',
    address: 'AG 50, Scheme No. 74, Indore, Madhya Pradesh. 452010',
    phone: '',
    email: 'pgsbillforward@gmail.com',
    dl: '20B/2876/12/2021,20B/2876/12/2021',
    gstin: '23AALCP3728L1Z4'
  };
  
  // Party/Retailer details - fetch from user if retailerId is available
  let party = {
    name: order.retailerName || order.retailerEmail || 'N/A',
    address: order.deliveryAddress || '',
    state: '',
    phone: '',
    dl: '',
    gstin: ''
  };
  
  // Try to fetch retailer details if retailerId is available
  if (order.retailerId) {
    try {
      const retailer = await getUserProfile(order.retailerId);
      if (retailer) {
        party = {
          name: retailer.shopName || retailer.displayName || retailer.email || party.name,
          address: retailer.address || retailer.location?.address || order.deliveryAddress || party.address,
          state: '', // User doesn't have state field, keep empty
          phone: retailer.phoneNumber || party.phone,
          dl: retailer.licenceNumber || retailer.licenceHolderName || party.dl,
          gstin: retailer.gst || party.gstin
        };
      }
    } catch (error) {
      console.warn('Failed to fetch retailer details:', error);
      // Continue with order data
    }
  }
  
  // Invoice details
  const invoiceData = {
    no: order.id.substring(0, 12),
    date: format(invoiceDate, 'yyyy-MM-dd'),
    dueDate: format(invoiceDate, 'yyyy-MM-dd'),
    user: 'Admin',
    tray: '-'
  };
  
  // Tax summary
  const tax = {
    taxable: taxableAmount.toFixed(2),
    cgst: totalCGST.toFixed(2),
    sgst: totalSGST.toFixed(2),
    rate: gstRate.toFixed(0)
  };
  
  // Summary
  const summary = {
    subTotal: totalSubTotal.toFixed(2),
    discount: totalProductDiscount.toFixed(2),
    sgst: totalSGST.toFixed(2),
    cgst: totalCGST.toFixed(2),
    roundOff: roundoff.toFixed(2),
    grandTotal: grandTotal.toFixed(2)
  };
  
  // Generate items HTML
  const itemsHTML = items.map(item => `
    <tr class="center">
      <td>${item.sn}</td>
      <td style="text-align:left">${item.name}</td>
      <td>${item.pack}</td>
      <td>${item.hsn}</td>
      <td>${item.batch}</td>
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
    </tr>
  `).join('');
  
  // Complete HTML template
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Sales GST Invoice</title>
<style>
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
    padding: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  td, th {
    border: 1px solid #000;
    padding: 3px;
    vertical-align: top;
    word-wrap: break-word;
  }
  .no-border td {
    border: none;
  }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: bold; }
  .title  { font-size: 16px; font-weight: bold; text-align: center; }
  @media print {
    body { margin: 0; }
  }
</style>
</head>
<body>
<div class="invoice-box">
<!-- HEADER -->
<table>
  <tr>
    <td width="50%">
      <b>${company.name}</b><br>
      ${company.address}<br>
      Phone: ${company.phone}<br>
      Email: ${company.email}<br><br>
      <b>D.L. No:</b> ${company.dl}<br>
      <b>GSTIN:</b> ${company.gstin}
    </td>
    <td width="50%">
      <b>${party.name}</b><br>
      Party Address: ${party.address}<br>
      State: ${party.state}<br>
      Ph.No: ${party.phone}<br>
      Party D.L No: ${party.dl}<br>
      GST No: ${party.gstin}
    </td>
  </tr>
</table>
<!-- INVOICE INFO -->
<table>
  <tr>
    <td colspan="2" class="title">SALES GST INVOICE</td>
    <td>
      Invoice No: ${invoiceData.no}<br>
      Due Date: ${invoiceData.dueDate}<br>
      User: ${invoiceData.user}
    </td>
    <td>
      Date: ${invoiceData.date}<br>
      Tray No: ${invoiceData.tray}
    </td>
  </tr>
</table>
<!-- ITEM TABLE -->
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
    ${itemsHTML}
  </tbody>
</table>
<!-- TOTAL SECTION -->
<table>
  <tr>
    <td width="70%">
      <b>Tax Summary</b><br>
      Amt ${tax.rate}%: ${tax.taxable} |
      CGST ${(gstRate / 2).toFixed(1)}%: ${tax.cgst} |
      SGST ${(gstRate / 2).toFixed(1)}%: ${tax.sgst}
    </td>
    <td width="30%">
      <table class="no-border">
        <tr><td>SUB TOTAL</td><td class="right">${summary.subTotal}</td></tr>
        <tr><td>PRODUCT DISCOUNT</td><td class="right">${summary.discount}</td></tr>
        <tr><td>BILL DISCOUNT</td><td class="right">${billDiscount.toFixed(2)}</td></tr>
        <tr><td>SGST</td><td class="right">${summary.sgst}</td></tr>
        <tr><td>CGST</td><td class="right">${summary.cgst}</td></tr>
        <tr><td>Round Off</td><td class="right">${summary.roundOff}</td></tr>
        <tr class="bold">
          <td>GRAND TOTAL</td>
          <td class="right">${summary.grandTotal}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<!-- FOOTER -->
<table>
  <tr>
    <td width="60%">
      <b>Terms & Conditions</b><br>
      Bills not paid by due date will attract 24% interest.<br>
      Subject to Indore jurisdiction only.<br>
      Cold storage items will not be returned.
    </td>
    <td width="40%" class="center">
      For ${company.name}<br><br><br>
      <b>Authorised Signatory</b>
    </td>
  </tr>
</table>
</div>
</body>
</html>
  `;
};

export const generateOrderInvoice = async (order: Order) => {
  const html = await getOrderInvoiceHTML(order);
  
  // Create a temporary element to render HTML
  const element = document.createElement('div');
  element.innerHTML = html;
  element.style.width = '210mm'; // A4 width
  element.style.padding = '0';
  element.style.margin = '0';
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  element.style.top = '0';
  document.body.appendChild(element);
  
  try {
    // Convert HTML to canvas
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      width: element.scrollWidth,
      height: element.scrollHeight
    });
    
    // Convert canvas to image
    const imgData = canvas.toDataURL('image/png');
    
    // Calculate PDF dimensions
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    
    // Create PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    let position = 0;
    
    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    
    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    
    // Save PDF
    pdf.save(`order-invoice-${order.id}.pdf`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Failed to generate invoice. Please try again.');
  } finally {
    // Clean up
    document.body.removeChild(element);
  }
};

// HTML Template for Purchase Invoice
const getInvoiceHTML = async (invoice: PurchaseInvoice) => {
  const invoiceDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate);
  
  // Calculate totals
  let totalSubTotal = 0;
  let totalProductDiscount = 0;
  let totalGST = 0;
  
  const items = invoice.items.map((item, index) => {
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
    const sgstRate = gstRate / 2;
    const cgstRate = gstRate / 2;
    const sgstAmount = (amountAfterDiscount * sgstRate) / 100;
    const cgstAmount = (amountAfterDiscount * cgstRate) / 100;
    const itemGST = sgstAmount + cgstAmount;
    const itemAmount = amountAfterDiscount + itemGST;
    
    totalSubTotal += baseAmount;
    totalProductDiscount += discountAmount;
    totalGST += itemGST;
    
    // Format expiry date
    let expDate = '-';
    if (item.expiryDate) {
      let exp: Date;
      if (item.expiryDate instanceof Date) {
        exp = item.expiryDate;
      } else if (item.expiryDate && typeof item.expiryDate.toDate === 'function') {
        exp = item.expiryDate.toDate();
      } else if (typeof item.expiryDate === 'string' || typeof item.expiryDate === 'number') {
        exp = new Date(item.expiryDate);
      } else {
        exp = new Date();
      }
      expDate = format(exp, 'MM/yy');
    }
    
    return {
      sn: index + 1,
      name: item.medicineName || 'Unknown',
      pack: (item as any).packaging || '-',
      hsn: (item as any).hsn || '300490',
      batch: item.batchNumber || '-',
      exp: expDate,
      qty: quantity.toFixed(1),
      free: freeQuantity > 0 ? freeQuantity.toFixed(1) : '0.0',
      totalQty: totalQty.toFixed(0),
      mrp: mrp > 0 ? mrp.toFixed(2) : '-',
      rate: price.toFixed(2),
      disc: discountPercentage > 0 ? discountPercentage.toFixed(2) : '0.00',
      sgst: `${(gstRate / 2).toFixed(1)}%`, // Show percentage instead of amount
      cgst: `${(gstRate / 2).toFixed(1)}%`, // Show percentage instead of amount
      amount: itemAmount.toFixed(2)
    };
  });
  
  const billDiscount = invoice.discount || 0;
  const totalSGST = totalGST / 2;
  const totalCGST = totalGST / 2;
  const calculatedTotal = totalSubTotal - totalProductDiscount - billDiscount + totalGST;
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);
  
  const avgGstRate = invoice.items.length > 0 
    ? invoice.items.reduce((sum, item) => sum + (item.gstRate || 0), 0) / invoice.items.length 
    : 18;
  const taxableAmount = totalSubTotal - totalProductDiscount - billDiscount;
  
  // Company details
  const company = {
    name: 'SimpliPharma Solution Pvt. Ltd.',
    address: 'AG 50, Scheme No. 74, Indore, Madhya Pradesh. 452010',
    phone: '',
    email: 'pgsbillforward@gmail.com',
    dl: '20B/2876/12/2021,20B/2876/12/2021',
    gstin: '23AALCP3728L1Z4'
  };
  
  // Party/Vendor details - fetch from vendor if vendorId is available
  let party = {
    name: invoice.vendorName || 'N/A',
    address: (invoice as any).vendorAddress || '',
    state: (invoice as any).vendorState || '',
    phone: (invoice as any).vendorPhone || (invoice as any).phoneNumber || '',
    dl: (invoice as any).vendorDL || (invoice as any).drugLicenseNumber || '',
    gstin: (invoice as any).vendorGST || (invoice as any).gstNumber || ''
  };
  
  // Try to fetch vendor details if vendorId is available
  if (invoice.vendorId) {
    try {
      const vendor = await getVendorById(invoice.vendorId);
      if (vendor) {
        party = {
          name: vendor.vendorName || party.name,
          address: vendor.address || party.address,
          state: '', // Vendor doesn't have state field, keep empty or extract from address
          phone: vendor.phoneNumber || party.phone,
          dl: vendor.drugLicenseNumber || party.dl,
          gstin: vendor.gstNumber || party.gstin
        };
      }
    } catch (error) {
      console.warn('Failed to fetch vendor details:', error);
      // Continue with invoice data
    }
  }
  
  // Invoice details
  const invoiceData = {
    no: invoice.invoiceNumber,
    date: format(invoiceDate, 'yyyy-MM-dd'),
    dueDate: format(invoiceDate, 'yyyy-MM-dd'),
    user: invoice.createdBy || 'Admin',
    tray: (invoice as any).trayNo || '-'
  };
  
  // Tax summary
  const tax = {
    taxable: taxableAmount.toFixed(2),
    cgst: totalCGST.toFixed(2),
    sgst: totalSGST.toFixed(2),
    rate: avgGstRate.toFixed(0)
  };
  
  // Summary
  const summary = {
    subTotal: totalSubTotal.toFixed(2),
    discount: totalProductDiscount.toFixed(2),
    sgst: totalSGST.toFixed(2),
    cgst: totalCGST.toFixed(2),
    roundOff: roundoff.toFixed(2),
    grandTotal: grandTotal.toFixed(2)
  };
  
  // Generate items HTML
  const itemsHTML = items.map(item => `
    <tr class="center">
      <td>${item.sn}</td>
      <td style="text-align:left">${item.name}</td>
      <td>${item.pack}</td>
      <td>${item.hsn}</td>
      <td>${item.batch}</td>
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
    </tr>
  `).join('');
  
  // Complete HTML template
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Sales GST Invoice</title>
<style>
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
    padding: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  td, th {
    border: 1px solid #000;
    padding: 3px;
    vertical-align: top;
    word-wrap: break-word;
  }
  .no-border td {
    border: none;
  }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: bold; }
  .title  { font-size: 16px; font-weight: bold; text-align: center; }
  @media print {
    body { margin: 0; }
  }
</style>
</head>
<body>
<div class="invoice-box">
<!-- HEADER -->
<table>
  <tr>
    <td width="50%">
      <b>${company.name}</b><br>
      ${company.address}<br>
      Phone: ${company.phone}<br>
      Email: ${company.email}<br><br>
      <b>D.L. No:</b> ${company.dl}<br>
      <b>GSTIN:</b> ${company.gstin}
    </td>
    <td width="50%">
      <b>${party.name}</b><br>
      Party Address: ${party.address}<br>
      State: ${party.state}<br>
      Ph.No: ${party.phone}<br>
      Party D.L No: ${party.dl}<br>
      GST No: ${party.gstin}
    </td>
  </tr>
</table>
<!-- INVOICE INFO -->
<table>
  <tr>
    <td colspan="2" class="title">PURCHASE GST INVOICE</td>
    <td>
      Invoice No: ${invoiceData.no}<br>
      Due Date: ${invoiceData.dueDate}<br>
      User: ${invoiceData.user}
    </td>
    <td>
      Date: ${invoiceData.date}<br>
      Tray No: ${invoiceData.tray}
    </td>
  </tr>
</table>
<!-- ITEM TABLE -->
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
    ${itemsHTML}
  </tbody>
</table>
<!-- TOTAL SECTION -->
<table>
  <tr>
    <td width="70%">
      <b>Tax Summary</b><br>
      Amt ${tax.rate}%: ${tax.taxable} |
      CGST ${(avgGstRate / 2).toFixed(1)}%: ${tax.cgst} |
      SGST ${(avgGstRate / 2).toFixed(1)}%: ${tax.sgst}
    </td>
    <td width="30%">
      <table class="no-border">
        <tr><td>SUB TOTAL</td><td class="right">${summary.subTotal}</td></tr>
        <tr><td>PRODUCT DISCOUNT</td><td class="right">${summary.discount}</td></tr>
        <tr><td>BILL DISCOUNT</td><td class="right">${billDiscount.toFixed(2)}</td></tr>
        <tr><td>SGST</td><td class="right">${summary.sgst}</td></tr>
        <tr><td>CGST</td><td class="right">${summary.cgst}</td></tr>
        <tr><td>Round Off</td><td class="right">${summary.roundOff}</td></tr>
        <tr class="bold">
          <td>GRAND TOTAL</td>
          <td class="right">${summary.grandTotal}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<!-- FOOTER -->
<table>
  <tr>
    <td width="60%">
      <b>Terms & Conditions</b><br>
      Bills not paid by due date will attract 24% interest.<br>
      Subject to Indore jurisdiction only.<br>
      Cold storage items will not be returned.
    </td>
    <td width="40%" class="center">
      For ${company.name}<br><br><br>
      <b>Authorised Signatory</b>
    </td>
  </tr>
</table>
</div>
</body>
</html>
  `;
};

export const generatePurchaseInvoice = async (invoice: PurchaseInvoice) => {
  const html = await getInvoiceHTML(invoice);
  
  // Create a temporary element to render HTML
  const element = document.createElement('div');
  element.innerHTML = html;
  element.style.width = '210mm'; // A4 width
  element.style.padding = '0';
  element.style.margin = '0';
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  element.style.top = '0';
  document.body.appendChild(element);
  
  try {
    // Convert HTML to canvas
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      width: element.scrollWidth,
      height: element.scrollHeight
    });
    
    // Convert canvas to image
    const imgData = canvas.toDataURL('image/png');
    
    // Calculate PDF dimensions
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    
    // Create PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    let position = 0;
    
    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    
    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    
    // Save PDF
    pdf.save(`purchase-invoice-${invoice.invoiceNumber}.pdf`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Failed to generate invoice. Please try again.');
  } finally {
    // Clean up
    document.body.removeChild(element);
  }
};
