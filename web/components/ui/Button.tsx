import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'rounded-md bg-primary font-medium text-primary-fg hover:bg-fg-2',
        secondary:
          'rounded-md border border-line bg-panel font-medium text-fg hover:border-line-strong hover:bg-panel-raised',
        ghost: 'rounded-md text-fg-2 hover:bg-panel-raised hover:text-fg',
        segment:
          'rounded-[5px] text-fg-3 hover:text-fg aria-pressed:bg-panel-raised aria-pressed:text-fg aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.4)]',
        icon: 'rounded-md text-fg-2 hover:bg-panel-raised hover:text-fg',
      },
      size: {
        default: 'h-8 px-3 text-[13px]',
        sm: 'h-7 px-2.5 text-xs',
        xs: 'h-6 px-2 text-xs',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

type ButtonProps = VariantProps<typeof buttonVariants> &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  };

const Button = ({ variant, size, className, children, type = 'button', ...rest }: ButtonProps) => (
  <button
    data-slot="button"
    type={type}
    className={cn(buttonVariants({ variant, size }), className)}
    {...rest}
  >
    {children}
  </button>
);

export { Button, buttonVariants };
