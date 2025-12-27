import jsPDF from 'jspdf';
import { Order } from '../types';
import { format } from 'date-fns';

export const generateOrderInvoice = (order: Order) => {
  const doc = new jsPDF();
  
  // Company Header
  doc.setFontSize(20);
  doc.text('TAX INVOICE', 105, 20, { align: 'center' });
  
  // Company Details (Left)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('SimpliPharma', 20, 35);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Address Line 1', 20, 42);
  doc.text('Address Line 2', 20, 48);
  doc.text('City, State - PIN', 20, 54);
  doc.text('GSTIN: XXXXXX', 20, 60);
  doc.text('Phone: +91-XXXXXXXXXX', 20, 66);
  
  // Invoice Details (Right)
  doc.setFontSize(10);
  doc.text(`Invoice No: ${order.id.substring(0, 12)}`, 140, 42);
  doc.text(`Date: ${format(order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate), 'dd/MM/yyyy')}`, 140, 48);
  if (order.trackingNumber) {
    doc.text(`Tracking: ${order.trackingNumber}`, 140, 54);
  }
  
  // Bill To Section
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Bill To:', 20, 80);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(order.retailerName || order.retailerEmail || 'N/A', 20, 87);
  if (order.deliveryAddress) {
    const addressLines = doc.splitTextToSize(order.deliveryAddress, 60);
    doc.text(addressLines, 20, 93);
  }
  
  // Items Table Header
  let yPos = 115;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(240, 240, 240);
  doc.rect(20, yPos - 5, 170, 8, 'F');
  doc.text('S.No', 22, yPos);
  doc.text('Item Name', 35, yPos);
  doc.text('Batch', 100, yPos);
  doc.text('Qty', 125, yPos);
  doc.text('Rate', 140, yPos);
  doc.text('Amount', 165, yPos);
  
  // Items
  doc.setFont('helvetica', 'normal');
  yPos = 125;
  order.medicines.forEach((item, index) => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }
    doc.text((index + 1).toString(), 22, yPos);
    const itemName = doc.splitTextToSize(item.name, 60);
    doc.text(itemName, 35, yPos);
    doc.text(item.batchNumber || '-', 100, yPos);
    doc.text(item.quantity.toString(), 125, yPos);
    doc.text(`₹${item.price.toFixed(2)}`, 140, yPos);
    doc.text(`₹${(item.price * item.quantity).toFixed(2)}`, 165, yPos);
    yPos += itemName.length * 5 + 2;
  });
  
  // Totals
  yPos = Math.max(yPos + 5, 260);
  doc.setFont('helvetica', 'bold');
  doc.text('Subtotal:', 140, yPos);
  doc.text(`₹${(order.subTotal || order.medicines.reduce((sum, m) => sum + (m.price * m.quantity), 0)).toFixed(2)}`, 165, yPos);
  
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Tax (${order.taxPercentage || 18}%):`, 140, yPos);
  doc.text(`₹${(order.taxAmount || 0).toFixed(2)}`, 165, yPos);
  
  yPos += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Total:', 140, yPos);
  doc.text(`₹${order.totalAmount.toFixed(2)}`, 165, yPos);
  
  // Payment Status
  yPos += 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Payment Status: ${order.paymentStatus || 'Unpaid'}`, 20, yPos);
  if (order.paidAmount) {
    doc.text(`Paid: ₹${order.paidAmount.toFixed(2)}`, 20, yPos + 7);
    doc.text(`Due: ₹${(order.dueAmount || 0).toFixed(2)}`, 20, yPos + 14);
  }
  
  // Footer
  yPos = 280;
  doc.setFontSize(8);
  doc.text('This is a computer generated invoice.', 105, yPos, { align: 'center' });
  
  // Save PDF
  doc.save(`invoice-${order.id.substring(0, 8)}.pdf`);
};

