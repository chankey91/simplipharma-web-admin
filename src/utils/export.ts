import * as XLSX from 'xlsx';
import { Order, User } from '../types';
import { getMedicineById } from '../services/inventory';

// Helper function to extract town and district from address
const parseAddress = (address?: string): { town: string; district: string } => {
  if (!address) return { town: 'N/A', district: 'N/A' };
  
  // Try to parse address - this is a basic implementation
  // You may need to adjust based on your address format
  const addressParts = address.split(',').map(s => s.trim());
  let town = 'N/A';
  let district = 'N/A';
  
  // Common patterns: address usually has town and district
  // This is a basic parser - adjust based on your data format
  if (addressParts.length >= 2) {
    town = addressParts[addressParts.length - 2] || 'N/A';
    district = addressParts[addressParts.length - 1] || 'N/A';
  } else if (addressParts.length === 1) {
    town = addressParts[0] || 'N/A';
  }
  
  return { town, district };
};

export const exportPendingOrdersByStore = async (
  orders: Order[],
  stores: User[],
  filename: string = 'pending-orders-by-store'
) => {
  // Filter only pending orders
  const pendingOrders = orders.filter(order => order.status === 'Pending');
  
  console.log(`Total orders: ${orders.length}, Pending orders: ${pendingOrders.length}`);
  
  if (pendingOrders.length === 0) {
    alert('No pending orders found');
    return;
  }

  // Get all medicines with manufacturer info
  const medicineMap = new Map<string, string>();
  const allMedicineIds = new Set<string>();
  
  // Collect all medicine IDs
  for (const order of pendingOrders) {
    for (const medicine of order.medicines) {
      if (medicine.medicineId) {
        allMedicineIds.add(medicine.medicineId);
      }
    }
  }
  
  // Fetch manufacturer info for all medicines
  for (const medicineId of allMedicineIds) {
    if (!medicineMap.has(medicineId)) {
      try {
        const med = await getMedicineById(medicineId);
        if (med) {
          medicineMap.set(medicineId, med.manufacturer);
        }
      } catch (error) {
        console.warn(`Failed to fetch medicine ${medicineId}:`, error);
      }
    }
  }

  // Aggregate medicines by store and medicine name
  // Key: storeId|medicineName|manufacturer
  // Value: { store, quantity, orderNumbers: Set }
  const medicineAggregate = new Map<string, {
    store: User | null;
    storeId: string;
    medicineName: string;
    manufacturer: string;
    quantity: number;
    orderNumbers: Set<string>;
  }>();

  for (const order of pendingOrders) {
    const store = stores.find(s => s.id === order.retailerId) || null;
    const storeId = order.retailerId || 'unknown';
    
    // Get order number (invoice number or order ID)
    const orderNumber = order.invoiceNumber || `ORD-${order.id.substring(0, 8).toUpperCase()}`;
    
    for (const medicine of order.medicines) {
      const manufacturer = medicineMap.get(medicine.medicineId) || 'N/A';
      const key = `${storeId}|${medicine.name}|${manufacturer}`;
      
      if (medicineAggregate.has(key)) {
        const existing = medicineAggregate.get(key)!;
        existing.quantity += medicine.quantity || 0;
        existing.orderNumbers.add(orderNumber);
      } else {
        medicineAggregate.set(key, {
          store,
          storeId,
          medicineName: medicine.name,
          manufacturer,
          quantity: medicine.quantity || 0,
          orderNumbers: new Set([orderNumber])
        });
      }
    }
  }

  // Convert to array and sort by store name, then by medicine name
  const rows = Array.from(medicineAggregate.entries())
    .map(([key, data]) => {
      const { town, district } = parseAddress(data.store?.address);
      return {
        storeCode: data.store?.storeCode || 'na',
        shopName: data.store?.shopName || data.store?.displayName || 'N/A',
        town: town,
        district: district,
        email: data.store?.email || 'N/A',
        medicineName: data.medicineName,
        quantity: data.quantity,
        manufacturer: data.manufacturer,
        orderNumbers: Array.from(data.orderNumbers).sort().join(', '), // Comma-separated, sorted
        storeId: data.storeId, // For sorting
        shopNameForSort: data.store?.shopName || data.store?.displayName || '' // For sorting
      };
    })
    .sort((a, b) => {
      // First sort by shop name
      const shopCompare = a.shopNameForSort.localeCompare(b.shopNameForSort);
      if (shopCompare !== 0) return shopCompare;
      // Then by medicine name
      return a.medicineName.localeCompare(b.medicineName);
    });

  // Prepare Excel data
  const excelData: any[][] = [
    // Header row
    ['SR', 'Store Code', 'Shop Name', 'Town Name', 'Distrect', 'Email', 'MEDICINES LIST', 'Quantity', 'Manufacturer', 'Order', 'Remark']
  ];

  // Add data rows
  rows.forEach((row, index) => {
    excelData.push([
      index + 1, // Serial number
      row.storeCode,
      row.shopName,
      row.town,
      row.district,
      row.email,
      row.medicineName,
      row.quantity || '', // Empty if quantity is 0
      row.manufacturer,
      row.orderNumbers, // Comma-separated order numbers
      '' // Remark column (empty)
    ]);
  });

  // Create workbook with single sheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  
  // Set column widths
  ws['!cols'] = [
    { wch: 5 },   // SR
    { wch: 12 },  // Store Code
    { wch: 35 },  // Shop Name
    { wch: 15 },  // Town Name
    { wch: 15 },  // Distrect
    { wch: 30 },  // Email
    { wch: 40 },  // MEDICINES LIST
    { wch: 10 },  // Quantity
    { wch: 30 },  // Manufacturer
    { wch: 30 },  // Order
    { wch: 20 },  // Remark
  ];

  // Add sheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Pending Orders');

  // Save the file
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};
