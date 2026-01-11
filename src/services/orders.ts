import { collection, getDocs, doc, updateDoc, query, orderBy, Timestamp, db, getDoc, where } from './firebase';
import { Order, OrderStatus, OrderTimelineEvent } from '../types';
import { reduceStockFromBatch, restoreStockToBatch, getMedicineById } from './inventory';

const createTimelineEvent = (status: OrderStatus, updatedBy: string, note?: string): OrderTimelineEvent => ({
  status,
  timestamp: Timestamp.now(),
  updatedBy,
  note
});

export const getOrderById = async (orderId: string): Promise<Order | null> => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) return null;
  
  const data = orderDoc.data();
  return {
    id: orderDoc.id,
    ...data,
    orderDate: data.orderDate?.toDate() || new Date(),
    timeline: data.timeline?.map((t: any) => ({
      ...t,
      timestamp: t.timestamp?.toDate() || new Date()
    })) || []
  } as Order;
};

export const getAllOrders = async (): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  try {
    const q = query(ordersCol, orderBy('orderDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        orderDate: data.orderDate?.toDate() || new Date(),
        timeline: data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date()
        })) || []
      } as Order;
    });
  } catch (error) {
    console.warn('OrderBy query failed, sorting in memory:', error);
    const snapshot = await getDocs(ordersCol);
    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        orderDate: data.orderDate?.toDate() || new Date(),
        timeline: data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date()
        })) || []
      } as Order;
    });
    
    return orders.sort((a, b) => {
      const dateA = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
      const dateB = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
      return dateB.getTime() - dateA.getTime();
    });
  }
};

export const updateOrderStatus = async (
  orderId: string, 
  status: OrderStatus, 
  updatedBy: string, 
  note?: string
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  await updateDoc(orderRef, { 
    status,
    timeline: [...currentTimeline, createTimelineEvent(status, updatedBy, note)]
  });
};

export const cancelOrder = async (orderId: string, cancelledBy: string, reason: string) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) {
    throw new Error('Order not found');
  }
  
  const orderData = orderDoc.data();
  const currentTimeline = orderData?.timeline || [];
  const currentStatus = orderData?.status;
  
  // If order has been fulfilled (has batch assignments), restore stock
  if (currentStatus && currentStatus !== 'Pending' && currentStatus !== 'Cancelled' && orderData.medicines) {
    console.log(`Order ${orderId} has status ${currentStatus}, restoring stock from batches...`);
    
    try {
      // Restore stock for each medicine with batch assignments
      for (const item of orderData.medicines) {
        if (!item.medicineId) continue;
        
        // Check if item has batchAllocations (multiple batches)
        if (item.batchAllocations && Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) {
          for (const allocation of item.batchAllocations) {
            if (allocation.batchNumber && allocation.quantity) {
              try {
                await restoreStockToBatch(
                  item.medicineId,
                  allocation.batchNumber,
                  allocation.quantity || 0
                );
                console.log(`✓ Stock restored for medicine ${item.medicineId}, batch ${allocation.batchNumber}, quantity: ${allocation.quantity}`);
              } catch (error: any) {
                console.error(`Failed to restore stock for ${item.name || item.medicineId} (batch ${allocation.batchNumber}):`, error);
                // Continue with other batches even if one fails
              }
            }
          }
        } 
        // Check if item has single batchNumber
        else if (item.batchNumber && item.quantity) {
          try {
            await restoreStockToBatch(
              item.medicineId,
              item.batchNumber,
              item.quantity || 0
            );
            console.log(`✓ Stock restored for medicine ${item.medicineId}, batch ${item.batchNumber}, quantity: ${item.quantity}`);
          } catch (error: any) {
            console.error(`Failed to restore stock for ${item.name || item.medicineId} (batch ${item.batchNumber}):`, error);
            // Continue with other items even if one fails
          }
        }
      }
      console.log(`✓ All stock restored for order ${orderId}`);
    } catch (error: any) {
      console.error(`Error restoring stock for order ${orderId}:`, error);
      // Still cancel the order even if stock restoration fails
    }
  }
  
  await updateDoc(orderRef, {
    status: 'Cancelled',
    cancelReason: reason,
    cancelledAt: Timestamp.now(),
    timeline: [...currentTimeline, createTimelineEvent('Cancelled', cancelledBy, reason)]
  });
};

export const fulfillOrder = async (
  orderId: string, 
  fulfilledBy: string, 
  fulfillmentData: {
    medicines: any[];
    taxAmount: number;
    taxPercentage: number;
    subTotal: number;
    totalAmount: number;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  // Reduce stock from batches for items that have batch numbers assigned
  const stockUpdateErrors: string[] = [];
  
  for (const item of fulfillmentData.medicines) {
    if (!item.medicineId || !item.quantity) continue;

    // Handle new multi-batch allocation structure
    if (item.batchAllocations && item.batchAllocations.length > 0) {
      // Process each batch allocation
      for (const allocation of item.batchAllocations) {
        if (allocation.batchNumber && allocation.quantity > 0) {
          try {
            await reduceStockFromBatch(
              item.medicineId,
              allocation.batchNumber,
              allocation.quantity
            );
            console.log(`✓ Stock reduced for medicine ${item.medicineId}, batch ${allocation.batchNumber}, quantity: ${allocation.quantity}`);
          } catch (error: any) {
            const errorMsg = `Failed to reduce stock for ${item.name || item.medicineId} (batch ${allocation.batchNumber}): ${error.message || error}`;
            console.error(errorMsg, error);
            stockUpdateErrors.push(errorMsg);
            // Continue with other items even if one fails
          }
        }
      }
    } 
    // Backward compatibility: Handle single batchNumber
    else if (item.batchNumber) {
      try {
        await reduceStockFromBatch(
          item.medicineId,
          item.batchNumber,
          item.quantity
        );
        console.log(`✓ Stock reduced for medicine ${item.medicineId}, batch ${item.batchNumber}, quantity: ${item.quantity}`);
      } catch (error: any) {
        const errorMsg = `Failed to reduce stock for ${item.name || item.medicineId} (batch ${item.batchNumber}): ${error.message || error}`;
        console.error(errorMsg, error);
        stockUpdateErrors.push(errorMsg);
        // Continue with other items even if one fails
      }
    }
  }
  
  if (stockUpdateErrors.length > 0) {
    console.warn('Some stock updates failed:', stockUpdateErrors);
    // Still update the order, but log the errors
  }
  
  // Expand medicines with multiple batchAllocations into separate line items
  // This ensures each batch gets its own line item in the invoice
  const expandedMedicines: any[] = [];
  
  for (const item of fulfillmentData.medicines) {
    // If item has multiple batch allocations, create separate line item for each batch
    if (item.batchAllocations && item.batchAllocations.length > 1) {
      // Fetch medicine data to get batch discountPercentage if needed
      let medicineData = null;
      if (item.medicineId) {
        try {
          medicineData = await getMedicineById(item.medicineId);
        } catch (error) {
          console.warn(`Failed to fetch medicine ${item.medicineId} for discountPercentage:`, error);
        }
      }
      
      for (const allocation of item.batchAllocations) {
        // Get discountPercentage - try allocation first, then item, then fetch from batch
        let discountPct: number | undefined = undefined;
        
        // Priority 1: From allocation itself (should already have it from frontend)
        if (allocation.discountPercentage !== undefined && allocation.discountPercentage !== null) {
          const parsed = typeof allocation.discountPercentage === 'number' 
            ? allocation.discountPercentage 
            : parseFloat(String(allocation.discountPercentage));
          if (!isNaN(parsed)) {
            discountPct = parsed;
            console.log(`[fulfillOrder] Using discountPercentage from allocation: ${discountPct}% for batch ${allocation.batchNumber}`);
          }
        }
        
        // Priority 2: From item itself
        if ((discountPct === undefined || isNaN(discountPct)) && item.discountPercentage !== undefined && item.discountPercentage !== null) {
          const parsed = typeof item.discountPercentage === 'number'
            ? item.discountPercentage
            : parseFloat(String(item.discountPercentage));
          if (!isNaN(parsed)) {
            discountPct = parsed;
            console.log(`[fulfillOrder] Using discountPercentage from item: ${discountPct}% for batch ${allocation.batchNumber}`);
          }
        }
        
        // Priority 3: Fetch from actual batch in inventory (fallback)
        if ((discountPct === undefined || isNaN(discountPct)) && medicineData && medicineData.stockBatches) {
          const batch = medicineData.stockBatches.find(b => b.batchNumber === allocation.batchNumber);
          if (batch && batch.discountPercentage !== undefined && batch.discountPercentage !== null) {
            discountPct = typeof batch.discountPercentage === 'number'
              ? batch.discountPercentage
              : parseFloat(String(batch.discountPercentage));
            if (!isNaN(discountPct)) {
              console.log(`[fulfillOrder] Fetched discountPercentage from inventory batch: ${discountPct}% for batch ${allocation.batchNumber}`);
            }
          }
        }
        
        // Default to 0 if still undefined
        const finalDiscountPct = discountPct !== undefined && !isNaN(discountPct) ? discountPct : 0;
        
        const purchasePrice = allocation.purchasePrice || 0;
        const priceAfterDiscount = finalDiscountPct > 0 
          ? purchasePrice * (1 - finalDiscountPct / 100)
          : purchasePrice;
        
        // Create a clean medicine item for this batch (no undefined values)
        const batchItem: any = {
          medicineId: item.medicineId,
          name: item.name,
          price: priceAfterDiscount, // Price after discount
          quantity: allocation.quantity || 0,
          batchNumber: allocation.batchNumber,
          gstRate: allocation.gstRate || item.gstRate || 5,
        };
        
        // ALWAYS include discountPercentage if it exists (even if 0, but preserve actual value)
        if (finalDiscountPct !== undefined && !isNaN(finalDiscountPct)) {
          batchItem.discountPercentage = finalDiscountPct;
          console.log(`[fulfillOrder] Setting discountPercentage: ${finalDiscountPct}% for batch ${allocation.batchNumber} in expanded medicine`);
        }
        
        // Add optional fields only if they exist and are not undefined
        if (allocation.expiryDate) {
          batchItem.expiryDate = allocation.expiryDate;
        } else if (item.batchExpiryDate) {
          batchItem.expiryDate = item.batchExpiryDate;
        } else if (item.expiryDate) {
          batchItem.expiryDate = item.expiryDate;
        }
        
        if (allocation.mrp !== undefined && allocation.mrp !== null) {
          batchItem.mrp = allocation.mrp;
        }
        
        // Final cleanup: Remove any undefined or null values
        Object.keys(batchItem).forEach(key => {
          if (batchItem[key] === undefined || batchItem[key] === null) {
            // Keep 0 values and empty strings, only remove undefined/null
            if (batchItem[key] !== 0 && batchItem[key] !== '') {
              delete batchItem[key];
            }
          }
        });
        
        expandedMedicines.push(batchItem);
      }
    } 
    // Single batch or no batch allocations - use as is but clean undefined values
    else {
      const cleanItem: any = {
        medicineId: item.medicineId,
        name: item.name,
        price: item.price || 0,
        quantity: item.quantity || 0,
      };
      
      // Add expiryDate only if it exists
      if (item.batchExpiryDate) {
        cleanItem.expiryDate = item.batchExpiryDate;
      } else if (item.expiryDate) {
        cleanItem.expiryDate = item.expiryDate;
      }
      
      // Add optional fields only if they exist and are not undefined
      if (item.batchNumber) cleanItem.batchNumber = item.batchNumber;
      if (item.batchAllocations && item.batchAllocations.length === 1) {
        const allocation = item.batchAllocations[0];
        
        // Get discountPercentage - try allocation first, then item, then fetch from batch
        let discountPct: number | undefined = undefined;
        
        if (allocation.discountPercentage !== undefined && allocation.discountPercentage !== null) {
          discountPct = typeof allocation.discountPercentage === 'number'
            ? allocation.discountPercentage
            : parseFloat(String(allocation.discountPercentage));
        } else if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
          discountPct = typeof item.discountPercentage === 'number'
            ? item.discountPercentage
            : parseFloat(String(item.discountPercentage));
        } else if (item.medicineId) {
          // Fetch from actual batch in inventory
          try {
            const medicineData = await getMedicineById(item.medicineId);
            if (medicineData && medicineData.stockBatches) {
              const batch = medicineData.stockBatches.find(b => b.batchNumber === allocation.batchNumber);
              if (batch && batch.discountPercentage !== undefined && batch.discountPercentage !== null) {
                discountPct = typeof batch.discountPercentage === 'number'
                  ? batch.discountPercentage
                  : parseFloat(String(batch.discountPercentage));
              }
            }
          } catch (error) {
            console.warn(`Failed to fetch medicine ${item.medicineId} for discountPercentage:`, error);
          }
        }
        
        // Default to 0 if still undefined
        const finalDiscountPct = discountPct !== undefined && !isNaN(discountPct) ? discountPct : 0;
        
        const purchasePrice = allocation.purchasePrice || item.price || 0;
        const priceAfterDiscount = finalDiscountPct > 0 
          ? purchasePrice * (1 - finalDiscountPct / 100)
          : purchasePrice;
        
        cleanItem.price = priceAfterDiscount;
        cleanItem.batchNumber = allocation.batchNumber;
        if (allocation.expiryDate) {
          cleanItem.expiryDate = allocation.expiryDate;
        } else if (item.expiryDate) {
          cleanItem.expiryDate = item.expiryDate;
        }
        if (allocation.mrp !== undefined && allocation.mrp !== null) cleanItem.mrp = allocation.mrp;
        if (allocation.gstRate !== undefined && allocation.gstRate !== null) cleanItem.gstRate = allocation.gstRate;
        // ALWAYS include discountPercentage (even if 0) - it's important to preserve this value
        cleanItem.discountPercentage = finalDiscountPct;
      } else {
        if (item.mrp !== undefined && item.mrp !== null) cleanItem.mrp = item.mrp;
        if (item.gstRate !== undefined && item.gstRate !== null) cleanItem.gstRate = item.gstRate;
        if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
          const discountPct = typeof item.discountPercentage === 'number'
            ? item.discountPercentage
            : parseFloat(String(item.discountPercentage));
          if (!isNaN(discountPct)) {
            cleanItem.discountPercentage = discountPct;
          }
        }
      }
      
      // Final cleanup: Remove any undefined or null values that might have been missed
      Object.keys(cleanItem).forEach(key => {
        if (cleanItem[key] === undefined || cleanItem[key] === null) {
          // Keep 0 values and empty strings, only remove undefined/null
          if (cleanItem[key] !== 0 && cleanItem[key] !== '') {
            delete cleanItem[key];
          }
        }
      });
      
      expandedMedicines.push(cleanItem);
    }
  }
  
  // Clean fulfillmentData to remove undefined values
  const cleanFulfillmentData: any = {
    taxAmount: fulfillmentData.taxAmount || 0,
    taxPercentage: fulfillmentData.taxPercentage || 5,
    subTotal: fulfillmentData.subTotal || 0,
    totalAmount: fulfillmentData.totalAmount || 0,
  };
  
  // Convert Date objects to Timestamps and ensure all fields are properly set
  const processedMedicines = expandedMedicines.map(m => {
    const processed: any = { ...m };
    
    // Convert expiryDate to Timestamp if it's a Date object
    if (processed.expiryDate instanceof Date) {
      processed.expiryDate = Timestamp.fromDate(processed.expiryDate);
    } else if (processed.expiryDate && typeof processed.expiryDate.toDate === 'function') {
      // Already a Timestamp, keep as is
      processed.expiryDate = processed.expiryDate;
    }
    
    // Ensure discountPercentage is preserved (even if 0, but not undefined/null)
    if (processed.discountPercentage === undefined || processed.discountPercentage === null) {
      // Don't include undefined/null discountPercentage
      delete processed.discountPercentage;
    }
    
    // Remove any undefined or null values
    Object.keys(processed).forEach(key => {
      if (processed[key] === undefined || processed[key] === null) {
        // Keep 0 values and empty strings, only remove undefined/null
        if (processed[key] !== 0 && processed[key] !== '') {
          delete processed[key];
        }
      }
    });
    
    return processed;
  });
  
  await updateDoc(orderRef, {
    ...cleanFulfillmentData,
    medicines: processedMedicines, // Use processed medicines array with proper Timestamps
    status: 'Order Fulfillment',
    timeline: [...currentTimeline, createTimelineEvent('Order Fulfillment', fulfilledBy, 'Order items verified and tax added')]
  });
};

export const updateOrderDispatch = async (
  orderId: string, 
  dispatchData: {
    status: 'In Transit';
    dispatchDate: Date;
    dispatchNotes?: string;
    trackingNumber?: string;
    courierName?: string;
    dispatchedBy: string;
    estimatedDeliveryDate?: Date;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  const updatePayload: any = {
    status: dispatchData.status,
    dispatchDate: Timestamp.fromDate(dispatchData.dispatchDate),
    dispatchedBy: dispatchData.dispatchedBy,
    timeline: [...currentTimeline, createTimelineEvent('In Transit', dispatchData.dispatchedBy, dispatchData.dispatchNotes)]
  };
  
  if (dispatchData.trackingNumber) updatePayload.trackingNumber = dispatchData.trackingNumber;
  if (dispatchData.courierName) updatePayload.courierName = dispatchData.courierName;
  if (dispatchData.dispatchNotes) updatePayload.dispatchNotes = dispatchData.dispatchNotes;
  if (dispatchData.estimatedDeliveryDate) {
    updatePayload.estimatedDeliveryDate = Timestamp.fromDate(dispatchData.estimatedDeliveryDate);
  }
  
  await updateDoc(orderRef, updatePayload);
};

export const markOrderDelivered = async (orderId: string, deliveredBy: string) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) {
    throw new Error('Order not found');
  }
  
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  await updateDoc(orderRef, {
    status: 'Delivered',
    deliveryConfirmation: {
      deliveredAt: Timestamp.now(),
      deliveredBy
    },
    timeline: [...currentTimeline, createTimelineEvent('Delivered', deliveredBy, 'Order delivered successfully')]
  });
};

export const updatePaymentStatus = async (
  orderId: string,
  paymentStatus: 'Paid' | 'Unpaid' | 'Partial',
  paidAmount?: number,
  totalAmount?: number
) => {
  const orderRef = doc(db, 'orders', orderId);
  const updateData: any = {
    paymentStatus,
  };
  
  if (paidAmount !== undefined) {
    updateData.paidAmount = paidAmount;
  }
  
  if (totalAmount !== undefined) {
    updateData.dueAmount = totalAmount - (paidAmount || 0);
  }
  
  await updateDoc(orderRef, updateData);
};
