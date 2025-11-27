import * as XLSX from 'xlsx';
import { Order, Medicine } from '../types';

export const exportOrdersToExcel = (orders: Order[], filename: string = 'orders') => {
  const data = orders.map(order => ({
    'Order ID': order.id.substring(0, 8),
    'Date': order.orderDate instanceof Date 
      ? order.orderDate.toLocaleDateString()
      : new Date(order.orderDate).toLocaleDateString(),
    'Retailer': order.retailerEmail || 'N/A',
    'Status': order.status,
    'Items': order.medicines.length,
    'Amount': order.totalAmount,
    'Address': order.deliveryAddress || 'N/A',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

export const exportInventoryToExcel = (medicines: Medicine[], filename: string = 'inventory') => {
  const data = medicines.map(medicine => ({
    'Code': medicine.code || 'N/A',
    'Name': medicine.name,
    'Category': medicine.category,
    'Manufacturer': medicine.manufacturer,
    'Stock': medicine.currentStock || medicine.stock || 0,
    'Price': medicine.price,
    'MRP': medicine.mrp || 'N/A',
    'Expiry Date': medicine.expiryDate
      ? medicine.expiryDate instanceof Date
        ? medicine.expiryDate.toLocaleDateString()
        : medicine.expiryDate.toDate().toLocaleDateString()
      : 'N/A',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

