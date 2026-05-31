import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  CssBaseline,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
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
  AccountBalance,
  AccountBalanceWallet,
  Article,
  HeadsetMic,
  Stars,
} from '@mui/icons-material';
import { auth, getUserProfile, logout } from '../services/firebase';
import { BrandLogo } from './BrandLogo';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { brandColors } from '../theme/brand';
import { useAuth } from '../context/AuthContext';
import { useFulfillmentLeaveGuard } from '../context/FulfillmentLeaveGuardContext';
import { ROLE_MENU_PATHS, getPanelTitle, type PanelRole } from '../auth/permissions';
import { AdminNotificationBell } from './AdminNotificationBell';
import { useAdminNotifications } from '../hooks/useAdminNotifications';

const drawerWidth = 260;

type MenuItem = { text: string; icon: React.ReactNode; path: string };

type MenuSection = { title: string; items: MenuItem[] };

const MENU_SECTIONS: MenuSection[] = [
  {
    title: 'Overview',
    items: [
      { text: 'Dashboard', icon: <Dashboard />, path: '/' },
      { text: 'Support', icon: <HeadsetMic />, path: '/support' },
    ],
  },
  {
    title: 'Fulfillment',
    items: [
      { text: 'Orders', icon: <ShoppingCart />, path: '/orders' },
      { text: 'Product demands', icon: <PostAdd />, path: '/product-demands' },
      { text: 'Sales invoices', icon: <Description />, path: '/invoices' },
      { text: 'Credit & debit notes', icon: <Article />, path: '/credit-notes' },
    ],
  },
  {
    title: 'Inventory & buying',
    items: [
      { text: 'Inventory', icon: <Inventory />, path: '/inventory' },
      { text: 'Purchase invoices', icon: <Receipt />, path: '/purchases' },
      { text: 'Vendors', icon: <Business />, path: '/vendors' },
    ],
  },
  {
    title: 'Returns',
    items: [
      { text: 'Order returns', icon: <Undo />, path: '/order-returns' },
      { text: 'Expiry returns', icon: <Archive />, path: '/expiry-returns' },
    ],
  },
  {
    title: 'Network',
    items: [
      { text: 'Medical stores', icon: <Store />, path: '/stores' },
      { text: 'Store receivables', icon: <AccountBalance />, path: '/store-receivables' },
      { text: 'Payment requests', icon: <AccountBalanceWallet />, path: '/payment-requests' },
      { text: 'Pending retailers', icon: <PersonAdd />, path: '/pending-retailers' },
      { text: 'Sales officers', icon: <Group />, path: '/sales-officers' },
    ],
  },
  {
    title: 'Insights',
    items: [{ text: 'Margin report', icon: <TrendingUp />, path: '/margin' }],
  },
  {
    title: 'Marketing',
    items: [
      { text: 'Banners', icon: <Campaign />, path: '/banners' },
      { text: 'Home feed', icon: <Stars />, path: '/home-feed' },
    ],
  },
  {
    title: 'Setup',
    items: [{ text: 'Fulfillment setup', icon: <Settings />, path: '/operations' }],
  },
  {
    title: 'Administration',
    items: [{ text: 'Panel users', icon: <Engineering />, path: '/operations-users' }],
  },
];

function menuSectionsForRole(role: PanelRole): MenuSection[] {
  const allowed = new Set(ROLE_MENU_PATHS[role]);
  return MENU_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => allowed.has(item.path)),
  })).filter((section) => section.items.length > 0);
}

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  /** True only when opened automatically because mustResetPassword is set (not voluntary menu). */
  const [isMustResetPrompt, setIsMustResetPrompt] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { panelRole } = useAuth();
  const { guardedNavigate } = useFulfillmentLeaveGuard();
  const { notifications, unreadCount, loading: notificationsLoading, markAllSeen } =
    useAdminNotifications(panelRole);

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

  const menuSections = useMemo(
    () => (panelRole ? menuSectionsForRole(panelRole) : []),
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
      <Toolbar sx={{ flexDirection: 'column', alignItems: 'flex-start', py: 2 }}>
        <BrandLogo variant="horizontal" height={36} sx={{ maxWidth: '100%' }} />
      </Toolbar>
      <List sx={{ pb: 1 }}>
        {menuSections.map((section) => (
          <React.Fragment key={section.title}>
            <ListSubheader
              disableSticky
              sx={{
                lineHeight: '22px',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: brandColors.navy,
                bgcolor: 'background.paper',
                px: 2,
                py: 0.75,
                mt: section.title === 'Overview' ? 0 : 0.5,
              }}
            >
              {section.title}
            </ListSubheader>
            {section.items.map((item) => (
              <ListItem key={item.path} disablePadding>
                <ListItemButton
                  selected={isSelected(item.path)}
                  onClick={() => {
                    void guardedNavigate(navigate, item.path);
                    setMobileOpen(false);
                  }}
                  sx={{ py: 0.75 }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                  <ListItemText
                    primary={item.text}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </React.Fragment>
        ))}
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
          <Box sx={{ flexGrow: 1 }} />
          {panelRole ? (
            <AdminNotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              loading={notificationsLoading}
              onMarkAllSeen={markAllSeen}
            />
          ) : null}
          <Tooltip title="Settings">
            <IconButton
              color="inherit"
              aria-label="Settings"
              onClick={(e) => setSettingsAnchor(e.currentTarget)}
            >
              <Settings />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={settingsAnchor}
            open={Boolean(settingsAnchor)}
            onClose={() => setSettingsAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem
              onClick={() => {
                setSettingsAnchor(null);
                setIsMustResetPrompt(false);
                setChangePasswordOpen(true);
              }}
            >
              <ListItemIcon>
                <Lock fontSize="small" />
              </ListItemIcon>
              Change password
            </MenuItem>
            <MenuItem
              onClick={() => {
                setSettingsAnchor(null);
                handleLogout();
              }}
            >
              <ListItemIcon>
                <Logout fontSize="small" />
              </ListItemIcon>
              Logout
            </MenuItem>
          </Menu>
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
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              overflowY: 'auto',
              overflowX: 'hidden',
            },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              overflowY: 'auto',
              overflowX: 'hidden',
            },
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
