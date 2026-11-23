import { createElement, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const typographyVariants = cva('', {
  variants: {
    variant: {
      pageTitle: 'text-2xl font-semibold tracking-tight text-fg text-balance sm:text-[1.75rem]',
      lede: 'text-[15px] leading-6 text-fg-2 text-pretty',
      sectionTitle: 'text-sm font-medium text-fg',
      body: 'text-sm leading-6 text-fg-2',
      small: 'text-[13px] leading-5 text-fg-2',
      meta: 'text-xs leading-5 text-fg-3',
      label: 'text-xs font-medium text-fg-3',
      data: 'font-mono text-[13px] tabular text-fg',
      bigData: 'font-mono text-xl font-medium tabular tracking-tight text-fg',
    },
    color: {
      default: '',
      primary: 'text-fg',
      secondary: 'text-fg-2',
      muted: 'text-fg-3',
      good: 'text-good-text',
      critical: 'text-critical-text',
      warning: 'text-warning',
    },
    weight: {
      default: '',
      regular: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
    },
    truncate: { true: 'truncate', false: '' },
  },
  defaultVariants: { variant: 'body', color: 'default', weight: 'default', truncate: false },
});

const DEFAULT_TAG: Record<string, string> = {
  pageTitle: 'h1',
  sectionTitle: 'h2',
  lede: 'p',
  body: 'p',
};

type TypographyProps = VariantProps<typeof typographyVariants> & {
  as?: string;
  className?: string;
  children: ReactNode;
  id?: string;
  title?: string;
};

const Typography = ({
  variant,
  color,
  weight,
  truncate,
  as,
  className,
  children,
  id,
  title,
}: TypographyProps) =>
  createElement(
    as ?? DEFAULT_TAG[variant ?? 'body'] ?? 'span',
    {
      'data-slot': 'typography',
      id,
      title,
      className: cn(typographyVariants({ variant, color, weight, truncate }), className),
    },
    children,
  );

export { Typography, typographyVariants };
