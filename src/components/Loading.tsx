import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { BrandLogo } from './BrandLogo';

interface LoadingProps {
  message?: string;
}

export const Loading: React.FC<LoadingProps> = ({ message = 'Loading...' }) => {
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="200px"
      gap={2}
    >
      <BrandLogo variant="icon" height={48} />
      <CircularProgress />
      <Typography color="textSecondary">{message}</Typography>
    </Box>
  );
};

