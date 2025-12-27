import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { onAuthChange, isUserAdmin } from './services/firebase';
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
import { PurchaseInvoiceDetailsPage } from './pages/PurchaseInvoiceDetails';
import { InventoryPage } from './pages/Inventory';
import { StockUpdatePage } from './pages/StockUpdate';
import { MedicineDetailsPage } from './pages/MedicineDetails';

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
      main: '#2196F3',
    },
    secondary: {
      main: '#4CAF50',
    },
  },
});

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      if (user) {
        try {
          const admin = await isUserAdmin(user.uid);
          setIsAdmin(admin);
        } catch (error) {
          console.error('Error checking admin status:', error);
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) {
    return <Loading message="Checking authentication..." />;
  }

  if (!isAdmin) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <DashboardPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/stores"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <StoresPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/vendors"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <VendorsPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <OrdersPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders/:orderId"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <OrderDetailsPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/purchases"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <PurchaseInvoicesPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/purchases/new"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <CreatePurchaseInvoicePage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/purchases/:invoiceId"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <PurchaseInvoiceDetailsPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inventory"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <InventoryPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inventory/:medicineId"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <MedicineDetailsPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inventory/stock-update"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <StockUpdatePage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

