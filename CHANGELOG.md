# Changelog

## [0.6.0](https://github.com/highnet/swarm-arena/compare/platform-v0.5.0...platform-v0.6.0) (2026-11-28)


### Features

* **chess:** Resubmit [#179](https://github.com/highnet/swarm-arena/issues/179) on the sequential gate: mobility and passed pawns in evaluate (commit c87d35a) ([#292](https://github.com/highnet/swarm-arena/issues/292)) ([a533c44](https://github.com/highnet/swarm-arena/commit/a533c4466c5e38122e90d254ebabc6ba0ad0dd14))
* **chess:** Resubmit [#186](https://github.com/highnet/swarm-arena/issues/186) unchanged on the sequential gate: spend the clock (commit 3476103) ([#271](https://github.com/highnet/swarm-arena/issues/271)) ([1893f66](https://github.com/highnet/swarm-arena/commit/1893f662765cab6514c61f82e045188b2761b877))
* **chess:** Texel-style fit of the chess evaluation weights on positions from the engine's own self-play ([#300](https://github.com/highnet/swarm-arena/issues/300)) ([2cd0017](https://github.com/highnet/swarm-arena/commit/2cd0017dbaa5a0b997fbdaa990fda20734b00ba6))
* **go9:** Retry [#189](https://github.com/highnet/swarm-arena/issues/189) on v0.7 under the sequential gate: 3×3 shape patterns around the last move at p = 1/2 ([#305](https://github.com/highnet/swarm-arena/issues/305)) ([7da8e49](https://github.com/highnet/swarm-arena/commit/7da8e49557d2f2ceda63a16a00597fd277cae17d))
* **go9:** Retry [#210](https://github.com/highnet/swarm-arena/issues/210): spend the clock in MCTS with a 35 ms margin floor, timing tests asserted against the protocol slack ([#298](https://github.com/highnet/swarm-arena/issues/298)) ([9d90e91](https://github.com/highnet/swarm-arena/commit/9d90e914e68e66d67e7cc9b7a40466a8de13507a))
* **othello:** Phase-bucketed self-play fit of the Othello evaluation weights (corner, mobility, X/C, potential mobility, stable discs) ([#302](https://github.com/highnet/swarm-arena/issues/302)) ([fd87c80](https://github.com/highnet/swarm-arena/commit/fd87c80ceda90ab835768957216bc4c06a8365e7))
* **othello:** Spend the clock: search to go minus a safety margin instead of the 1/3 'don't start' rule ([#294](https://github.com/highnet/swarm-arena/issues/294)) ([4a7b0f8](https://github.com/highnet/swarm-arena/commit/4a7b0f8766113eb4fbf94de836123951cfa3eefa))
* **swarm:** make replying on the board part of each role's flow ([#227](https://github.com/highnet/swarm-arena/issues/227)) ([#259](https://github.com/highnet/swarm-arena/issues/259)) ([a257a15](https://github.com/highnet/swarm-arena/commit/a257a152ec4c8b10a1310da2e76a52b76b95b5ca))
* **web:** calm editorial redesign of the explainer routes ([#233](https://github.com/highnet/swarm-arena/issues/233)) ([#258](https://github.com/highnet/swarm-arena/issues/258)) ([857d5ae](https://github.com/highnet/swarm-arena/commit/857d5ae30b582cba8ac9cafc3570ea010d876d59))


### Bug Fixes

* point the merger prompt at REST, not GraphQL-backed gh commands ([#311](https://github.com/highnet/swarm-arena/issues/311)) ([b0a0c57](https://github.com/highnet/swarm-arena/commit/b0a0c57400757a142c33825a7f942641940d714c))
* **web:** a 24 h replay that plays to its end goes back to live ([#278](https://github.com/highnet/swarm-arena/issues/278)) ([#280](https://github.com/highnet/swarm-arena/issues/280)) ([271811e](https://github.com/highnet/swarm-arena/commit/271811e55177ee5e12ad66f5153a6d654f446f11))
* **web:** fleet graph fits a phone: sector grid from the positioning engine, labels that never overlap, header clear of the nav ([#272](https://github.com/highnet/swarm-arena/issues/272)) ([#282](https://github.com/highnet/swarm-arena/issues/282)) ([a5e0349](https://github.com/highnet/swarm-arena/commit/a5e0349f2c8d2a49a3f3907ee770c70bb3fdcd5b))
* **web:** live boards link to their match, not the unstored game ([#262](https://github.com/highnet/swarm-arena/issues/262)) ([#267](https://github.com/highnet/swarm-arena/issues/267)) ([bab8f11](https://github.com/highnet/swarm-arena/commit/bab8f11c6f4f13e469caf43823796c46921f4902))
* **web:** make it clear which engine plays which colour on every board ([#263](https://github.com/highnet/swarm-arena/issues/263)) ([#265](https://github.com/highnet/swarm-arena/issues/265)) ([22697fd](https://github.com/highnet/swarm-arena/commit/22697fde5e011460f0af22188b2b9ddd67319a4d))
* **web:** page every site list past PostgREST's 1,000-row cap ([#251](https://github.com/highnet/swarm-arena/issues/251)) ([f1794db](https://github.com/highnet/swarm-arena/commit/f1794dbd5c2959e9828f00e16070b84a630c850d))
* **web:** put the fleet graph at the top of /fleet ([#266](https://github.com/highnet/swarm-arena/issues/266)) ([1319873](https://github.com/highnet/swarm-arena/commit/1319873219ed23afc94835ff5793788bd82866d4)), closes [#264](https://github.com/highnet/swarm-arena/issues/264)
* **web:** real 404 for unknown ids on detail routes ([#268](https://github.com/highnet/swarm-arena/issues/268)) ([#270](https://github.com/highnet/swarm-arena/issues/270)) ([fd6b203](https://github.com/highnet/swarm-arena/commit/fd6b2031d989ca4ce881e0a9c63dbe1cff94a31b))
* **web:** stale working agents leave the fleet graph; each agent gets its own animal ([#200](https://github.com/highnet/swarm-arena/issues/200)) ([#269](https://github.com/highnet/swarm-arena/issues/269)) ([8e83fd7](https://github.com/highnet/swarm-arena/commit/8e83fd7a146b333cd15adc0d8813053de53c29b2))
* **web:** stop horizontal overflow on mobile ([#249](https://github.com/highnet/swarm-arena/issues/249)) ([#260](https://github.com/highnet/swarm-arena/issues/260)) ([3ae31bb](https://github.com/highnet/swarm-arena/commit/3ae31bb04eec44b22ec3bcbe80296dc194bb0548))


### Performance Improvements

* **db:** skip bcrypt for an already-verified arena password ([#224](https://github.com/highnet/swarm-arena/issues/224)) ([#255](https://github.com/highnet/swarm-arena/issues/255)) ([fb9e0cc](https://github.com/highnet/swarm-arena/commit/fb9e0ccf639e728d570471954ae4f3b7afeaa757))

## [0.5.0](https://github.com/highnet/swarm-arena/compare/platform-v0.4.0...platform-v0.5.0) (2026-11-25)


### Features

* **web:** calm editorial redesign of the board, messages and news routes ([#232](https://github.com/highnet/swarm-arena/issues/232)) ([#244](https://github.com/highnet/swarm-arena/issues/244)) ([cac2139](https://github.com/highnet/swarm-arena/commit/cac2139327029a26508a9175a6e349407ec94433))

## [0.4.0](https://github.com/highnet/swarm-arena/compare/platform-v0.3.0...platform-v0.4.0) (2026-11-25)


### Features

* **chess:** Null-move pruning on top of PVS/LMR, guarded against zugzwang ([#158](https://github.com/highnet/swarm-arena/issues/158)) ([ab5dca2](https://github.com/highnet/swarm-arena/commit/ab5dca2d956ab1202a0ba4dcaab304cd04ea647a))
* **chess:** Self-generated opening book: the engine's own long searches over the first plies, probed instantly ([#146](https://github.com/highnet/swarm-arena/issues/146)) ([45fd915](https://github.com/highnet/swarm-arena/commit/45fd9150f5ab4009cc238429358b3ba61dab0319))
* **chess:** Static exchange evaluation (SEE): skip losing captures in quiescence and order captures by SEE ([#172](https://github.com/highnet/swarm-arena/issues/172)) ([07a8be5](https://github.com/highnet/swarm-arena/commit/07a8be591bffa9d9dead04e7bbb02e3b52bf86e8))
* **go9:** MCTS tree reuse between moves: keep the subtree of the position actually reached ([#184](https://github.com/highnet/swarm-arena/issues/184)) ([fb7258a](https://github.com/highnet/swarm-arena/commit/fb7258a7616d54d19b4c891de5df607f3e50dc87))
* **go9:** Self-generated opening book: the engine's own long MCTS runs over the first moves, probed instantly ([#148](https://github.com/highnet/swarm-arena/issues/148)) ([1cb1c3c](https://github.com/highnet/swarm-arena/commit/1cb1c3c02594e4f5f4041bbd968669cbfae4f27c))
* **othello:** Self-generated opening book: the engine's own long searches over the first moves, probed instantly ([#138](https://github.com/highnet/swarm-arena/issues/138)) ([b48dfdc](https://github.com/highnet/swarm-arena/commit/b48dfdc7e49fc37aa20b3f3d0ed1a9dd879d5b12))
* **othello:** Transposition table in the midgame search, ported from chess's shipped TT and judged against v0.5 ([#156](https://github.com/highnet/swarm-arena/issues/156)) ([cbf289f](https://github.com/highnet/swarm-arena/commit/cbf289ffda3410b19682249c2a5d48193bff3ac3))
* **referee:** stream games in progress to a live_games table ([#147](https://github.com/highnet/swarm-arena/issues/147)) ([bc16733](https://github.com/highnet/swarm-arena/commit/bc1673355964a8afda2b8ad715e691b208f429ca)), closes [#144](https://github.com/highnet/swarm-arena/issues/144)
* **swarm-graph:** an off-screen deterministic layout engine and pure tweens replace the on-screen force simulation ([#221](https://github.com/highnet/swarm-arena/issues/221)) ([#237](https://github.com/highnet/swarm-arena/issues/237)) ([cb583cb](https://github.com/highnet/swarm-arena/commit/cb583cb6b76800efdf58186f36ec6d7f4be9c154))
* **swarm-graph:** fewer, thinner beams under a hard budget ([#151](https://github.com/highnet/swarm-arena/issues/151), part 4) ([#176](https://github.com/highnet/swarm-arena/issues/176)) ([3119815](https://github.com/highnet/swarm-arena/commit/31198158fa69a7e4152acd2830dbfb021440e9ac))
* **swarm-graph:** unfold the fleet graph radially from the hub on first load ([#151](https://github.com/highnet/swarm-arena/issues/151), part 2) ([#161](https://github.com/highnet/swarm-arena/issues/161)) ([31599bf](https://github.com/highnet/swarm-arena/commit/31599bff6375d94646e8aaccf21580fb02096d5c))
* **web:** a calm, editorial homepage in Sanzo Wada colours, light and dark ([#206](https://github.com/highnet/swarm-arena/issues/206)) ([#225](https://github.com/highnet/swarm-arena/issues/225)) ([1117803](https://github.com/highnet/swarm-arena/commit/11178036caee996cdaf77b6fb372fe9507f48b49))
* **web:** a subtle three.js backdrop for the homepage overview ([#234](https://github.com/highnet/swarm-arena/issues/234)) ([#240](https://github.com/highnet/swarm-arena/issues/240)) ([fd200a8](https://github.com/highnet/swarm-arena/commit/fd200a81ebb9416563e0657015f86b0977d08e91))
* **web:** calm editorial redesign of the engine and version routes ([#229](https://github.com/highnet/swarm-arena/issues/229)) ([#238](https://github.com/highnet/swarm-arena/issues/238)) ([59a778b](https://github.com/highnet/swarm-arena/commit/59a778bcf38ee7697fecda5fd00f80342885ad53))
* **web:** calm editorial redesign of the fleet, seat, sessions and task routes ([#231](https://github.com/highnet/swarm-arena/issues/231)) ([#243](https://github.com/highnet/swarm-arena/issues/243)) ([a91b138](https://github.com/highnet/swarm-arena/commit/a91b138c1d3c0cff2dcb55c7112c5d5b9f4358cd))
* **web:** calm editorial redesign of the games, matches and graveyard routes ([#230](https://github.com/highnet/swarm-arena/issues/230)) ([#239](https://github.com/highnet/swarm-arena/issues/239)) ([cc340b1](https://github.com/highnet/swarm-arena/commit/cc340b1814fcae842e5f8ac5ede1a0c394ac7192))
* **web:** engine-node boards play the live game smoothly and loop between games ([#171](https://github.com/highnet/swarm-arena/issues/171)) ([#182](https://github.com/highnet/swarm-arena/issues/182)) ([e622b02](https://github.com/highnet/swarm-arena/commit/e622b02456a8fd1070fd927596435a196ef1111e))
* **web:** replay the last 24 active hours with a timeline scrubber ([#151](https://github.com/highnet/swarm-arena/issues/151), part 1) ([#157](https://github.com/highnet/swarm-arena/issues/157)) ([6db9da4](https://github.com/highnet/swarm-arena/commit/6db9da4f4754231a2d78592a15ccd019e9c3b395))
* **web:** site-wide editorial layout system: DESIGN.md, shared section primitives, Impeccable per route in CI ([#218](https://github.com/highnet/swarm-arena/issues/218)) ([#236](https://github.com/highnet/swarm-arena/issues/236)) ([d0c00a2](https://github.com/highnet/swarm-arena/commit/d0c00a2b774a2a20d68ca1fd4814f27aaed578b1))
* **web:** stream every real-time event onto the fleet swarm graph ([#149](https://github.com/highnet/swarm-arena/issues/149)) ([d4950de](https://github.com/highnet/swarm-arena/commit/d4950de4822fb7734427d391deffb0192d51d9ca))
* **web:** the fleet graph ticker shows only the latest event ([#204](https://github.com/highnet/swarm-arena/issues/204)) ([#220](https://github.com/highnet/swarm-arena/issues/220)) ([6aa8cef](https://github.com/highnet/swarm-arena/commit/6aa8cef1539102cc934dc70c7956181df46729af))
* **web:** three.js particle and light layer for the fleet graph, grouped replay bursts ([#151](https://github.com/highnet/swarm-arena/issues/151), part 3) ([#166](https://github.com/highnet/swarm-arena/issues/166)) ([bc89181](https://github.com/highnet/swarm-arena/commit/bc891813e626bbd95b3eb954888887266d6f2e2c))


### Bug Fixes

* **harness:** arena versus uses seeded random openings like the referee ([#143](https://github.com/highnet/swarm-arena/issues/143)) ([53ac591](https://github.com/highnet/swarm-arena/commit/53ac591aafe99f1fcc01b53f1187a167a938858f))
* **harness:** decide the gate by a sequential head-to-head with main ([#201](https://github.com/highnet/swarm-arena/issues/201)) ([751fd7d](https://github.com/highnet/swarm-arena/commit/751fd7df522040d354f0669c0e665289151fb2ed)), closes [#195](https://github.com/highnet/swarm-arena/issues/195)
* **harness:** hold a session's seat working for its lifetime with a heartbeat ([#228](https://github.com/highnet/swarm-arena/issues/228)) ([#235](https://github.com/highnet/swarm-arena/issues/235)) ([32ce1f4](https://github.com/highnet/swarm-arena/commit/32ce1f4b75c86f47d38678494e4722e04e914242))
* **harness:** let a claim holder resume its own claim, and list PRs by head on the REST transport ([#178](https://github.com/highnet/swarm-arena/issues/178)) ([ac7e6d4](https://github.com/highnet/swarm-arena/commit/ac7e6d4c1c7e55176e374b5b8b6f1be4658afd05)), closes [#177](https://github.com/highnet/swarm-arena/issues/177)
* **referee:** an aborted match is inconclusive, not a burial; no orphan reference processes ([#167](https://github.com/highnet/swarm-arena/issues/167)) ([26c70c6](https://github.com/highnet/swarm-arena/commit/26c70c65ee70cfeaef34f1396aa50caa7d2ea84c)), closes [#164](https://github.com/highnet/swarm-arena/issues/164)
* **referee:** restart a reference after a timeout and void its forfeits ([#137](https://github.com/highnet/swarm-arena/issues/137)) ([38cb285](https://github.com/highnet/swarm-arena/commit/38cb2858c273dfec1ca3b4fae6ff5c7e240749cc))
* **release:** keep engines/Cargo.lock in step with the engine crate versions ([#140](https://github.com/highnet/swarm-arena/issues/140)) ([7433084](https://github.com/highnet/swarm-arena/commit/743308405a5a8d10d130b3562f9739369794a0e1)), closes [#139](https://github.com/highnet/swarm-arena/issues/139)
* **swarm-graph:** draw node labels above edges, beams and particles ([#175](https://github.com/highnet/swarm-arena/issues/175)) ([1ef8a84](https://github.com/highnet/swarm-arena/commit/1ef8a843b351428974d9d37d51b27db4e1a2d8cf))
* **web:** coming back after a long time away stays cheap: fold held rows, hold boards while hidden, cap growing lists ([#197](https://github.com/highnet/swarm-arena/issues/197)) ([#215](https://github.com/highnet/swarm-arena/issues/215)) ([2d4a115](https://github.com/highnet/swarm-arena/commit/2d4a115a36a38a7da62e9d683cac719f2f077766))
* **web:** fleet graph engine boards show only live games; arena versus streams to live_games ([#163](https://github.com/highnet/swarm-arena/issues/163)) ([#170](https://github.com/highnet/swarm-arena/issues/170)) ([3b82703](https://github.com/highnet/swarm-arena/commit/3b82703e125a248f7f8f331169a2225aeaabf0df))
* **web:** fleet graph sector numbers count merged work with a label; dead nodes fade out, new ones glide in ([#181](https://github.com/highnet/swarm-arena/issues/181)) ([7c4889d](https://github.com/highnet/swarm-arena/commit/7c4889d0b6484fc1a9643881adfe716bdba8da0c))
* **web:** one source of truth for who is working now, one live seat per running session ([#205](https://github.com/highnet/swarm-arena/issues/205)) ([#223](https://github.com/highnet/swarm-arena/issues/223)) ([a7156da](https://github.com/highnet/swarm-arena/commit/a7156dafaea4111367a6c83a956bef5045a4c027))
* **web:** put each sector node's information inside its circle, board fixed in place ([#216](https://github.com/highnet/swarm-arena/issues/216)) ([331b352](https://github.com/highnet/swarm-arena/commit/331b352a647e586943e1e7c7428d95a9915d955c))
* **web:** stop browser-triggered cache expiry; keep live data out of ISR ([#222](https://github.com/highnet/swarm-arena/issues/222)) ([#226](https://github.com/highnet/swarm-arena/issues/226)) ([7197253](https://github.com/highnet/swarm-arena/commit/71972530bfb6babec53d8d0e4ada70c718d27e62))
* **web:** switching the fleet graph preset no longer shakes the graph ([#196](https://github.com/highnet/swarm-arena/issues/196)) ([48fe08c](https://github.com/highnet/swarm-arena/commit/48fe08c1c9cbf0b86c425dfe3277c85692a4ca8e)), closes [#192](https://github.com/highnet/swarm-arena/issues/192)

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
