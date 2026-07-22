import React, { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Notifications,
  ShoppingCart,
  PostAdd,
  PersonAdd,
  Undo,
  Archive,
  ShoppingBag,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import type { AdminNotification, AdminNotificationType } from '../types/adminNotification';

type Props = {
  notifications: AdminNotification[];
  unreadCount: number;
  loading: boolean;
  onMarkAllSeen: () => void;
};

const TYPE_ICONS: Record<AdminNotificationType, React.ReactNode> = {
  order: <ShoppingCart fontSize="small" />,
  product_demand: <PostAdd fontSize="small" />,
  retailer_registration: <PersonAdd fontSize="small" />,
  order_return: <Undo fontSize="small" />,
  expiry_return: <Archive fontSize="small" />,
  purchase_list: <ShoppingBag fontSize="small" />,
};

export const AdminNotificationBell: React.FC<Props> = ({
  notifications,
  unreadCount,
  loading,
  onMarkAllSeen,
}) => {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    onMarkAllSeen();
  };

  const handleClose = () => setAnchorEl(null);

  const handleSelect = (path: string) => {
    handleClose();
    navigate(path);
  };

  return (
    <>
      <Tooltip title={unreadCount > 0 ? `${unreadCount} new notification${unreadCount !== 1 ? 's' : ''}` : 'Notifications'}>
        <IconButton color="inherit" onClick={handleOpen} aria-label="Notifications" sx={{ mr: 0.5 }}>
          <Badge badgeContent={unreadCount} color="error" max={99}>
            <Notifications />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: { width: 360, maxWidth: '95vw', maxHeight: 420 },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Notifications
          </Typography>
          {notifications.length > 0 && (
            <Button size="small" onClick={onMarkAllSeen}>
              Mark read
            </Button>
          )}
        </Box>
        <Divider />
        {loading ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={28} />
          </Box>
        ) : notifications.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>
            No pending activity right now.
          </Typography>
        ) : (
          <List dense disablePadding sx={{ overflow: 'auto', maxHeight: 320 }}>
            {notifications.map((n) => (
              <ListItemButton key={n.id} onClick={() => handleSelect(n.path)} alignItems="flex-start">
                <Box sx={{ mr: 1.5, mt: 0.5, color: 'primary.main' }}>{TYPE_ICONS[n.type]}</Box>
                <ListItemText
                  primary={n.title}
                  secondary={
                    <>
                      <Typography component="span" variant="body2" color="text.secondary" display="block">
                        {n.message}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.disabled">
                        {format(n.createdAt, 'dd MMM yyyy, HH:mm')}
                      </Typography>
                    </>
                  }
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Menu>
    </>
  );
};
