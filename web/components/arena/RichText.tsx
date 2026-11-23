import Link from 'next/link';
import { formatRef, segmentText } from '@arena/shared';
import { Typography } from '@/components/ui/Typography';
import { REPO_URL } from '@/lib/repo';
import { cn } from '@/lib/utils';

type RichTextProps = {
  text: string;
  /** The thread a board message belongs to, so msg#42 links to its thread page. */
  threadOf: (id: number) => number | undefined;
  variant?: 'body' | 'small';
  className?: string;
};

const linkClass =
  'font-mono text-[0.92em] text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg';

/** A message body with its references (msg#42, #12, pr#12, issue#12) turned into links. */
const RichText = ({ text, threadOf, variant = 'body', className }: RichTextProps) => (
  <Typography variant={variant} as="p" className={cn('whitespace-pre-wrap text-pretty', className)}>
    {segmentText(text).map((seg, i) => {
      if (!('ref' in seg)) return seg.text;
      const r = seg.ref;
      if (r.kind === 'message') {
        const thread = threadOf(r.n);
        if (thread === undefined) return seg.text;
        return (
          <Link
            key={i}
            href={`/messages/${thread}${thread === r.n ? '' : `#msg-${r.n}`}`}
            className={linkClass}
          >
            {seg.text}
          </Link>
        );
      }
      return (
        <a
          key={i}
          href={`${REPO_URL}/${r.kind === 'pr' ? 'pull' : 'issues'}/${r.n}`}
          target="_blank"
          rel="noreferrer"
          title={`GitHub ${formatRef(r)}`}
          className={linkClass}
        >
          {seg.text}
        </a>
      );
    })}
  </Typography>
);

export { RichText };
