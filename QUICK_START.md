# Quick Start Guide

## Prerequisites
- Node.js 18+ installed
- Admin Firebase account with `role: 'admin'` in the users collection

## Setup Steps

1. **Navigate to web-admin directory**
   ```bash
   cd web-admin
   ```

2. **Install dependencies** (if not already done)
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

4. **Access the application**
   - Open browser to http://localhost:3001
   - Login with admin credentials

## Features Available

### 1. Medical Stores Management
- View all medical stores (retailers)
- Edit store information
- Activate/Deactivate stores
- Search and filter stores

### 2. Orders Management
- View all orders
- Update order status (Pending → Dispatched → Delivered)
- Dispatch orders with tracking information
- View order details
- Filter by status and date

### 3. Inventory Management
- View all medicines
- Search and filter medicines
- View stock levels
- Check expiry dates
- Low stock alerts
- Expired medicines alerts

### 4. Stock Update
- Update stock manually
- Scan barcode to find medicine
- Add stock with expiry dates
- Batch management
- Multiple batches per medicine

## Troubleshooting

### Camera Permission Issues
- Make sure you grant camera access when prompted
- Use HTTPS in production (required for camera access)
- Check browser settings for camera permissions

### Firebase Errors
- Verify Firebase configuration in `src/services/firebase.ts`
- Check Firestore security rules
- Ensure user has admin role in Firebase

### Build Errors
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (should be 18+)

## Next Steps

1. Configure Firestore security rules for admin access
2. Set up production build and deployment
3. Configure environment variables if needed
4. Set up CI/CD pipeline (optional)

## Support

For issues or questions, check the main README.md file or contact the development team.

