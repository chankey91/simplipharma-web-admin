import { collection, getDocs, doc, updateDoc, query, orderBy, Timestamp, db, getDoc, where } from './firebase';
import { deleteField } from 'firebase/firestore';
import { Order, OrderStatus, OrderTimelineEvent } from '../types';
import { reduceStockFromBatch, restoreStockToBatch, getMedicineById } from './inventory';
import { generateOrderInvoiceNumber } from '../utils/invoiceNumber';
import { paidFreeFromAllocation, physicalQtyFromAllocation } from '../utils/schemeFulfillment';

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

export const updateOrderMedicines = async (
  orderId: string,
  medicines: Order['medicines']
): Promise<void> => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, { medicines });
};

export const updateOrderTotalAmount = async (
  orderId: string,
  totalAmount: number,
  paidAmount = 0
): Promise<void> => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, {
    totalAmount,
    dueAmount: Math.max(0, totalAmount - paidAmount),
  });
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
        if (item.lineType === 'product_demand') continue;
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
    trayNumber?: string;
    processedBy?: string;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  // Generate invoice number if not already set
  const order = orderDoc.data() as Order;
  let invoiceNumber = order.invoiceNumber;
  if (!invoiceNumber) {
    try {
      invoiceNumber = await generateOrderInvoiceNumber();
      console.log(`Generated invoice number for order ${orderId}: ${invoiceNumber}`);
    } catch (error) {
      console.error('Failed to generate invoice number:', error);
      // Continue without invoice number if generation fails
    }
  }
  
  // Reduce stock from batches for items that have batch numbers assigned
  const stockUpdateErrors: string[] = [];
  
  for (const item of fulfillmentData.medicines) {
    const isUnresolvedDemand =
      item.lineType === 'product_demand' &&
      item.productDemandId &&
      (!item.medicineId || String(item.medicineId).trim() === '');
    if (isUnresolvedDemand) continue;

    const workItem =
      item.lineType === 'product_demand' && item.medicineId
        ? { ...item, lineType: 'medicine' as const }
        : item;
    if (!workItem.medicineId || !workItem.quantity) continue;

    // Handle new multi-batch allocation structure
    if (workItem.batchAllocations && workItem.batchAllocations.length > 0) {
      // Process each batch allocation
      for (const allocation of workItem.batchAllocations) {
        if (allocation.batchNumber && physicalQtyFromAllocation(allocation) > 0) {
          try {
            const deductQty = physicalQtyFromAllocation(allocation);
            await reduceStockFromBatch(
              workItem.medicineId,
              allocation.batchNumber,
              deductQty
            );
            console.log(`✓ Stock reduced for medicine ${workItem.medicineId}, batch ${allocation.batchNumber}, quantity: ${deductQty}`);
          } catch (error: any) {
            const errorMsg = `Failed to reduce stock for ${workItem.name || workItem.medicineId} (batch ${allocation.batchNumber}): ${error.message || error}`;
            console.error(errorMsg, error);
            stockUpdateErrors.push(errorMsg);
            // Continue with other items even if one fails
          }
        }
      }
    } 
    // Backward compatibility: Handle single batchNumber
    else if (workItem.batchNumber) {
      try {
        await reduceStockFromBatch(
          workItem.medicineId,
          workItem.batchNumber,
          workItem.quantity
        );
        console.log(`✓ Stock reduced for medicine ${workItem.medicineId}, batch ${workItem.batchNumber}, quantity: ${workItem.quantity}`);
      } catch (error: any) {
        const errorMsg = `Failed to reduce stock for ${workItem.name || workItem.medicineId} (batch ${workItem.batchNumber}): ${error.message || error}`;
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
    const isUnresolvedDemand =
      item.lineType === 'product_demand' &&
      item.productDemandId &&
      (!item.medicineId || String(item.medicineId).trim() === '');
    if (isUnresolvedDemand) {
      expandedMedicines.push({
        medicineId: item.medicineId || '',
        name: item.name,
        price: 0,
        quantity: item.quantity || 0,
        lineType: 'product_demand',
        manufacturerName: item.manufacturerName,
        requestedUnit: item.requestedUnit,
        notes: item.notes,
        productDemandId: item.productDemandId,
        freeQuantity: 0,
      });
      continue;
    }

    const workItem =
      item.lineType === 'product_demand' && item.medicineId
        ? { ...item, lineType: 'medicine' as const }
        : item;
    const line = workItem;
    // If line has multiple batch allocations, create separate line item for each batch
    if (line.batchAllocations && line.batchAllocations.length > 1) {
      // Fetch medicine data to get batch discountPercentage if needed
      let medicineData = null;
      if (line.medicineId) {
        try {
          medicineData = await getMedicineById(line.medicineId);
        } catch (error) {
          console.warn(`Failed to fetch medicine ${line.medicineId} for discountPercentage:`, error);
        }
      }
      
      for (const allocation of line.batchAllocations) {
        // Get discountPercentage - try allocation first, then line, then fetch from batch
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
        
        // Priority 2: From line itself
        if ((discountPct === undefined || isNaN(discountPct)) && line.discountPercentage !== undefined && line.discountPercentage !== null) {
          const parsed = typeof line.discountPercentage === 'number'
            ? line.discountPercentage
            : parseFloat(String(line.discountPercentage));
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
        const { paid: allocPaid, free: allocFree } = paidFreeFromAllocation(allocation);
        const batchItem: any = {
          medicineId: line.medicineId,
          name: line.name,
          price: priceAfterDiscount, // Price after discount
          quantity: allocPaid,
          freeQuantity: allocFree,
          batchNumber: allocation.batchNumber,
          gstRate: allocation.gstRate || line.gstRate || 5,
          batchAllocations: [
            {
              batchNumber: allocation.batchNumber,
              quantity: allocPaid,
              allocationFreeQty: allocFree,
              ...(allocation.expiryDate ? { expiryDate: allocation.expiryDate } : {}),
              ...(allocation.mrp !== undefined && allocation.mrp !== null
                ? { mrp: allocation.mrp }
                : {}),
              ...(allocation.purchasePrice !== undefined && allocation.purchasePrice !== null
                ? { purchasePrice: allocation.purchasePrice }
                : {}),
              ...(allocation.gstRate !== undefined && allocation.gstRate !== null
                ? { gstRate: allocation.gstRate }
                : {}),
              ...(allocation.schemePaidQty ? { schemePaidQty: allocation.schemePaidQty } : {}),
              ...(allocation.schemeFreeQty ? { schemeFreeQty: allocation.schemeFreeQty } : {}),
              discountPercentage: finalDiscountPct,
            },
          ],
        };
        
        // ALWAYS include discountPercentage if it exists (even if 0, but preserve actual value)
        if (finalDiscountPct !== undefined && !isNaN(finalDiscountPct)) {
          batchItem.discountPercentage = finalDiscountPct;
          console.log(`[fulfillOrder] Setting discountPercentage: ${finalDiscountPct}% for batch ${allocation.batchNumber} in expanded medicine`);
        }
        
        // Add optional fields only if they exist and are not undefined
        if (allocation.expiryDate) {
          batchItem.expiryDate = allocation.expiryDate;
        } else if (line.batchExpiryDate) {
          batchItem.expiryDate = line.batchExpiryDate;
        } else if (line.expiryDate) {
          batchItem.expiryDate = line.expiryDate;
        }
        
        if (allocation.mrp !== undefined && allocation.mrp !== null) {
          batchItem.mrp = allocation.mrp;
        }
        const invBatchForNr = medicineData?.stockBatches?.find(
          (b) => b.batchNumber === allocation.batchNumber
        );
        if (allocation.nonReturnable === true || invBatchForNr?.nonReturnable === true) {
          batchItem.nonReturnable = true;
        }
        if (line.productDemandId) {
          batchItem.productDemandId = line.productDemandId;
          batchItem.lineType = 'medicine';
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
        medicineId: line.medicineId,
        name: line.name,
        price: line.price || 0,
        quantity: line.quantity || 0,
        freeQuantity: line.freeQuantity || 0,
      };
      
      // Add expiryDate only if it exists
      if (line.batchExpiryDate) {
        cleanItem.expiryDate = line.batchExpiryDate;
      } else if (line.expiryDate) {
        cleanItem.expiryDate = line.expiryDate;
      }
      
      // Add optional fields only if they exist and are not undefined
      if (line.batchNumber) cleanItem.batchNumber = line.batchNumber;
      if (line.batchAllocations && line.batchAllocations.length === 1) {
        const allocation = line.batchAllocations[0];
        
        // Get discountPercentage - try allocation first, then line, then fetch from batch
        let discountPct: number | undefined = undefined;
        
        if (allocation.discountPercentage !== undefined && allocation.discountPercentage !== null) {
          discountPct = typeof allocation.discountPercentage === 'number'
            ? allocation.discountPercentage
            : parseFloat(String(allocation.discountPercentage));
        } else if (line.discountPercentage !== undefined && line.discountPercentage !== null) {
          discountPct = typeof line.discountPercentage === 'number'
            ? line.discountPercentage
            : parseFloat(String(line.discountPercentage));
        } else if (line.medicineId) {
          // Fetch from actual batch in inventory
          try {
            const medicineData = await getMedicineById(line.medicineId);
            if (medicineData && medicineData.stockBatches) {
              const batch = medicineData.stockBatches.find(b => b.batchNumber === allocation.batchNumber);
              if (batch && batch.discountPercentage !== undefined && batch.discountPercentage !== null) {
                discountPct = typeof batch.discountPercentage === 'number'
                  ? batch.discountPercentage
                  : parseFloat(String(batch.discountPercentage));
              }
              if (batch?.nonReturnable === true) {
                cleanItem.nonReturnable = true;
              }
            }
          } catch (error) {
            console.warn(`Failed to fetch medicine ${line.medicineId} for discountPercentage:`, error);
          }
        }
        
        // Default to 0 if still undefined
        const finalDiscountPct = discountPct !== undefined && !isNaN(discountPct) ? discountPct : 0;
        
        const purchasePrice = allocation.purchasePrice || line.price || 0;
        const priceAfterDiscount = finalDiscountPct > 0 
          ? purchasePrice * (1 - finalDiscountPct / 100)
          : purchasePrice;
        
        cleanItem.price = priceAfterDiscount;
        cleanItem.batchNumber = allocation.batchNumber;
        if (allocation.expiryDate) {
          cleanItem.expiryDate = allocation.expiryDate;
        } else if (line.expiryDate) {
          cleanItem.expiryDate = line.expiryDate;
        }
        if (allocation.mrp !== undefined && allocation.mrp !== null) cleanItem.mrp = allocation.mrp;
        if (allocation.gstRate !== undefined && allocation.gstRate !== null) cleanItem.gstRate = allocation.gstRate;
        const { paid: ap, free: af } = paidFreeFromAllocation(allocation);
        if (allocation.schemePaidQty && allocation.schemeFreeQty) {
          cleanItem.quantity = ap;
          cleanItem.freeQuantity = af;
        }
        cleanItem.batchAllocations = [
          {
            batchNumber: allocation.batchNumber,
            quantity: ap,
            allocationFreeQty: af,
            ...(allocation.expiryDate ? { expiryDate: allocation.expiryDate } : {}),
            ...(allocation.mrp !== undefined && allocation.mrp !== null ? { mrp: allocation.mrp } : {}),
            ...(allocation.purchasePrice !== undefined && allocation.purchasePrice !== null
              ? { purchasePrice: allocation.purchasePrice }
              : {}),
            ...(allocation.gstRate !== undefined && allocation.gstRate !== null
              ? { gstRate: allocation.gstRate }
              : {}),
            ...(allocation.schemePaidQty ? { schemePaidQty: allocation.schemePaidQty } : {}),
            ...(allocation.schemeFreeQty ? { schemeFreeQty: allocation.schemeFreeQty } : {}),
            discountPercentage: finalDiscountPct,
          },
        ];
        if (allocation.nonReturnable === true) {
          cleanItem.nonReturnable = true;
        }
        // ALWAYS include discountPercentage (even if 0) - it's important to preserve this value
        cleanItem.discountPercentage = finalDiscountPct;
      } else {
        if (line.mrp !== undefined && line.mrp !== null) cleanItem.mrp = line.mrp;
        if (line.gstRate !== undefined && line.gstRate !== null) cleanItem.gstRate = line.gstRate;
        if (line.discountPercentage !== undefined && line.discountPercentage !== null) {
          const discountPct = typeof line.discountPercentage === 'number'
            ? line.discountPercentage
            : parseFloat(String(line.discountPercentage));
          if (!isNaN(discountPct)) {
            cleanItem.discountPercentage = discountPct;
          }
        }
        if (line.batchNumber && line.medicineId) {
          try {
            const medicineData = await getMedicineById(line.medicineId);
            const invBatch = medicineData?.stockBatches?.find(
              (b) => b.batchNumber === line.batchNumber
            );
            if (invBatch?.nonReturnable === true) {
              cleanItem.nonReturnable = true;
            }
          } catch (error) {
            console.warn(
              `Failed to fetch medicine ${line.medicineId} for nonReturnable flag:`,
              error
            );
          }
        }
      }

      if (line.productDemandId) {
        cleanItem.productDemandId = line.productDemandId;
        cleanItem.lineType = 'medicine';
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
  
  const updateData: any = {
    ...cleanFulfillmentData,
    medicines: processedMedicines, // Use processed medicines array with proper Timestamps
    status: 'Order Fulfillment',
    timeline: [...currentTimeline, createTimelineEvent('Order Fulfillment', fulfilledBy, 'Order items verified and tax added')]
  };
  
  // Add invoice number if generated
  if (invoiceNumber) {
    updateData.invoiceNumber = invoiceNumber;
  }
  
  // Add tray number and processed by if provided
  if (fulfillmentData.trayNumber) {
    updateData.trayNumber = fulfillmentData.trayNumber;
  }
  if (fulfillmentData.processedBy) {
    updateData.processedBy = fulfillmentData.processedBy;
  }
  
  await updateDoc(orderRef, updateData);
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
  totalAmount?: number,
  paymentMethod?: 'Cash' | 'Online',
  transactionId?: string
) => {
  const orderRef = doc(db, 'orders', orderId);
  const updateData: any = {
    paymentStatus,
  };

  if (paidAmount !== undefined) {
    updateData.paidAmount = paidAmount;
  }

  if (totalAmount !== undefined) {
    updateData.totalAmount = totalAmount;
    updateData.dueAmount = totalAmount - (paidAmount || 0);
  }

  if (paymentMethod) {
    updateData.paymentMethod = paymentMethod;
  }

  if (transactionId !== undefined) {
    updateData.transactionId = transactionId || null;
  }
  if (paymentStatus === 'Unpaid') {
    updateData.transactionId = deleteField();
    updateData.paymentMethod = deleteField();
  }

  await updateDoc(orderRef, updateData);
};
