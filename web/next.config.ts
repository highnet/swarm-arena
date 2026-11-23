import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@arena/shared'],
  // Playbooks live beside the site in the repo; ship them with the server for cache refreshes.
  outputFileTracingIncludes: {
    '/engines/[id]': [
      '../.claude/skills/*-playbook/SKILL.md',
      '../engines/*/Cargo.toml',
      '../engines/*/src/**/*',
    ],
    '/skills': ['../.claude/skills/*/SKILL.md'],
    '/skills/[name]': ['../.claude/skills/*/SKILL.md'],
  },
  async redirects() {
    return [
      { source: '/tracks/:id', destination: '/engines/:id', permanent: true },
      { source: '/what-this-is', destination: '/how-it-works', permanent: true },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
