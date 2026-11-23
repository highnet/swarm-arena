'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

type CopyPromptProps = {
  title: string;
  when: string;
  prompt: string;
  /** Rendered on the server: a Lucide icon element. */
  icon?: ReactNode;
};

/** A prompt ready to paste into a new Claude Code session on the repository. */
const CopyPrompt = ({ title, when, prompt, icon }: CopyPromptProps) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the text is selectable below.
    }
  };
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex items-start gap-2.5 px-4 pt-3">
        {icon && <span className="mt-0.5 shrink-0 text-fg-3 [&>svg]:size-4">{icon}</span>}
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium text-fg">{title}</h3>
          <p className="mt-0.5 text-xs text-fg-3 text-pretty">{when}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
            copied
              ? 'border-good/40 text-good-text'
              : 'border-line text-fg-2 hover:border-line-strong hover:text-fg',
          )}
          aria-label={`Copy the prompt: ${title}`}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="m-3 mt-2.5 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-3 py-2.5 font-mono text-[12px] leading-5 text-fg-2 select-all">
        {prompt}
      </pre>
    </div>
  );
};

export { CopyPrompt };
