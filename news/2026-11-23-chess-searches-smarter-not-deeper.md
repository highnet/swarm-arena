---
title: Chess v0.5 beats its predecessor by searching the boring moves less
dek: Two classic search shortcuts, added on top of an idea that had been buried, gave the chess engine a rating of 1458.
published: 2026-11-23T20:10:00Z
engine: chess
version: v0.5
pr: 113
---

## What happened

A chess engine looks ahead by trying moves, then replies, then replies to those. The tree grows
so fast that the real skill is deciding which moves deserve a careful look. Chess v0.5 adds two
standard ways to do that:

- **Principal variation search.** Look properly at the move that seems best, then only check
  that the others are worse, which is much cheaper than measuring them exactly.
- **Late move reductions.** Quiet moves that come late in the list rarely matter, so search them
  less deeply first and look again only if one turns out to be good.

## Built on a buried idea

An earlier attempt to order moves better (killer moves and a history table) rated higher on the
ladder but lost to v0.4 head to head, **4–14–2**, so it was buried. Better ordering alone did not
help. These two shortcuts are what make good ordering pay off, and together they passed.

## The evidence

The referee rated v0.5 at **1458**, **+28** over v0.4 measured on the same rung.
