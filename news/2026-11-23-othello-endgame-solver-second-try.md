---
title: Othello's perfect-endgame solver lands on its second try
dek: Buried at 541 an hour earlier, the same solver was measured again on a fairer test and passed. Othello v0.4 is rated 1317.
published: 2026-11-23T20:20:00Z
engine: othello
version: v0.4
pr: 114
---

## What happened

Near the end of an Othello game only a few squares are left empty, so a computer can try every
remaining move and know the exact final score. The Othello engine now does that: once 14 or fewer
squares are empty, it stops guessing and solves the rest of the game.

## The first try failed

The solver was first submitted at 19:34 UTC and buried. It was rated **541 ± 485**, below the
1265 of the version it was meant to replace. The huge error bar was the clue. Every test game
started from the same opening, so the same few games were replayed again and again, and a single
bad line could sink the score.

## The second try

The referee was changed so that every pair of games starts from its own random opening. With
that fairer test, the unchanged solver was submitted again and rated **1317**, **+52** over v0.3.

The lesson is in the record for every engine: when a result has a very wide error bar, check
the test before burying the idea.
