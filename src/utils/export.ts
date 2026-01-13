import * as XLSX from 'xlsx';
import { Order, User } from '../types';
import { getMedicineById } from '../services/inventory';

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

  // Group orders by store
  const ordersByStore = new Map<string, {
    store: User | null;
    orders: Order[];
  }>();

  pendingOrders.forEach(order => {
    const store = stores.find(s => s.id === order.retailerId) || null;
    const storeKey = order.retailerId || 'unknown';
    
    if (!ordersByStore.has(storeKey)) {
      ordersByStore.set(storeKey, {
        store,
        orders: []
      });
    }
    ordersByStore.get(storeKey)!.orders.push(order);
  });

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Process each store
  console.log(`Processing ${ordersByStore.size} stores with orders`);
  
  for (const [storeId, { store, orders: storeOrders }] of ordersByStore.entries()) {
    console.log(`Processing store ${storeId}: ${storeOrders.length} orders`);
    // Get all medicines with manufacturer info
    const medicineMap = new Map<string, string>();
    
    for (const order of storeOrders) {
      for (const medicine of order.medicines) {
        if (medicine.medicineId && !medicineMap.has(medicine.medicineId)) {
          try {
            const med = await getMedicineById(medicine.medicineId);
            if (med) {
              medicineMap.set(medicine.medicineId, med.manufacturer);
            }
          } catch (error) {
            console.warn(`Failed to fetch medicine ${medicine.medicineId}:`, error);
          }
        }
      }
    }

    // Prepare store information data
    const firstOrder = storeOrders[0];
    const storeInfo = [
      ['STORE INFORMATION'],
      ['Store Code', store?.storeCode || 'N/A'],
      ['Shop Name', store?.shopName || store?.displayName || firstOrder?.retailerName || 'N/A'],
      ['Owner', store?.ownerName || store?.displayName || 'N/A'],
      ['Email', store?.email || firstOrder?.retailerEmail || 'N/A'],
      ['Phone', store?.phoneNumber || 'N/A'],
      ['Address', store?.address || 'N/A'],
      ['License Number', store?.licenceNumber || 'N/A'],
      ['GST Number', store?.gst || 'N/A'],
      [], // Empty row
    ];

    // Prepare orders summary data
    const ordersData = [
      ['ORDERS SUMMARY'],
      ['Order Date', 'Order Number', 'Item Count'],
    ];

    storeOrders.forEach(order => {
      const orderDate = order.orderDate instanceof Date 
        ? order.orderDate 
        : new Date(order.orderDate);
      
      // Use order ID if invoice number is not available (pending orders may not have invoice numbers)
      const orderNumber = order.invoiceNumber || `ORD-${order.id.substring(0, 8).toUpperCase()}`;
      
      ordersData.push([
        orderDate.toLocaleDateString('en-GB'), // DD/MM/YYYY format
        orderNumber,
        String(order.medicines.length)
      ]);
    });

    // Add summary row
    ordersData.push([]); // Empty row
    ordersData.push(['Total Orders', String(storeOrders.length), '']);
    ordersData.push([]); // Empty row

    // Prepare medicines list data
    const medicinesData = [
      ['MEDICINES LIST'],
      ['Medicine Name', 'Quantity', 'Manufacturer'],
    ];

    // Aggregate medicines across all orders
    const medicineAggregate = new Map<string, { quantity: number; manufacturer: string }>();
    
    for (const order of storeOrders) {
      for (const medicine of order.medicines) {
        const manufacturer = medicineMap.get(medicine.medicineId) || 'N/A';
        const key = `${medicine.name}|${manufacturer}`;
        
        if (medicineAggregate.has(key)) {
          medicineAggregate.get(key)!.quantity += medicine.quantity || 0;
        } else {
          medicineAggregate.set(key, {
            quantity: medicine.quantity || 0,
            manufacturer: manufacturer
          });
        }
      }
    }

    // Convert to array and sort by name
    Array.from(medicineAggregate.entries())
      .sort((a, b) => a[0].split('|')[0].localeCompare(b[0].split('|')[0]))
      .forEach(([key, data]) => {
        const [name] = key.split('|');
        medicinesData.push([
          name,
          String(data.quantity),
          data.manufacturer
        ]);
      });

    // Add summary row
    const totalQuantity = Array.from(medicineAggregate.values())
      .reduce((sum, m) => sum + m.quantity, 0);
    medicinesData.push([]); // Empty row
    medicinesData.push(['Total Quantity', String(totalQuantity), '']);

    // Combine all data for this store
    const storeSheetData = [
      ...storeInfo,
      ...ordersData,
      ...medicinesData
    ];

    // Create worksheet for this store
    const ws = XLSX.utils.aoa_to_sheet(storeSheetData);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 25 }, // Column A - Store info labels, Medicine Name
      { wch: 30 }, // Column B - Store info values, Order Number, Quantity
      { wch: 25 }, // Column C - Manufacturer
    ];

    // Add sheet to workbook (use store code or name as sheet name)
    const sheetName = (store?.storeCode || store?.shopName || store?.displayName || `Store-${storeId.substring(0, 8)}`)
      .substring(0, 31); // Excel sheet name limit is 31 characters
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Save the file
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};
