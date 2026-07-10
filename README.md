# SimpliPharma Web Admin Panel

A comprehensive admin panel for managing medical stores, inventory, orders, and stock management with real-time updates powered by Firebase.

## 🚀 Quick Start

**For deployment instructions, start here:** [`documentation/START_HERE.md`](documentation/START_HERE.md)

## 📋 Features

- ✅ Medical Stores Management
- ✅ Order Lifecycle & Dispatch Management
- ✅ Inventory Management
- ✅ Stock Update with Barcode Scanning
- ✅ Expiry Date Management
- ✅ Batch Management
- ✅ Real-time Updates

## 🛠️ Technology Stack

- **Frontend:** React 18 + TypeScript
- **Build Tool:** Vite 5
- **UI Library:** Material-UI (MUI) 5
- **State Management:** Zustand + React Query
- **Backend:** Firebase (Authentication, Firestore, Storage)
- **Deployment:** Jenkins CI/CD + Nginx

## 📦 Installation

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/chankey91/simplipharma-web-admin.git
   cd simplipharma-web-admin
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp firebase-config-template.env .env
   # Edit .env with your Firebase credentials
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Access the application**
   - Development: http://localhost:3001
   - Login with admin credentials

### Production Build

```bash
npm run build
```

The build output will be in the `dist/` directory.

## 🚀 Deployment

Branch maps to environment (same pattern as simplipharma-web-app):

| Env | Branch | URL | Deploy path |
|-----|--------|-----|-------------|
| **dev** | `develop` | http://103.230.227.5:8083 | `/var/www/simplipharma-admin-dev/current` |
| **prod** | `main` | http://103.230.227.5:8085 | `/var/www/simplipharma-admin/current` |

Merge to **`develop`** → auto-deploy **dev**. Merge to **`main`** → auto-deploy **prod**.

### Documentation

| Document | Purpose |
|----------|---------|
| **[START_HERE.md](documentation/START_HERE.md)** | 🎯 Quick start deployment guide |
| **[SERVER_DEPLOYMENT_STEPS.md](documentation/SERVER_DEPLOYMENT_STEPS.md)** | ⚡ Env-based deploy + webhook steps |
| **[DEPLOYMENT_GUIDE.md](documentation/DEPLOYMENT_GUIDE.md)** | 📖 Complete deployment reference |
| **[JENKINS_CREDENTIALS_SETUP.md](documentation/JENKINS_CREDENTIALS_SETUP.md)** | 🔐 Jenkins credentials configuration |
| **[README_DEPLOYMENT.md](documentation/README_DEPLOYMENT.md)** | 📦 Deployment package overview |

### Quick Deployment Options

#### Option 1: Jenkins (Automated)
1. Configure Jenkins with NodeJS
2. Add Firebase credentials
3. Create pipeline job using `Jenkinsfile`
4. Click "Build Now"

**Full instructions:** [`documentation/JENKINS_CREDENTIALS_SETUP.md`](documentation/JENKINS_CREDENTIALS_SETUP.md)

#### Option 2: Manual Script
1. SSH to server
2. Clone repository
3. Create `.env` file
4. Run `./deploy.sh`

**Full instructions:** [`documentation/START_HERE.md`](documentation/START_HERE.md)

## 🔥 Firebase Configuration

This application requires Firebase project setup:

1. **Create/Use Firebase project** at https://console.firebase.google.com
2. **Enable Authentication** (Email/Password)
3. **Create Firestore Database**
4. **Get Web App credentials** from Project Settings
5. **Create `.env` file** using `firebase-config-template.env`

### Environment Variables

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

**Note:** These are client-side credentials (safe for frontend use). Security is enforced through Firebase Security Rules.

## 👥 Admin Access

Only users with `role: 'admin'` in the Firestore `users` collection can access the admin panel.

### Creating Admin Users

Add a user document in Firestore:

```javascript
// Collection: users
// Document ID: {userId}
{
  email: "admin@example.com",
  name: "Admin User",
  role: "admin",  // Required for admin access
  createdAt: timestamp
}
```

## 📂 Project Structure

```
simplipharma-web-admin/
├── src/
│   ├── components/          # Reusable UI components
│   ├── pages/               # Page components
│   ├── services/            # Firebase services
│   ├── hooks/               # React Query hooks
│   ├── types/               # TypeScript types
│   └── utils/               # Utility functions
├── documentation/           # Deployment & setup guides
├── public/                  # Static assets
├── Jenkinsfile             # Jenkins CI/CD pipeline
├── deploy.sh               # Manual deployment script
├── nginx-simplipharma-admin.conf  # Nginx configuration
└── package.json            # Dependencies
```

## 🔒 Security

- Firebase credentials use environment variables
- Admin access controlled via Firestore security rules
- Nginx security headers configured
- HTTPS recommended for production

## 🛠️ Development Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (port 3001) |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

## 📝 Important Notes

1. **Firestore Indexes:** You may need to create indexes in Firebase Console for queries with `orderBy`. The app will provide links to create them.

2. **Camera Permissions:** Barcode scanner requires camera access. Users must grant permission in the browser.

3. **Admin Users:** Ensure admin users have `role: 'admin'` in Firestore.

4. **Store Creation:** Creating new stores with authentication requires proper Firebase security rules or Cloud Functions.

## 🆘 Support & Troubleshooting

- **Deployment Issues:** See [`documentation/DEPLOYMENT_GUIDE.md`](documentation/DEPLOYMENT_GUIDE.md) → Troubleshooting section
- **Jenkins Setup:** See [`documentation/JENKINS_CREDENTIALS_SETUP.md`](documentation/JENKINS_CREDENTIALS_SETUP.md)
- **Quick Commands:** See [`documentation/SERVER_DEPLOYMENT_STEPS.md`](documentation/SERVER_DEPLOYMENT_STEPS.md)

## 📞 Resources

- **Repository:** https://github.com/chankey91/simplipharma-web-admin
- **Firebase Console:** https://console.firebase.google.com
- **Node.js:** 18+ required
- **npm:** 9+ required

## 📄 License

[Your License Here]

## 👥 Contributors

- SimpliPharma Team

---

**Need help deploying?** Start with [`documentation/START_HERE.md`](documentation/START_HERE.md) 🚀
