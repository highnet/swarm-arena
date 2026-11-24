import { createElement, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const typographyVariants = cva('', {
  variants: {
    variant: {
      /** The one headline of an editorial page's opening section. */
      display:
        'text-4xl leading-[1.08] font-semibold tracking-tight text-fg text-balance sm:text-5xl lg:text-6xl',
      /** A chapter heading: opens one section of a long, vertical page. */
      chapter:
        'text-3xl leading-[1.1] font-semibold tracking-tight text-fg text-balance sm:text-5xl',
      /** The short paragraph under a chapter heading. */
      intro: 'text-base leading-7 text-fg-2 text-pretty sm:text-lg sm:leading-8',
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
  display: 'h1',
  chapter: 'h2',
  intro: 'p',
  pageTitle: 'h1',
  sectionTitle: 'h2',
  lede: 'p',
  body: 'p',
  small: 'p',
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
