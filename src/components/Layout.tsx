import React, { useState } from 'react';
import { Box, Drawer, AppBar, Toolbar, Typography, List, ListItem, ListItemButton, ListItemIcon, ListItemText, CssBaseline } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dashboard,
  Store,
  ShoppingCart,
  Inventory,
  Logout,
  Menu as MenuIcon,
  Business,
  Receipt,
  Description,
  Campaign,
  Group,
  Settings,
  PersonAdd,
  Archive,
  PostAdd,
  TrendingUp,
} from '@mui/icons-material';
import { logout } from '../services/firebase';
import { BrandLogo } from './BrandLogo';
import { brandColors } from '../theme/brand';

const drawerWidth = 240;

const menuItems = [
  { text: 'Dashboard', icon: <Dashboard />, path: '/' },
  { text: 'Pending Retailers', icon: <PersonAdd />, path: '/pending-retailers' },
  { text: 'Expiry Returns', icon: <Archive />, path: '/expiry-returns' },
  { text: 'Vendors', icon: <Business />, path: '/vendors' },
  { text: 'Medical Stores', icon: <Store />, path: '/stores' },
  { text: 'Sales Officers', icon: <Group />, path: '/sales-officers' },
  { text: 'Inventory', icon: <Inventory />, path: '/inventory' },
  { text: 'Purchases', icon: <Receipt />, path: '/purchases' },
  { text: 'Orders', icon: <ShoppingCart />, path: '/orders' },
  { text: 'Gross margin', icon: <TrendingUp />, path: '/margin' },
  { text: 'Product demands', icon: <PostAdd />, path: '/product-demands' },
  { text: 'Operations', icon: <Settings />, path: '/operations' },
  { text: 'Invoices', icon: <Description />, path: '/invoices' },
  { text: 'Banners', icon: <Campaign />, path: '/banners' },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const drawer = (
    <Box>
      <Toolbar sx={{ flexDirection: 'column', alignItems: 'flex-start', py: 2, gap: 0.5 }}>
        <BrandLogo variant="horizontal" height={36} sx={{ maxWidth: '100%' }} />
        <Typography variant="caption" sx={{ color: brandColors.navy, fontWeight: 600, letterSpacing: 0.5 }}>
          Admin Panel
        </Typography>
      </Toolbar>
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path}
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
            sx={{ mr: 2, display: { sm: 'none' } }}
            onClick={handleDrawerToggle}
          />
          <BrandLogo
            variant="icon"
            height={32}
            sx={{ display: { xs: 'block', sm: 'none' }, mr: 1 }}
          />
          <Typography variant="h6" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
            Admin Panel
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
    </Box>
  );
};
