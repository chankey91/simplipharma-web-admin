# SimpliPharma Web Admin Panel

## Setup Instructions

1. **Install Dependencies**
   ```bash
   cd web-admin
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Build for Production**
   ```bash
   npm run build
   ```

4. **Access the Application**
   - Development: http://localhost:3001
   - Login with admin credentials

## Features

- ✅ Medical Stores Management
- ✅ Order Lifecycle & Dispatch Management
- ✅ Inventory Management
- ✅ Stock Update with Barcode Scanning
- ✅ Expiry Date Management
- ✅ Batch Management
- ✅ Real-time Updates

## Environment

- Node.js 18+
- Firebase project (same as mobile app)
- Admin user account required

## Important Notes

1. **Firestore Indexes**: You may need to create indexes in Firebase Console for queries with `orderBy`. The app will work but may show warnings.

2. **Camera Permissions**: The barcode scanner requires camera access. Users need to grant permission in the browser.

3. **Admin Users**: Only users with `role: 'admin'` in the `users` collection can access the admin panel.

4. **Store Creation**: Creating new stores with authentication requires Firebase Admin SDK. For now, use the mobile app to create stores, or implement a Cloud Function.

## Project Structure

```
web-admin/
├── src/
│   ├── components/     # Reusable components
│   ├── pages/          # Page components
│   ├── services/       # Firebase services
│   ├── hooks/          # React Query hooks
│   ├── types/          # TypeScript types
│   └── utils/          # Utility functions
├── public/             # Static assets
└── package.json        # Dependencies
```
