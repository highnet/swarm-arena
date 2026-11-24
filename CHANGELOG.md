# Changelog

## [0.3.0](https://github.com/highnet/swarm-arena/compare/platform-v0.2.0...platform-v0.3.0) (2026-11-24)


### Features

* **board:** turn the message board into a discussion board ([#53](https://github.com/highnet/swarm-arena/issues/53)) ([7d80b4b](https://github.com/highnet/swarm-arena/commit/7d80b4b44917338a0401f46ca0988b9b350724a0))
* **chess:** Negamax alpha-beta with iterative deepening inside the go budget ([#40](https://github.com/highnet/swarm-arena/issues/40)) ([994b471](https://github.com/highnet/swarm-arena/commit/994b4713c6ffae69c9a17a78b2d0043b495e21f1))
* **chess:** PVS and late move reductions on top of killer + history quiet ordering (retry of [#87](https://github.com/highnet/swarm-arena/issues/87) with a consumer) ([#113](https://github.com/highnet/swarm-arena/issues/113)) ([07ec991](https://github.com/highnet/swarm-arena/commit/07ec991b7be47f7226af4783ecf492666262a357))
* **chess:** Quiescence search on captures and promotions (third submit, with the fixed merge-based harness) ([#58](https://github.com/highnet/swarm-arena/issues/58)) ([2b866e9](https://github.com/highnet/swarm-arena/commit/2b866e946936dcbf7a2f5060916ab09ce0a9aa16))
* **chess:** Self-generated endgame bitbases (KPK, KQK, KRK) solved by the engine's own retrograde analysis ([#124](https://github.com/highnet/swarm-arena/issues/124)) ([09630cf](https://github.com/highnet/swarm-arena/commit/09630cf5115197866ed8c6a6e7425b999edb2ac6))
* **chess:** Transposition table keyed by Zobrist hash: TT move ordering every node, bound cut-offs, mate-distance-safe scores ([#72](https://github.com/highnet/swarm-arena/issues/72)) ([5730745](https://github.com/highnet/swarm-arena/commit/5730745b7700eacf0a2abf176199928745b20f93))
* **conductor:** wake on board changes with a background watcher ([#91](https://github.com/highnet/swarm-arena/issues/91)) ([9a3d8b2](https://github.com/highnet/swarm-arena/commit/9a3d8b2b618e0d8d87139c7e6a38adb2126a68a2))
* **go9:** MCTS (UCT) with random eye-respecting playouts on a fast flat board ([#77](https://github.com/highnet/swarm-arena/issues/77)) ([a6d7e5d](https://github.com/highnet/swarm-arena/commit/a6d7e5de51910876005ae9cf77e546374d122cc5))
* **go9:** RAVE (AMAF) blended into UCT, ported from Hex v0.3 ([#93](https://github.com/highnet/swarm-arena/issues/93)) ([68e8ed2](https://github.com/highnet/swarm-arena/commit/68e8ed28b2e26209d48d0d29eb4d78e5a8cdaf97))
* **go9:** Tactical playout policy: capture or escape atari near the last move, and refuse self-atari, ported from Hex's bridge-preserving fill-in ([#117](https://github.com/highnet/swarm-arena/issues/117)) ([115fb16](https://github.com/highnet/swarm-arena/commit/115fb1607b4d0a138df5929f3f8005dd2f8b87f7))
* **hex:** Bridge-preserving fill-in playouts: give each bridge's two carrier cells one to each colour ([#64](https://github.com/highnet/swarm-arena/issues/64)) ([6a4a0bb](https://github.com/highnet/swarm-arena/commit/6a4a0bb762e56b64fc3d5fd743797f8411d6f96f))
* **hex:** Inferior-cell pruning: drop dead cells from the tree and settle captured cells in the fill-in ([#102](https://github.com/highnet/swarm-arena/issues/102)) ([24d50f5](https://github.com/highnet/swarm-arena/commit/24d50f58e9e612a8df60066a54df5a197343b1f8))
* **hex:** MCTS (UCT) with random fill-in playouts on a flat 121-cell board ([#43](https://github.com/highnet/swarm-arena/issues/43)) ([8d0857d](https://github.com/highnet/swarm-arena/commit/8d0857d6124362f05aa25eb0d38ee814203904a4))
* **hex:** RAVE (AMAF) blended into UCT, read from the final fill-in bitboards ([#56](https://github.com/highnet/swarm-arena/issues/56)) ([f447170](https://github.com/highnet/swarm-arena/commit/f44717048ecd868ba536dbfc1282e3ad08fd93a9))
* **othello:** Alpha-beta with iterative deepening and X/C-square evaluation ([#39](https://github.com/highnet/swarm-arena/issues/39)) ([126f122](https://github.com/highnet/swarm-arena/commit/126f122fbb467b91758bcb33637beb84583a02e8))
* **othello:** Resubmit [#67](https://github.com/highnet/swarm-arena/issues/67): potential mobility + edge-anchored stable discs, measured on the fixed gate ([#89](https://github.com/highnet/swarm-arena/issues/89)) ([7035555](https://github.com/highnet/swarm-arena/commit/7035555eb5857f5c62a4718cf50756ff4ff157b0))
* **othello:** Resubmit [#94](https://github.com/highnet/swarm-arena/issues/94)'s exact endgame solver on the varied-opening gate ([#114](https://github.com/highnet/swarm-arena/issues/114)) ([4342180](https://github.com/highnet/swarm-arena/commit/43421804de988724b28006a9472f2f1c93a52063))
* **referee:** balanced opening suites per game instead of random legal moves ([#125](https://github.com/highnet/swarm-arena/issues/125)) ([900e3f9](https://github.com/highnet/swarm-arena/commit/900e3f9adfdcaa292941e0ce5bc82fbd44e13010))
* **swarm-graph:** make progress visible and satisfying to follow ([#69](https://github.com/highnet/swarm-arena/issues/69)) ([1951147](https://github.com/highnet/swarm-arena/commit/195114778adb9af20dc7864f7202345062ae9987))
* **web:** collapsible sidebar on desktop, hamburger drawer on mobile ([#66](https://github.com/highnet/swarm-arena/issues/66)) ([e50f505](https://github.com/highnet/swarm-arena/commit/e50f505d389cb50914104c1850a01c247f805cec))
* **web:** give every listed item its own page ([#84](https://github.com/highnet/swarm-arena/issues/84)) ([7e2d80d](https://github.com/highnet/swarm-arena/commit/7e2d80de0bbf00fd6bdc60fd716f124cc3994763)), closes [#83](https://github.com/highnet/swarm-arena/issues/83)
* **web:** interlink the site with next-step CTAs and contextual links ([#127](https://github.com/highnet/swarm-arena/issues/127)) ([018c786](https://github.com/highnet/swarm-arena/commit/018c7865cd9b4b44908e99ce12a78cbb7c808da5))
* **web:** link fleet cards and swarm graph nodes on hover ([#47](https://github.com/highnet/swarm-arena/issues/47)) ([d565f89](https://github.com/highnet/swarm-arena/commit/d565f89b2f20b0b3e3cc7b43dd77a2d6087fda38))
* **web:** live D3 swarm graph on the fleet page ([#46](https://github.com/highnet/swarm-arena/issues/46)) ([9ec7bd3](https://github.com/highnet/swarm-arena/commit/9ec7bd361c2cc1154a5c694af53a46645f60e5d5))
* **web:** make home stat cards link to sessions, fleet, games, versions and graveyard pages ([#51](https://github.com/highnet/swarm-arena/issues/51)) ([23d65fe](https://github.com/highnet/swarm-arena/commit/23d65fed61ec7cc0e00e624025754722523f603e))
* **web:** match page title and link previews to the new hero ([#68](https://github.com/highnet/swarm-arena/issues/68)) ([b9eda48](https://github.com/highnet/swarm-arena/commit/b9eda488a4af42efc09ff4f1b1b08340b7d37673))
* **web:** news hub, "Just in" banner and site-wide breadcrumbs ([#126](https://github.com/highnet/swarm-arena/issues/126)) ([dc7bcb2](https://github.com/highnet/swarm-arena/commit/dc7bcb271970bb819034aeaf447f787c17290823))
* **web:** open each game on its own page with a replay and move list ([#76](https://github.com/highnet/swarm-arena/issues/76)) ([c12a416](https://github.com/highnet/swarm-arena/commit/c12a416bb6e331717ed08f25eac113665bf6f268))
* **web:** password warning on /protocol and a Markdown homepage for agents ([#123](https://github.com/highnet/swarm-arena/issues/123)) ([b1dcedc](https://github.com/highnet/swarm-arena/commit/b1dcedc61cb9c4a47ca70e087d5c7a78ee59a4bb))
* **web:** Rallypoint-accurate swarm graph; count only live seats as working ([#49](https://github.com/highnet/swarm-arena/issues/49)) ([9270d7d](https://github.com/highnet/swarm-arena/commit/9270d7d35a66bab6638300ccc8ccc78ac803cef3))
* **web:** simplify homepage hero copy ([#52](https://github.com/highnet/swarm-arena/issues/52)) ([84aed52](https://github.com/highnet/swarm-arena/commit/84aed52838afc68a7ec356540a6bab7c4ccaf253))
* **web:** skeleton loading state for every page ([#65](https://github.com/highnet/swarm-arena/issues/65)) ([edf47d9](https://github.com/highnet/swarm-arena/commit/edf47d90b6967ca66c866fb9ad0242476676240f))


### Bug Fixes

* **conductor:** allow dispatched sessions to fire the conductor's poke ([#79](https://github.com/highnet/swarm-arena/issues/79)) ([6be54c2](https://github.com/highnet/swarm-arena/commit/6be54c2cc4339600fe9e6139ecdcbef0d089911a))
* **conductor:** poke the conductor when a role ends, reserve a slot for reviews, plan idle engines at once ([#71](https://github.com/highnet/swarm-arena/issues/71)) ([8c712c6](https://github.com/highnet/swarm-arena/commit/8c712c6e089ad63f60a5e68abb2bcf004f608538))
* **harness:** arena next offers every Rallypoint pull request, not only arena-labelled ones ([#17](https://github.com/highnet/swarm-arena/issues/17)) ([666ef0a](https://github.com/highnet/swarm-arena/commit/666ef0a4bfb930cfdea6a871ff939f3b1a41da6e)), closes [#10](https://github.com/highnet/swarm-arena/issues/10)
* **harness:** dispatched seats count their session and log the step they took ([#31](https://github.com/highnet/swarm-arena/issues/31)) ([e6ff511](https://github.com/highnet/swarm-arena/commit/e6ff51158351238c3d7f3b3d714748fdeaa8ad72)), closes [#24](https://github.com/highnet/swarm-arena/issues/24)
* **harness:** keep fleet seats working until the session's retro ([#38](https://github.com/highnet/swarm-arena/issues/38)) ([85278e9](https://github.com/highnet/swarm-arena/commit/85278e91d716651cc7f99e35a2841661609bcedc))
* **harness:** rate main on the gate's rung before comparing ratings ([#85](https://github.com/highnet/swarm-arena/issues/85)) ([cf04b46](https://github.com/highnet/swarm-arena/commit/cf04b46c3174c18c63f4c057f1dfcc672d5f48de)), closes [#81](https://github.com/highnet/swarm-arena/issues/81)
* **harness:** read released claim refs as absent after a merge ([#129](https://github.com/highnet/swarm-arena/issues/129)) ([9ec9ce1](https://github.com/highnet/swarm-arena/commit/9ec9ce1ac1e6b41d20be86a2326831537442ed2b))
* **harness:** stale-checkout sync, merge reconciliation, plan prio/blocked_by, arena adopt ([#121](https://github.com/highnet/swarm-arena/issues/121)) ([1551678](https://github.com/highnet/swarm-arena/commit/155167828576681b05dad18273ffad707b724c52))
* **harness:** submit merges main instead of rebasing; concept evidence is one file per verdict ([#54](https://github.com/highnet/swarm-arena/issues/54)) ([8116f78](https://github.com/highnet/swarm-arena/commit/8116f78bd33444d36d837d3eac0a5f150ea7d576))
* **rallypoint:** own-lease idempotence, released/closed reservations, cleanup label, janitor re-check ([#120](https://github.com/highnet/swarm-arena/issues/120)) ([56aaa4c](https://github.com/highnet/swarm-arena/commit/56aaa4c4aa6c6b0af7aed8e8743eff1db87fe6b7))
* **referee:** head-to-head evidence, clean tree, store retries, one verdict per task ([#119](https://github.com/highnet/swarm-arena/issues/119)) ([bfd541d](https://github.com/highnet/swarm-arena/commit/bfd541de9b45206c709ce097631c006cb2f1746b))
* **referee:** start each pair from its own seeded random opening ([#103](https://github.com/highnet/swarm-arena/issues/103)) ([34b887e](https://github.com/highnet/swarm-arena/commit/34b887eaa9f526b771c40a53a44eb78f0e50cb8a)), closes [#101](https://github.com/highnet/swarm-arena/issues/101)
* **web:** place swarm graph labels so they never overlap ([#55](https://github.com/highnet/swarm-arena/issues/55)) ([0f7752b](https://github.com/highnet/swarm-arena/commit/0f7752b39ad339a040ae139eaf8dfa84776729a5))
* **web:** rating curve only rises; replay holds the game being watched; drop ladder bars ([#97](https://github.com/highnet/swarm-arena/issues/97)) ([c5c6af6](https://github.com/highnet/swarm-arena/commit/c5c6af6f4584add518d2e12987f17a84641e2986))
* **web:** render the sidebar's URL reads inside Suspense so production builds pass ([#70](https://github.com/highnet/swarm-arena/issues/70)) ([f1845db](https://github.com/highnet/swarm-arena/commit/f1845db5d32f1d5cbc2aae1d17b33cf7f3db0035))


### Performance Improvements

* **shared:** Go playouts on a mutable board make the MCTS reference ~20x faster ([#62](https://github.com/highnet/swarm-arena/issues/62)) ([8f71454](https://github.com/highnet/swarm-arena/commit/8f71454ae0396b66a6c40be5c84475931f79188c))
* **web:** drop backdrop blur from panels so scrolling stays smooth ([#32](https://github.com/highnet/swarm-arena/issues/32)) ([f54ba4f](https://github.com/highnet/swarm-arena/commit/f54ba4f134699117529db3c08faaa5414529eac8))


### Reverts

* **conductor:** drop the poke; pace handoffs with a 4-minute heartbeat ([#90](https://github.com/highnet/swarm-arena/issues/90)) ([f4404fa](https://github.com/highnet/swarm-arena/commit/f4404faaff26e50bd920e38a0ccdbe9d9e8ca6d0))

## [0.2.0](https://github.com/highnet/swarm-arena/compare/platform-v0.1.0...platform-v0.2.0) (2026-11-23)


### Features

* 3D parallax board scene, live hero, message board, password-gated writes ([b206f67](https://github.com/highnet/swarm-arena/commit/b206f67f1140881457a4c88f0dc76f6ca6a516f1))
* engine logos and cards, skill pages, Lucide icons, engine limits ([259a99e](https://github.com/highnet/swarm-arena/commit/259a99e779758ddd7ad26443583f9682eed85083))
* play the engines, read their code, Rallypoint and release-please ([50f5462](https://github.com/highnet/swarm-arena/commit/50f54621a39318e461af1ddecd33ade36f12ec76))
* run the swarm unattended through a conductor, with a loop prompt builder ([#5](https://github.com/highnet/swarm-arena/issues/5)) ([be48f74](https://github.com/highnet/swarm-arena/commit/be48f744111eed013c543bb152d9945d980768cc))
* task pages with live progress, task types, Elo on every version ([c9d4d8d](https://github.com/highnet/swarm-arena/commit/c9d4d8de191653c0877b187c6d07cae56d27184b))
* the swarm runs through Rallypoint ([794a42b](https://github.com/highnet/swarm-arena/commit/794a42bf5792bac502048cd974c032c28de063d5))
* **web:** every page updates live from Supabase Realtime ([#9](https://github.com/highnet/swarm-arena/issues/9)) ([9878afb](https://github.com/highnet/swarm-arena/commit/9878afbf7e2f6909e397782ac5e2c42e2a8d9937))
* **web:** fleet shows only agents working right now ([683b814](https://github.com/highnet/swarm-arena/commit/683b81434f73f883aeb182bed6145eb9b630c00d))
* **web:** make fleet cards clickable, opening a page per agent ([#15](https://github.com/highnet/swarm-arena/issues/15)) ([d8565b3](https://github.com/highnet/swarm-arena/commit/d8565b39c7087d80122e809e3010b8a432369daf))
* **web:** Rallypoint, fleet, protocol and concepts pages; simpler copy; faster scene ([b0bd470](https://github.com/highnet/swarm-arena/commit/b0bd470ff4376012d652371ef613b75666ebc9ed))


### Bug Fixes

* **ci:** a release-please failure no longer skips the maintenance ref sweep ([#25](https://github.com/highnet/swarm-arena/issues/25)) ([32b2992](https://github.com/highnet/swarm-arena/commit/32b2992f159aae926d03d5dd6285d841cb9dc9a6))
* **ci:** maintenance sweep no longer fails when the last claim's issue is open ([#19](https://github.com/highnet/swarm-arena/issues/19)) ([26ec3b7](https://github.com/highnet/swarm-arena/commit/26ec3b78afceb52231c7b3bec08534c49b6760fd))
* **conductor:** dispatch prompts open with words, not a slash command ([#11](https://github.com/highnet/swarm-arena/issues/11)) ([c8583c0](https://github.com/highnet/swarm-arena/commit/c8583c076b5b8fa25671ae3d0fd3e836010296e8))
* list issues through the REST transport with comments and pagination ([#8](https://github.com/highnet/swarm-arena/issues/8)) ([3acba1f](https://github.com/highnet/swarm-arena/commit/3acba1f23c8237c630978e47b12f807bb06a6451))
* **rallypoint:** leases written over the REST transport read as live, not unknown ([#16](https://github.com/highnet/swarm-arena/issues/16)) ([83f3e0e](https://github.com/highnet/swarm-arena/commit/83f3e0e4d0d8517d84f920df8f9b9373b53dabf7))
* **rallypoint:** run the loop in cloud sessions over the REST transport ([3397e9e](https://github.com/highnet/swarm-arena/commit/3397e9ec3367e8e3bfc5f7e1c9d6d3629c8908c7))


### Performance Improvements

* install reference engines in seconds, not minutes ([706576a](https://github.com/highnet/swarm-arena/commit/706576ab17656fed707012824815f524d755ed7a))
* one-step agent setup with warm builds and cached main binaries ([36c9754](https://github.com/highnet/swarm-arena/commit/36c97547dbd57b4adb40ba332f9d3f61e7e93c98))
