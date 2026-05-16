import React, { useEffect, useMemo, useState } from 'react';
import { Box, Drawer, AppBar, Toolbar, Typography, List, ListItem, ListItemButton, ListItemIcon, ListItemText, CssBaseline } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dashboard,
  Store,
  ShoppingCart,
  Inventory,
  Logout,
  Lock,
  Menu as MenuIcon,
  Business,
  Receipt,
  Description,
  Campaign,
  Group,
  Engineering,
  Settings,
  PersonAdd,
  Archive,
  PostAdd,
  TrendingUp,
  Undo,
} from '@mui/icons-material';
import { auth, getUserProfile, logout } from '../services/firebase';
import { BrandLogo } from './BrandLogo';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { brandColors } from '../theme/brand';
import { useAuth } from '../context/AuthContext';
import { ROLE_MENU_PATHS, getPanelTitle, type PanelRole } from '../auth/permissions';

const drawerWidth = 240;

const ALL_MENU_ITEMS: { text: string; icon: React.ReactNode; path: string }[] = [
  { text: 'Dashboard', icon: <Dashboard />, path: '/' },
  { text: 'Pending Retailers', icon: <PersonAdd />, path: '/pending-retailers' },
  { text: 'Expiry Returns', icon: <Archive />, path: '/expiry-returns' },
  { text: 'Order Returns', icon: <Undo />, path: '/order-returns' },
  { text: 'Vendors', icon: <Business />, path: '/vendors' },
  { text: 'Medical Stores', icon: <Store />, path: '/stores' },
  { text: 'Sales Officers', icon: <Group />, path: '/sales-officers' },
  { text: 'Operations users', icon: <Engineering />, path: '/operations-users' },
  { text: 'Inventory', icon: <Inventory />, path: '/inventory' },
  { text: 'Purchases', icon: <Receipt />, path: '/purchases' },
  { text: 'Orders', icon: <ShoppingCart />, path: '/orders' },
  { text: 'Gross margin', icon: <TrendingUp />, path: '/margin' },
  { text: 'Product demands', icon: <PostAdd />, path: '/product-demands' },
  { text: 'Operations', icon: <Settings />, path: '/operations' },
  { text: 'Invoices', icon: <Description />, path: '/invoices' },
  { text: 'Banners', icon: <Campaign />, path: '/banners' },
];

function menuItemsForRole(role: PanelRole) {
  const allowed = new Set(ROLE_MENU_PATHS[role]);
  return ALL_MENU_ITEMS.filter((item) => allowed.has(item.path));
}

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  /** True only when opened automatically because mustResetPassword is set (not voluntary menu). */
  const [isMustResetPrompt, setIsMustResetPrompt] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { panelRole } = useAuth();

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !panelRole) return;
    getUserProfile(uid).then((profile) => {
      if (profile?.mustResetPassword) {
        setIsMustResetPrompt(true);
        setChangePasswordOpen(true);
      }
    });
  }, [panelRole]);

  const menuItems = useMemo(
    () => (panelRole ? menuItemsForRole(panelRole) : []),
    [panelRole]
  );

  const panelTitle = panelRole ? getPanelTitle(panelRole) : 'Panel';

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isSelected = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const drawer = (
    <Box>
      <Toolbar sx={{ flexDirection: 'column', alignItems: 'flex-start', py: 2, gap: 0.5 }}>
        <BrandLogo variant="horizontal" height={36} sx={{ maxWidth: '100%' }} />
        <Typography variant="caption" sx={{ color: brandColors.navy, fontWeight: 600, letterSpacing: 0.5 }}>
          {panelTitle}
        </Typography>
      </Toolbar>
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              selected={isSelected(item.path)}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              setIsMustResetPrompt(false);
              setChangePasswordOpen(true);
            }}
          >
            <ListItemIcon><Lock /></ListItemIcon>
            <ListItemText primary="Change password" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton onClick={handleLogout}>
            <ListItemIcon><Logout /></ListItemIcon>
            <ListItemText primary="Logout" />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <MenuIcon
            sx={{ mr: 2, display: { sm: 'none' }, cursor: 'pointer' }}
            onClick={handleDrawerToggle}
          />
          <BrandLogo
            variant="icon"
            height={32}
            sx={{ display: { xs: 'block', sm: 'none' }, mr: 1 }}
          />
          <Typography variant="h6" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
            {panelTitle}
          </Typography>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
        }}
      >
        <Toolbar />
        {children}
      </Box>

      <ChangePasswordDialog
        open={changePasswordOpen}
        mode="change"
        required={isMustResetPrompt}
        onClose={() => {
          setChangePasswordOpen(false);
          setIsMustResetPrompt(false);
        }}
        onSuccess={() => {
          setIsMustResetPrompt(false);
        }}
        onLogout={handleLogout}
      />
    </Box>
  );
};
