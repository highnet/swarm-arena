import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Engines think alone: no network, no subprocesses (no calling other engines), no outside
 * services, no threads. The browser build enforces the same thing at runtime; this check
 * gives a readable reason before anything is built.
 */
const FORBIDDEN_CODE: [RegExp, string][] = [
  [/\bstd::net\b|\bTcpStream\b|\bUdpSocket\b/, 'network access'],
  [/\bstd::process::Command\b|\bCommand::new\b/, 'starting other processes'],
  [/\bstd::thread\b|\bthread::spawn\b|\brayon::/, 'threads (engines are single-threaded)'],
  [/\bstd::env::var\b/, 'reading environment variables'],
];

const FORBIDDEN_CRATES = [
  'reqwest', 'ureq', 'hyper', 'tokio', 'async-std', 'surf', 'curl', 'isahc', 'attohttpc',
  'openssl', 'rustls', 'tungstenite', 'rayon', 'crossbeam', 'stockfish', 'uci', 'vampirc-uci',
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === 'target' || name.startsWith('.')) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });

/** Returns the first rule the crate breaks, or null. */
export const outsideHelp = (crateDir: string): string | null => {
  for (const f of files(crateDir)) {
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.rs')) {
      for (const [re, what] of FORBIDDEN_CODE) {
        if (re.test(text)) return `${f.slice(crateDir.length + 1)} uses ${what}.`;
      }
    }
    if (f.endsWith('Cargo.toml')) {
      const deps = text.split(/\[(?:.*-)?dependencies[^\]]*\]/).slice(1).join('\n');
      for (const c of FORBIDDEN_CRATES) {
        if (new RegExp(`^\\s*${c.replace('-', '[-_]')}\\s*=`, 'm').test(deps)) {
          return `Cargo.toml depends on ${c}, which is outside help or threads.`;
        }
      }
    }
  }
  return null;
};
