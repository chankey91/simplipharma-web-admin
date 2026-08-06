import * as XLSX from 'xlsx';
import { orderReferenceWithoutInvoice } from './orderDisplay';
import { Order, User } from '../types';
import { getMedicineById } from '../services/inventory';
import { istDateStampCompact } from './dateTime';
import { appAlert } from './appDialog';

// Fallback: extract town and district from a free-text address (legacy rows).
const parseAddress = (address?: string): { town: string; district: string } => {
  if (!address) return { town: 'N/A', district: 'N/A' };
  const addressParts = address.split(',').map((s) => s.trim());
  let town = 'N/A';
  let district = 'N/A';
  if (addressParts.length >= 2) {
    town = addressParts[addressParts.length - 2] || 'N/A';
    district = addressParts[addressParts.length - 1] || 'N/A';
  } else if (addressParts.length === 1) {
    town = addressParts[0] || 'N/A';
  }
  return { town, district };
};

// Prefer explicit town/district fields; fall back to parsing address for older records
const resolveTownDistrict = (
  store?: Pick<User, 'town' | 'district' | 'address'> | null
): { town: string; district: string } => {
  const town = store?.town?.trim();
  const district = store?.district?.trim();
  if (town || district) {
    return { town: town || 'N/A', district: district || 'N/A' };
  }
  return parseAddress(store?.address);
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
    await appAlert('No pending orders found', { severity: 'warning' });
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
    const orderNumber = order.invoiceNumber || orderReferenceWithoutInvoice(order.id);
    
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
      const { town, district } = resolveTownDistrict(data.store);
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
  const dateStr = istDateStampCompact();
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};

function productAggregateKey(medicine: Order['medicines'][number]): string {
  if (medicine.medicineId?.trim()) return `med:${medicine.medicineId.trim()}`;
  if (medicine.productDemandId?.trim()) return `demand:${medicine.productDemandId.trim()}`;
  return `name:${medicine.name.trim().toLowerCase()}`;
}

/**
 * One row per product with total quantity across the given orders (no store details).
 * Caller should pass the already date-/status-filtered order list.
 */
export const exportPendingOrdersProductSummary = async (
  orders: Order[],
  filename: string = 'orders-product-summary'
) => {
  if (orders.length === 0) {
    await appAlert('No orders found for the selected date range', { severity: 'warning' });
    return;
  }

  const medicineMap = new Map<string, { manufacturer: string; currentStock: number }>();
  const allMedicineIds = new Set<string>();

  for (const order of orders) {
    for (const medicine of order.medicines) {
      if (medicine.medicineId) allMedicineIds.add(medicine.medicineId);
    }
  }

  for (const medicineId of allMedicineIds) {
    if (medicineMap.has(medicineId)) continue;
    try {
      const med = await getMedicineById(medicineId);
      if (med) {
        const fromCurrent =
          typeof med.currentStock === 'number' && Number.isFinite(med.currentStock)
            ? med.currentStock
            : undefined;
        const fromStock =
          typeof med.stock === 'number' && Number.isFinite(med.stock) ? med.stock : undefined;
        const fromBatches = (med.stockBatches || []).reduce(
          (s, b) => s + (Number(b.quantity) || 0),
          0
        );
        medicineMap.set(medicineId, {
          manufacturer: med.manufacturer || 'N/A',
          currentStock: fromCurrent ?? fromStock ?? fromBatches,
        });
      }
    } catch (error) {
      console.warn(`Failed to fetch medicine ${medicineId}:`, error);
    }
  }

  const productAggregate = new Map<
    string,
    {
      medicineId: string;
      medicineName: string;
      manufacturer: string;
      totalQty: number;
      currentStock: number | null;
      orderNumbers: Set<string>;
    }
  >();

  for (const order of orders) {
    const orderNumber = order.invoiceNumber || orderReferenceWithoutInvoice(order.id);

    for (const medicine of order.medicines) {
      const key = productAggregateKey(medicine);
      const medInfo = medicine.medicineId ? medicineMap.get(medicine.medicineId) : undefined;
      const manufacturer = medInfo?.manufacturer || medicine.manufacturerName || 'N/A';
      const qty = medicine.quantity || 0;
      const currentStock = medInfo != null ? medInfo.currentStock : null;

      const existing = productAggregate.get(key);
      if (existing) {
        existing.totalQty += qty;
        existing.orderNumbers.add(orderNumber);
        if (existing.currentStock == null && currentStock != null) {
          existing.currentStock = currentStock;
        }
      } else {
        productAggregate.set(key, {
          medicineId: medicine.medicineId || '',
          medicineName: medicine.name,
          manufacturer,
          totalQty: qty,
          currentStock,
          orderNumbers: new Set([orderNumber]),
        });
      }
    }
  }

  const rows = Array.from(productAggregate.values()).sort((a, b) =>
    a.medicineName.localeCompare(b.medicineName)
  );

  const excelData: (string | number)[][] = [
    [
      'SR',
      'Medicine Name',
      'Medicine ID',
      'Manufacturer',
      'Total Quantity',
      'Current Stock',
      'Order Count',
      'Order Numbers',
      'Remark',
    ],
  ];

  rows.forEach((row, index) => {
    excelData.push([
      index + 1,
      row.medicineName,
      row.medicineId || '—',
      row.manufacturer,
      row.totalQty,
      row.currentStock != null ? row.currentStock : '—',
      row.orderNumbers.size,
      Array.from(row.orderNumbers).sort().join(', '),
      '',
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);

  ws['!cols'] = [
    { wch: 5 },
    { wch: 40 },
    { wch: 28 },
    { wch: 30 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 40 },
    { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Product Summary');

  const dateStr = istDateStampCompact();
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};

/**
 * One row per retailer with store details and associated Sales Officer fields.
 * Caller should pass the already filtered/sorted store list.
 */
export const exportRetailersWithSalesOfficers = async (
  retailers: User[],
  salesOfficers: User[],
  filename: string = 'retailers-with-sales-officers'
) => {
  if (retailers.length === 0) {
    await appAlert('No retailers found to export', { severity: 'warning' });
    return;
  }

  const soById = new Map(salesOfficers.map((so) => [so.id, so]));

  const excelData: (string | number)[][] = [
    [
      'SR',
      'Store Code',
      'Shop Name',
      'Owner',
      'Email',
      'Phone',
      'Address',
      'Town',
      'District',
      'Licence No.',
      'Aadhar No.',
      'Licence Holder',
      'PAN',
      'GST',
      'Status',
      'Latitude',
      'Longitude',
      'Retailer ID',
      'SO Name',
      'SO Email',
      'SO Phone',
      'SO ID',
    ],
  ];

  retailers.forEach((store, index) => {
    const so = store.salesOfficerId ? soById.get(store.salesOfficerId) : undefined;
    excelData.push([
      index + 1,
      store.storeCode || '',
      store.shopName || store.displayName || '',
      store.ownerName || store.displayName || '',
      store.email || '',
      store.phoneNumber || '',
      store.address || store.location?.address || '',
      store.town || '',
      store.district || '',
      store.licenceNumber || '',
      store.aadharNumber || '',
      store.licenceHolderName || '',
      store.pan || '',
      store.gst || '',
      store.isActive !== false ? 'Active' : 'Inactive',
      store.location?.latitude ?? '',
      store.location?.longitude ?? '',
      store.id || '',
      so?.displayName || so?.email || '',
      so?.email || '',
      so?.phoneNumber || '',
      store.salesOfficerId || '',
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 30 },
    { wch: 22 },
    { wch: 28 },
    { wch: 14 },
    { wch: 40 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 14 },
    { wch: 16 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 28 },
    { wch: 22 },
    { wch: 28 },
    { wch: 14 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Retailers');

  const dateStr = istDateStampCompact();
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};
