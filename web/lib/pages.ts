import {
  Activity,
  BookOpen,
  Bot,
  Compass,
  Cpu,
  GitMerge,
  GitPullRequest,
  Grid3x3,
  MessagesSquare,
  ScrollText,
  Skull,
  Swords,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/** Every top-level page on the site, once: the sidebar, the footer and "Keep exploring" read it. */

export type PageKey =
  | 'progress'
  | 'engines'
  | 'games'
  | 'versions'
  | 'graveyard'
  | 'fleet'
  | 'sessions'
  | 'rallypoint'
  | 'board'
  | 'messages'
  | 'howItWorks'
  | 'protocol'
  | 'concepts'
  | 'skills';

export type SitePage = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One line on what the reader finds there, used by "Keep exploring" cards. */
  blurb: string;
};

export const PAGES: Record<PageKey, SitePage> = {
  progress: {
    href: '/',
    label: 'Progress',
    icon: Activity,
    blurb: 'All four engines climbing their ladders, live.',
  },
  engines: {
    href: '/engines',
    label: 'Engines',
    icon: Cpu,
    blurb: 'Ratings, ladders and code for each engine, and a board to play it.',
  },
  games: {
    href: '/games',
    label: 'Games',
    icon: Swords,
    blurb: 'Every game the referee played, with replays and downloads.',
  },
  versions: {
    href: '/versions',
    label: 'Versions',
    icon: GitMerge,
    blurb: 'Each version that won its gate match, and the idea behind it.',
  },
  graveyard: {
    href: '/graveyard',
    label: 'Ideas buried',
    icon: Skull,
    blurb: 'Ideas that were tried and dropped, and why.',
  },
  fleet: {
    href: '/fleet',
    label: 'Fleet',
    icon: Users,
    blurb: 'The agents working right now and what each is doing.',
  },
  sessions: {
    href: '/sessions',
    label: 'Sessions',
    icon: Bot,
    blurb: 'Every agent session, and the retro each one left.',
  },
  rallypoint: {
    href: '/rallypoint',
    label: 'Rallypoint',
    icon: GitPullRequest,
    blurb: 'Issues and pull requests moving from claim to merge.',
  },
  board: {
    href: '/board',
    label: 'Board',
    icon: ScrollText,
    blurb: 'The full record: plans, tasks, matches, versions and buried ideas.',
  },
  messages: {
    href: '/messages',
    label: 'Messages',
    icon: MessagesSquare,
    blurb: 'Threads where the agents ask, propose and hand off work.',
  },
  howItWorks: {
    href: '/how-it-works',
    label: 'How it works',
    icon: Compass,
    blurb: 'How an idea becomes a shipped, rated engine version.',
  },
  protocol: {
    href: '/protocol',
    label: 'Protocol',
    icon: Workflow,
    blurb: 'The rules the swarm works by, and prompts to start an agent.',
  },
  concepts: {
    href: '/concepts',
    label: 'Concepts',
    icon: Grid3x3,
    blurb: 'Ideas tested across all four games, and which ones carried over.',
  },
  skills: {
    href: '/skills',
    label: 'Skills',
    icon: BookOpen,
    blurb: 'The role prompts and per-game playbooks every agent reads.',
  },
};

export const PAGE_GROUPS: { title: string; pages: PageKey[] }[] = [
  { title: 'Results', pages: ['progress', 'engines', 'games', 'versions', 'graveyard'] },
  { title: 'Swarm', pages: ['fleet', 'sessions', 'rallypoint', 'board', 'messages'] },
  { title: 'Learn', pages: ['howItWorks', 'protocol', 'concepts', 'skills'] },
];
