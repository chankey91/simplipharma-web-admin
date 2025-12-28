import React from 'react';
import { Breadcrumbs as MuiBreadcrumbs, Link, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

export const Breadcrumbs: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => {
  const navigate = useNavigate();

  const breadcrumbItems = items;

  return (
    <MuiBreadcrumbs aria-label="breadcrumb" sx={{ mb: 2 }}>
      {breadcrumbItems.map((item, index) => {
        const isLast = index === breadcrumbItems.length - 1;
        
        if (isLast || !item.path) {
          return (
            <Typography key={index} color="text.primary" variant="body2">
              {item.label}
            </Typography>
          );
        }
        
        return (
          <Link
            key={index}
            component="button"
            variant="body2"
            onClick={() => item.path && navigate(item.path)}
            sx={{ cursor: 'pointer', textDecoration: 'none' }}
          >
            {item.label}
          </Link>
        );
      })}
    </MuiBreadcrumbs>
  );
};

