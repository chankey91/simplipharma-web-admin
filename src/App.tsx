import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { onAuthChange, getUserPanelRole } from './services/firebase';
import { canAccessPath, type PanelRole } from './auth/permissions';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Loading';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { StoresPage } from './pages/Stores';
import { VendorsPage } from './pages/Vendors';
import { OrdersPage } from './pages/Orders';
import { OrderDetailsPage } from './pages/OrderDetails';
import { PurchaseInvoicesPage } from './pages/PurchaseInvoices';
import { CreatePurchaseInvoicePage } from './pages/CreatePurchaseInvoice';
import { ImportPurchaseInvoicePdfPage } from './pages/ImportPurchaseInvoicePdf';
import { PurchaseInvoiceDetailsPage } from './pages/PurchaseInvoiceDetails';
import { InventoryPage } from './pages/Inventory';
import { StockUpdatePage } from './pages/StockUpdate';
import { MedicineDetailsPage } from './pages/MedicineDetails';
import { InvoicesPage } from './pages/Invoices';
import { BannersPage } from './pages/Banners';
import { SalesOfficersPage } from './pages/SalesOfficers';
import { OperationsUsersPage } from './pages/OperationsUsers';
import { OperationsPage } from './pages/Operations';
import { PendingRetailersPage } from './pages/PendingRetailers';
import { ExpiryReturnsPage } from './pages/ExpiryReturns';
import { OrderReturnsPage } from './pages/OrderReturns';
import { ProductDemandsPage } from './pages/ProductDemandsPage';
import { MarginReportPage } from './pages/MarginReport';
import { StoreReceivablesPage } from './pages/StoreReceivables';
import { SupportTicketsPage } from './pages/SupportTickets';
import { HomeFeedPage } from './pages/HomeFeed';
import { brandColors } from './theme/brand';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const theme = createTheme({
  palette: {
    primary: {
      main: brandColors.teal,
      dark: '#008f85',
      light: '#33b9af',
      contrastText: '#ffffff',
    },
    secondary: {
      main: brandColors.navy,
      dark: '#091336',
      light: '#3d4a70',
      contrastText: '#ffffff',
    },
  },
});

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [panelRole, setPanelRole] = useState<PanelRole | null>(null);
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      if (user) {
        try {
          const role = await getUserPanelRole(user.uid);
          setPanelRole(role);
        } catch (error) {
          console.error('Error checking panel access:', error);
          setPanelRole(null);
        }
      } else {
        setPanelRole(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) {
    return <Loading message="Checking authentication..." />;
  }

  if (!panelRole) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessPath(panelRole, location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const withLayout = (page: React.ReactNode) => (
  <ProtectedRoute>
    <Layout>{page}</Layout>
  </ProtectedRoute>
);

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={withLayout(<DashboardPage />)} />
      <Route path="/support" element={withLayout(<SupportTicketsPage />)} />
      <Route path="/stores" element={withLayout(<StoresPage />)} />
      <Route path="/store-receivables" element={withLayout(<StoreReceivablesPage />)} />
      <Route path="/vendors" element={withLayout(<VendorsPage />)} />
      <Route path="/orders" element={withLayout(<OrdersPage />)} />
      <Route path="/orders/:orderId" element={withLayout(<OrderDetailsPage />)} />
      <Route path="/operations" element={withLayout(<OperationsPage />)} />
      <Route path="/purchases" element={withLayout(<PurchaseInvoicesPage />)} />
      <Route path="/purchases/new" element={withLayout(<CreatePurchaseInvoicePage />)} />
      <Route path="/purchases/import-pdf" element={withLayout(<ImportPurchaseInvoicePdfPage />)} />
      <Route path="/purchases/:invoiceId" element={withLayout(<PurchaseInvoiceDetailsPage />)} />
      <Route path="/inventory" element={withLayout(<InventoryPage />)} />
      <Route path="/inventory/:medicineId" element={withLayout(<MedicineDetailsPage />)} />
      <Route path="/inventory/stock-update" element={withLayout(<StockUpdatePage />)} />
      <Route path="/invoices" element={withLayout(<InvoicesPage />)} />
      <Route path="/banners" element={withLayout(<BannersPage />)} />
      <Route path="/home-feed" element={withLayout(<HomeFeedPage />)} />
      <Route path="/sales-officers" element={withLayout(<SalesOfficersPage />)} />
      <Route path="/operations-users" element={withLayout(<OperationsUsersPage />)} />
      <Route path="/pending-retailers" element={withLayout(<PendingRetailersPage />)} />
      <Route path="/expiry-returns" element={withLayout(<ExpiryReturnsPage />)} />
      <Route path="/order-returns" element={withLayout(<OrderReturnsPage />)} />
      <Route path="/margin" element={withLayout(<MarginReportPage />)} />
      <Route path="/product-demands" element={withLayout(<ProductDemandsPage />)} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
