'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { JUST_IN_STORAGE_KEY } from '@/lib/justIn';
import { cn } from '@/lib/utils';
import { TimeAgo } from './TimeAgo';

type Story = {
  slug: string;
  title: string;
  published: string;
  href: string;
};

type JustInBarProps = Story & {
  /** The visitor is reading this story: the banner would only repeat the headline. */
  onStory: boolean;
};

const JustInBar = ({ slug, title, published, href, onStory }: JustInBarProps) => {
  const dismiss = () => {
    document.documentElement.dataset.justIn = 'hidden';
    try {
      localStorage.setItem(JUST_IN_STORAGE_KEY, slug);
    } catch {}
  };

  return (
    <div
      role="region"
      aria-label="Just in"
      data-slot="just-in"
      className={cn(
        'relative z-10 border-b border-line bg-panel just-in-hidden:hidden',
        onStory && 'hidden',
      )}
    >
      <div className="flex h-10 items-center gap-3 px-4 sm:px-6">
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-fg">
          <span className="size-1.5 rounded-full bg-fg" aria-hidden="true" />
          Just in
        </span>
        <Link
          href={href}
          className="group flex min-w-0 flex-1 items-center gap-3 text-[13px] text-fg-2 hover:text-fg"
        >
          <span className="truncate">{title}</span>
          <TimeAgo
            iso={published}
            className="hidden shrink-0 font-mono text-xs tabular text-fg-3 md:inline"
          />
          <span className="ml-auto hidden shrink-0 items-center gap-1 text-xs text-fg group-hover:underline sm:inline-flex">
            Read the story
            <ArrowRight className="size-3" aria-hidden="true" />
          </span>
        </Link>
        <Button
          variant="icon"
          size="icon"
          className="-mr-2 size-7 shrink-0"
          aria-label="Dismiss this story"
          title="Dismiss"
          onClick={dismiss}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};

type ActiveJustInProps = Story;

/** Reads the URL, so it renders inside <Suspense> (see JustIn). */
const ActiveJustIn = (story: ActiveJustInProps) => (
  <JustInBar {...story} onStory={usePathname() === story.href} />
);

type JustInProps = Story;

/** The newest story, one line under the top bar on every page. Dismissed per story. */
const JustIn = (story: JustInProps) => (
  <Suspense fallback={<JustInBar {...story} onStory={false} />}>
    <ActiveJustIn {...story} />
  </Suspense>
);

export { JustIn };
