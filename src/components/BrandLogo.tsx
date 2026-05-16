import React from 'react';
import { Box, BoxProps } from '@mui/material';
import logoHorizontal from '../assets/logo-horizontal.png';
import logoIcon from '../assets/logo-icon.png';

export type BrandLogoVariant = 'horizontal' | 'icon';

interface BrandLogoProps extends Omit<BoxProps, 'component'> {
  variant?: BrandLogoVariant;
  height?: number;
}

const altText: Record<BrandLogoVariant, string> = {
  horizontal: 'SimpliPharma — Simplifying medicine supply',
  icon: 'SimpliPharma',
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'horizontal',
  height,
  sx,
  ...boxProps
}) => {
  const src = variant === 'icon' ? logoIcon : logoHorizontal;
  const defaultHeight = variant === 'icon' ? 40 : 48;

  return (
    <Box
      component="img"
      src={src}
      alt={altText[variant]}
      sx={{
        display: 'block',
        height: height ?? defaultHeight,
        width: 'auto',
        maxWidth: '100%',
        objectFit: 'contain',
        ...sx,
      }}
      {...boxProps}
    />
  );
};
