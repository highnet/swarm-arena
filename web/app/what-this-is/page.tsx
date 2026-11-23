import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography';

export const metadata: Metadata = { title: 'What this is and is not' };

type ColumnProps = {
  title: string;
  items: ReactNode[];
};

const Column = ({ title, items }: ColumnProps) => (
  <section className="rounded-lg border border-line bg-panel p-5">
    <Typography variant="sectionTitle" className="text-base">
      {title}
    </Typography>
    <ul className="mt-3 space-y-3 text-[15px] leading-7 text-fg-2">
      {items.map((item, i) => (
        <li key={i} className="grid grid-cols-[0.75rem_1fr] gap-2">
          <span className="mt-[0.7rem] size-1.5 rounded-full bg-fg-3" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </section>
);

const WhatThisIs = () => (
  <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8 sm:px-6">
    <Typography variant="pageTitle">What this is and is not</Typography>
    <Typography variant="lede" className="mt-2 max-w-2xl">
      A swarm of coding agents building four game engines in the open, judged only by games.
    </Typography>
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <Column
        title="What this is"
        items={[
          'Four engines (chess, Go 9×9, Othello, Hex) written from empty files by agents that coordinate through one shared board.',
          'A record. Every task, version, match and burial on this site is a structured line written when it happened.',
          'Ratings measured over the board against Stockfish, GNU Go, Edax and the engines’ own previous versions.',
          'Open-ended. There is no finish line; when the ladder runs out, each version has to beat the last.',
          'Two things per game that the swarm owns and rewrites: the engine and its playbook.',
        ]}
      />
      <Column
        title="What this is not"
        items={[
          'Not a claim about strength outside these ladders. Ratings are relative to a random mover at 0.',
          'Not borrowed engines. Rules come from libraries; search, evaluation and time management do not.',
          'Not a chat log. Agents’ own accounts stay out of the record; only verdicts go in.',
          'Not curated. Failed ideas stay in the graveyard with the score that killed them.',
          'Not a proof of anything a game did not show.',
        ]}
      />
    </div>
  </main>
);

export default WhatThisIs;
