'use client';

import { useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { SourceFile } from '@/lib/source';
import { cn } from '@/lib/utils';

type SourceViewerProps = {
  files: SourceFile[];
  repoUrl: string;
};

/** The engine as the swarm left it on main: file list on the left, highlighted code on the right. */
const SourceViewer = ({ files, repoUrl }: SourceViewerProps) => {
  const [active, setActive] = useState(
    files.find((f) => f.path.endsWith('main.rs'))?.path ?? files[0]?.path,
  );
  const file = files.find((f) => f.path === active);
  if (!file) return <p className="px-4 py-6 text-[13px] text-fg-2">No source yet.</p>;
  return (
    <div data-slot="source-viewer" className="grid min-w-0 md:grid-cols-[14rem_minmax(0,1fr)]">
      <ul className="flex gap-1 overflow-x-auto border-b border-line p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-r">
        {files.map((f) => (
          <li key={f.path} className="shrink-0">
            <Button
              variant="segment"
              size="sm"
              aria-pressed={f.path === active}
              onClick={() => setActive(f.path)}
              className="w-full justify-start font-mono text-[12px]"
              title={f.path}
            >
              <FileCode2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{f.path.split('/').slice(2).join('/')}</span>
            </Button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <span className="truncate font-mono text-xs text-fg-2">{file.path}</span>
          <a
            href={`${repoUrl}/blob/main/${file.path}`}
            className="shrink-0 text-xs text-fg-3 hover:text-fg"
            target="_blank"
            rel="noreferrer"
          >
            {file.lines} lines · GitHub
          </a>
        </div>
        <div
          className={cn('source-code max-h-[36rem] overflow-auto py-3 text-[12.5px] leading-5')}
          dangerouslySetInnerHTML={{ __html: file.html }}
        />
      </div>
    </div>
  );
};

export { SourceViewer };
