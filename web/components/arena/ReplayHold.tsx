'use client';

import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Where a replay inside a hold is: not started, part way through, or at its last ply. */
type ReplayStage = 'idle' | 'mid' | 'end';

type ReplayHoldValue = { report: (stage: ReplayStage) => void };

/** A replay inside a ReplayHold reports its stage here, so newer content waits until it ends. */
const ReplayHoldContext = createContext<ReplayHoldValue | null>(null);

type Held = { id: string; children: ReactNode };

type ReplayHoldProps = {
  /** What is shown; when it changes the new content waits until the replay below ends. */
  id: string;
  children: ReactNode;
};

/**
 * Keeps showing the content for `id` while its replay is part way through, so live data cannot
 * swap the game out from under the viewer. Newer content takes over when the replay ends or has
 * not started, or at once from the "Newer game" button. Each swap remounts the content, so the
 * new replay starts from its first ply.
 */
const ReplayHold = ({ id, children }: ReplayHoldProps) => {
  const [shown, setShown] = useState<Held>({ id, children });
  const [stage, setStage] = useState<ReplayStage>('idle');

  // Adjust during render (no effect): fresher props for the same game are kept, and a different
  // game takes over unless the replay is part way through.
  if (id === shown.id) {
    if (children !== shown.children) setShown({ id, children });
  } else if (stage !== 'mid') {
    setShown({ id, children });
    setStage('idle');
  }
  const pending = id === shown.id ? null : { id, children };

  const report = useCallback((next: ReplayStage) => setStage(next), []);
  const value = useMemo(() => ({ report }), [report]);

  return (
    <ReplayHoldContext.Provider value={value}>
      <div className="relative">
        <div key={shown.id}>{shown.children}</div>
        {pending && (
          <Button
            variant="secondary"
            size="xs"
            className="absolute right-3 bottom-3 gap-1"
            onClick={() => {
              setShown(pending);
              setStage('idle');
            }}
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Newer game
          </Button>
        )}
      </div>
    </ReplayHoldContext.Provider>
  );
};

export { ReplayHold, ReplayHoldContext, type ReplayStage };
