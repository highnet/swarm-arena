import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A secondary action set as a text link with a small arrow, so each screen keeps one primary
 * action (web/DESIGN.md, "One primary action"). `external` renders a plain `<a>` with the
 * up-right arrow, for files and pages outside the app router (`/agent.md`, GitHub).
 */
const textLinkVariants = cva(
  'inline-flex items-center gap-1 text-fg-2 underline-offset-4 transition-colors duration-150 hover:text-fg hover:underline',
  {
    variants: {
      size: {
        default: 'text-[15px]',
        small: 'text-[13px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

type TextLinkProps = VariantProps<typeof textLinkVariants> & {
  href: string;
  external?: boolean;
  /** MIME type hint for an external link (`text/markdown` for `/agent.md`). */
  type?: string;
  className?: string;
  children: ReactNode;
};

const TextLink = ({ href, external, type, size, className, children }: TextLinkProps) => {
  const Icon = external ? ArrowUpRight : ArrowRight;
  const classes = cn(textLinkVariants({ size }), className);
  const body = (
    <>
      {children}
      <Icon className="size-4 shrink-0" aria-hidden="true" />
    </>
  );
  return external ? (
    <a data-slot="text-link" href={href} type={type} className={classes}>
      {body}
    </a>
  ) : (
    <Link data-slot="text-link" href={href} className={classes}>
      {body}
    </Link>
  );
};

export { TextLink, textLinkVariants };
