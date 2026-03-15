# Changelog

## [1.2.0](https://github.com/hottim900/sparkle/compare/v1.1.1...v1.2.0) (2026-03-15)


### Features

* add categories CRUD API and integrate into items ([#53](https://github.com/hottim900/sparkle/issues/53)) ([d87dd82](https://github.com/hottim900/sparkle/commit/d87dd82ca7d271c6525b137f1bd3dbe10fec68f0))
* add categories table and category_id to items (migration 12→13) ([#52](https://github.com/hottim900/sparkle/issues/52)) ([8094b20](https://github.com/hottim900/sparkle/commit/8094b2034e3dc41f2e0b772e10ebd1d3108adcfe))
* add category frontend UI, MCP tools, and documentation ([#54](https://github.com/hottim900/sparkle/issues/54)) ([80f871b](https://github.com/hottim900/sparkle/commit/80f871b989cd78917cf905b2e1b46861637023d3))
* add category management UI ([#72](https://github.com/hottim900/sparkle/issues/72)) ([80d9fff](https://github.com/hottim900/sparkle/commit/80d9fff79a981c4995643babf7c37726deb17bb7))
* add category select to fleeting triage ([#58](https://github.com/hottim900/sparkle/issues/58)) ([b5da37e](https://github.com/hottim900/sparkle/commit/b5da37eb5fab7962b8d7f56e8172260a01e9ee8d))
* add standalone share management page ([#49](https://github.com/hottim900/sparkle/issues/49)) ([ee50eac](https://github.com/hottim900/sparkle/commit/ee50eac89db45c14d2c4bc47f1e45889407a1981))
* display item ID in detail view metadata ([#85](https://github.com/hottim900/sparkle/issues/85)) ([e5a12c7](https://github.com/hottim900/sparkle/commit/e5a12c76e9106fbfa4d4579f0e941e4fafc9cfc4))
* migrate to TanStack Router file-based routing ([#97](https://github.com/hottim900/sparkle/issues/97)) ([101aac5](https://github.com/hottim900/sparkle/commit/101aac50df8510612db019a1e73659920c5c9023))
* move metadata below title in detail view ([#86](https://github.com/hottim900/sparkle/issues/86)) ([dbabac0](https://github.com/hottim900/sparkle/commit/dbabac08d0a1352f6933654c3ce6c0c841b12801))
* redesign dashboard with Zettelkasten flow focus ([#74](https://github.com/hottim900/sparkle/issues/74)) ([348efc3](https://github.com/hottim900/sparkle/commit/348efc33581b1326b8a1f84755a7f488a27c3f88))
* show category color dot in list group headers ([#73](https://github.com/hottim900/sparkle/issues/73)) ([7366d53](https://github.com/hottim900/sparkle/commit/7366d5329b9c0b09d5ca4d961bb1153ddfb728e7))
* show short ID with click-to-copy full UUID ([#87](https://github.com/hottim900/sparkle/issues/87)) ([d061a38](https://github.com/hottim900/sparkle/commit/d061a389c0e1aaf98421fce4d98fb81a503c613f))
* support short ID prefix lookup in GET /api/items/:id ([#89](https://github.com/hottim900/sparkle/issues/89)) ([825b000](https://github.com/hottim900/sparkle/commit/825b0005c3593864ff20df441dabbebf619a8009))


### Bug Fixes

* add aria-label to all icon-only buttons (FG-001) ([#107](https://github.com/hottim900/sparkle/issues/107)) ([508c8dd](https://github.com/hottim900/sparkle/commit/508c8dd162fdec5d0e7c44a27366e69a3b56b44d))
* add error logging to LINE search catch and harden short ID prefix lookup (DEF-012, DEF-013) ([#100](https://github.com/hottim900/sparkle/issues/100)) ([e9c8200](https://github.com/hottim900/sparkle/commit/e9c8200fa79648e82bbc95ade7e137bb214ad386))
* add ErrorBoundary to list Outlet and error state UI (DEF-015, DEF-016) ([#106](https://github.com/hottim900/sparkle/issues/106)) ([66a01db](https://github.com/hottim900/sparkle/commit/66a01db470c728385d61b72e549c553a50314f20))
* add export API result limit (DEF-009) ([#78](https://github.com/hottim900/sparkle/issues/78)) ([5443729](https://github.com/hottim900/sparkle/commit/5443729ede439e5b460bbdfc4afbc0a71861f9de))
* add offline sync failure notification and status SSOT guard ([#65](https://github.com/hottim900/sparkle/issues/65)) ([4b884ef](https://github.com/hottim900/sparkle/commit/4b884efb61f2a5d111dc30b489c2194a54e52125))
* add response.ok check to SW replayQueue and safe JSON parse (DEF-001, DEF-008) ([#76](https://github.com/hottim900/sparkle/issues/76)) ([8d8a6cf](https://github.com/hottim900/sparkle/commit/8d8a6cf5bde1c08eca77da72077b0064ace05e85))
* add revoke confirmation dialog, accessibility, and E2E tests for share management ([#51](https://github.com/hottim900/sparkle/issues/51)) ([dd40c5a](https://github.com/hottim900/sparkle/commit/dd40c5ad5dffc5c4f44267456ff1427efc4faedc))
* auto-focus category create input after Radix Select closes ([#57](https://github.com/hottim900/sparkle/issues/57)) ([7b933b2](https://github.com/hottim900/sparkle/commit/7b933b28c3731aff0b69e4eb690bea284834cab8))
* auto-reload on CF Access session expiry instead of showing error ([#96](https://github.com/hottim900/sparkle/issues/96)) ([432f645](https://github.com/hottim900/sparkle/commit/432f6456d76e6bbf59c9f7ad5a40937d7972034f))
* close DEF-010 and DEF-011 quality defects ([#99](https://github.com/hottim900/sparkle/issues/99)) ([cd54b09](https://github.com/hottim900/sparkle/commit/cd54b09c3a870df26f8ce2c9185b9575de7465a5))
* close DEF-012, DEF-013, DEF-014 quality defects ([#101](https://github.com/hottim900/sparkle/issues/101)) ([1f23fd5](https://github.com/hottim900/sparkle/commit/1f23fd5c6abf4c8e4e03f65f5aceb35146537ce9))
* close quality defects and improve AI dev efficiency (DEF-012~014, TD-003, TD-007~008, FG-002) ([#103](https://github.com/hottim900/sparkle/issues/103)) ([cfa35fd](https://github.com/hottim900/sparkle/commit/cfa35fde5f838cca6add0cab5904aae40f286473))
* complete React Query invalidation and adjust staleTime (DEF-002, TD-002) ([#77](https://github.com/hottim900/sparkle/issues/77)) ([bd4a6da](https://github.com/hottim900/sparkle/commit/bd4a6dae3f2071a049bfebc9e00b0a48a30e5704))
* don't serve stale API cache when online and fetch fails ([#90](https://github.com/hottim900/sparkle/issues/90)) ([e965e00](https://github.com/hottim900/sparkle/commit/e965e00b0f9a25a1ae5fd3bff9aa9c3c3764e88d))
* eliminate fixed-positioning layout pollution in mobile view ([#62](https://github.com/hottim900/sparkle/issues/62)) ([f91ada4](https://github.com/hottim900/sparkle/commit/f91ada4dc3a8231f64b620826dd2e5c5062b1bcf))
* eliminate silent failures and harden error handling ([#64](https://github.com/hottim900/sparkle/issues/64)) ([9a2b8c1](https://github.com/hottim900/sparkle/commit/9a2b8c1f210a1cf73d6241d64de08184a9f767f1))
* forward enrich param in all resolveLinkedInfo call sites ([#115](https://github.com/hottim900/sparkle/issues/115)) ([77b8545](https://github.com/hottim900/sparkle/commit/77b85454747a3bff8fdfe026c67515e62e49d86e))
* make deploy resilient to non-main branch checkout ([#59](https://github.com/hottim900/sparkle/issues/59)) ([757968e](https://github.com/hottim900/sparkle/commit/757968edb86c611346af2202e88859d2bea195ac))
* patch 4 high-ROI defects from systematic audit ([#63](https://github.com/hottim900/sparkle/issues/63)) ([251698a](https://github.com/hottim900/sparkle/commit/251698a11678436c209ab16d63fc264664079f86))
* preserve search params on navigate + remove type casts (DEF-017, TD-004) ([#113](https://github.com/hottim900/sparkle/issues/113)) ([06291cc](https://github.com/hottim900/sparkle/commit/06291cc5a846068f28f5e6312084ec25abda95b2))
* prevent SW from caching CF Access pages after idle ([#88](https://github.com/hottim900/sparkle/issues/88)) ([15d2ac1](https://github.com/hottim900/sparkle/commit/15d2ac1237e0546221a69655b2811d58de04b125))
* strengthen schema validation (DEF-003~007) ([#75](https://github.com/hottim900/sparkle/issues/75)) ([a6c292f](https://github.com/hottim900/sparkle/commit/a6c292fef61bf42f59e94bac7a32b7be53c65ed0))
* update local state when selecting category in ItemDetail ([#55](https://github.com/hottim900/sparkle/issues/55)) ([5f5423e](https://github.com/hottim900/sparkle/commit/5f5423eb41779401bdb6cb5e04ca6bfff138f9ee))
* use absolute paths in quality skill for worktree compatibility ([#67](https://github.com/hottim900/sparkle/issues/67)) ([933a305](https://github.com/hottim900/sparkle/commit/933a305fa94706fce2c8cfe81aa69eddddf7fbcc))
* use safe deploy pull and add worktree convention ([#60](https://github.com/hottim900/sparkle/issues/60)) ([61e7a16](https://github.com/hottim900/sparkle/commit/61e7a16488c4b7c7da0346747fd99ce776062223))


### Performance Improvements

* replace batch endpoint N+1 loops with bulk SQL queries (TD-003) ([#102](https://github.com/hottim900/sparkle/issues/102)) ([6c4114e](https://github.com/hottim900/sparkle/commit/6c4114e036f40cf4584cedd4de7594fd192aff83))

## [1.1.1](https://github.com/hottim900/sparkle/compare/v1.1.0...v1.1.1) (2026-03-03)


### Bug Fixes

* correct precacheAndRoute directoryIndex type (null → undefined) ([#47](https://github.com/hottim900/sparkle/issues/47)) ([439e029](https://github.com/hottim900/sparkle/commit/439e029a953980f00f8f4441d874eb232377fcec))
* resolve mobile web stuck in offline mode ([#44](https://github.com/hottim900/sparkle/issues/44)) ([a6ebbbd](https://github.com/hottim900/sparkle/commit/a6ebbbdf800aab34e793f34b540373064386bbf5))

## [1.1.0](https://github.com/hottim900/sparkle/compare/v1.0.0...v1.1.0) (2026-03-01)


### Features

* add offsite backup to secondary disk via restic copy ([584196d](https://github.com/hottim900/sparkle/commit/584196db5875ac4470c1a36a77de727211bbcbeb))
* honest offline UI — disable mutations when offline ([37443f9](https://github.com/hottim900/sparkle/commit/37443f93d6e21b77c3a5494c43fceb9dd448db17))
* offline indicator, CF Access JWT handling, mobile E2E tests ([#22](https://github.com/hottim900/sparkle/issues/22)) ([4216446](https://github.com/hottim900/sparkle/commit/42164464aa25c38d8d9516b5f7a8943317f3d548))
* project hardening — offsite backup, FK constraint, offline UI ([80721c8](https://github.com/hottim900/sparkle/commit/80721c8f65283fd88a29716faa0e6d34732ebfab))


### Bug Fixes

* add FK constraint on linked_note_id with ON DELETE SET NULL ([794178c](https://github.com/hottim900/sparkle/commit/794178c21a1dd8f8644e04893f77b056f4c26863))
* handle NULL timestamps in migration 11→12 ([b28200d](https://github.com/hottim900/sparkle/commit/b28200db348e2092096e2f5400bf6953023316d0))
* handle NULL timestamps in migration 11→12 to prevent crash ([65d94ec](https://github.com/hottim900/sparkle/commit/65d94ec7bfd0c71724c9a0755db385130f1762fc))
* schedule periodic cleanup of expired LINE Bot sessions ([070378e](https://github.com/hottim900/sparkle/commit/070378e4ae5466b196e3436d88a9ac685b4f63bc))
* schedule periodic cleanup of expired LINE Bot sessions ([626bd70](https://github.com/hottim900/sparkle/commit/626bd70bb0e13eec3000828315235d65de60817a))
* use explicit column names in migration 11→12 INSERT ([5120c50](https://github.com/hottim900/sparkle/commit/5120c50d2f41d637aba82d9980a55e5a3e195d33))
* use explicit column names in migration INSERT ([5b7d903](https://github.com/hottim900/sparkle/commit/5b7d903161282dac95ac1f3e265e316266918ac5))

## 1.0.0 (2026-03-01)


### Features

* add !done and !archive command parsing ([4e16cad](https://github.com/hottim900/sparkle/commit/4e16cad732f119236c8adc9eccb647fbc0549601))
* add !done, !archive, !priority, !untag LINE Bot commands ([febf2f2](https://github.com/hottim900/sparkle/commit/febf2f20e3c523938815024eb48cba6f391fc1fa))
* add !priority command parsing ([e7ec63f](https://github.com/hottim900/sparkle/commit/e7ec63f779a997a3475a345ee55103d1a1b14f9c))
* add !untag command parsing ([7bcc6f9](https://github.com/hottim900/sparkle/commit/7bcc6f98444abcf61d833c40acf00f1139369a08))
* add /api/stats and /api/stats/focus endpoints ([5cd829c](https://github.com/hottim900/sparkle/commit/5cd829c5f427a136980dd281f326c81671bbdcfe))
* add commitlint, E2E tests, MCP tests, and CI hardening ([9716dda](https://github.com/hottim900/sparkle/commit/9716ddabf7d6991ced4aae708f2b8547e3edb565))
* add dark mode support with next-themes ([962ebf0](https://github.com/hottim900/sparkle/commit/962ebf0ff9df83bbf53dcea46dcbe2bf5a5ffd41))
* add due date indicators, enhanced search, Docker support, UX polish, and API tests ([12c9887](https://github.com/hottim900/sparkle/commit/12c988723fcd7d74524a7883b577d502872b0e77))
* add frontend tests, split item-detail, and introduce AppContext ([a24d4ab](https://github.com/hottim900/sparkle/commit/a24d4ab1ac7656f6b77257806fc01d2dedcd4a11))
* add health endpoint, CSP header, structured logging, and test utils ([f0c8687](https://github.com/hottim900/sparkle/commit/f0c868734befbc0651c75689e7f0e0471c2f18e3))
* add LINE Bot edit and browse commands (!active, !list, !detail, !due, !tag) ([9293d49](https://github.com/hottim900/sparkle/commit/9293d491c83e131cc1f0dfef68cb1280af91b17d))
* add LINE Bot help command and quick reply buttons ([f723b61](https://github.com/hottim900/sparkle/commit/f723b61690239f2db50540e4e1394fdb21c6a9e3))
* add LINE Bot query commands (!find, !inbox, !today, !stats) ([b46a8f4](https://github.com/hottim900/sparkle/commit/b46a8f4ad300d97484bf2ce1614d82d19a1628a2))
* add LINE Bot scratch commands (!tmp, !scratch, !s, !delete, !upgrade) ([0671db3](https://github.com/hottim900/sparkle/commit/0671db3a888cd800aa031aa942251c76dee6bb88))
* add LINE message parser with prefix commands ([716a39c](https://github.com/hottim900/sparkle/commit/716a39c3542cce12bed79399b967c9a19b8135c3))
* add LINE webhook endpoint with signature verification ([0654b65](https://github.com/hottim900/sparkle/commit/0654b6515dfd717f4b544aee1fc168fbeeadeb8c))
* add linked todo — create tracking todo from note with !track command ([a692833](https://github.com/hottim900/sparkle/commit/a692833493f916668e23d6dbedc9a7be9a948d30))
* add local observability (enhanced health check + monitoring scripts) ([f3c33e1](https://github.com/hottim900/sparkle/commit/f3c33e17c8b740d30e5991d12c430232182ce89f))
* add markdown preview, data export/import, keyboard shortcuts, and batch operations ([193fe16](https://github.com/hottim900/sparkle/commit/193fe167dc485c2d63cc1ebf2673525def12fa83))
* add navigation stack for detail page back button ([f48d071](https://github.com/hottim900/sparkle/commit/f48d071368aed3d1c6f1494f98a3aa1c98cf000d))
* add notes/todos filter views and update app icons ([3288665](https://github.com/hottim900/sparkle/commit/32886655ebe3b25dbe1e752680a7692438893ef3))
* add optional HTTPS/TLS support to server ([46e212e](https://github.com/hottim900/sparkle/commit/46e212e4f5cace1afc29482cf4d333425fd60eb0))
* add public note sharing with token-based URLs ([8da0a15](https://github.com/hottim900/sparkle/commit/8da0a15b57ffffd7d99ad504bb2e8232fa7e4fb1))
* add PWA install prompt, desktop 3-column layout, tag autocomplete and source field ([0a0a875](https://github.com/hottim900/sparkle/commit/0a0a875d246e0b23f83c244397727a076c2aabab))
* add review dashboard with stats, focus, and inbox health ([7db5039](https://github.com/hottim900/sparkle/commit/7db5039f3bf9fb61cae2c82adc7c70e03f8f8bfa))
* add scratch count to dashboard and update CLAUDE.md ([054e4e5](https://github.com/hottim900/sparkle/commit/054e4e5c35fa096b0c3e2538d656c8382092e2db))
* add scratch routing, filtering, and batch actions to frontend ([8f14243](https://github.com/hottim900/sparkle/commit/8f14243a7fffc0dce3754c426481679ada79d0f1))
* add scratch type conversion mapping and field clearing ([ecb6366](https://github.com/hottim900/sparkle/commit/ecb636647ffdca9601fdd31f9c10f5c57bb89242))
* add scratch type to frontend types and navigation ([257da6f](https://github.com/hottim900/sparkle/commit/257da6f0be30b4a624801c55384a9f72042d9907))
* add scratch type with draft status to type system ([660cc3f](https://github.com/hottim900/sparkle/commit/660cc3ff63981013762718a1f58215b9897605b7))
* add scratch UI to item card, detail editor, and quick capture ([e0ae6e8](https://github.com/hottim900/sparkle/commit/e0ae6e8ea4f6740dfedf0c49ec85b21468261979))
* add scratch_count to stats and DB migration 9-&gt;10 ([f0303ec](https://github.com/hottim900/sparkle/commit/f0303ecdbaf20fbaca5c795c525928484911a130))
* add Sentry error tracking, CI E2E tests, and auto-deploy workflow ([35484c3](https://github.com/hottim900/sparkle/commit/35484c338ddaef1c33376455f7b384f7546b6a3d))
* add share visibility indicators to item cards and detail page ([561b50b](https://github.com/hottim900/sparkle/commit/561b50b48b329f09bbd9beb40517a5642f5552d7))
* add sort functionality for item listing ([043096b](https://github.com/hottim900/sparkle/commit/043096be260b6e92fa9874168beb08ec9bbda76d))
* add stats and focus API client types and functions ([1b0936e](https://github.com/hottim900/sparkle/commit/1b0936e718e920469ae791b641bf9cdf9f1ef57c))
* add type indicator bar to item detail page ([616da18](https://github.com/hottim900/sparkle/commit/616da18d1c1de7384268f6e39735ac86ba7d9e49))
* add type segmented control to quick capture ([2655361](https://github.com/hottim900/sparkle/commit/2655361e388295174e71899958058d5a082ff196))
* default todo list sort to due date (近→遠) ([b215ffc](https://github.com/hottim900/sparkle/commit/b215ffc871567fb20d618cc103704861a089902e))
* enhance triage mode with type toggle, tags, due dates ([f66b3e4](https://github.com/hottim900/sparkle/commit/f66b3e4d81ffef3f2b1d96ba74150613f96e3d49))
* implement full personal TODO list app (Hono + Vite + React) ([ceb8058](https://github.com/hottim900/sparkle/commit/ceb8058a8fa25e59455313b2c20639c0551e12e0))
* implement Obsidian integration — Zettelkasten status redesign, export, and frontend restructure ([da6b95c](https://github.com/hottim900/sparkle/commit/da6b95ceb502eaf83e2bdd4a5244b8395f1f63fb))
* linked items consistency + card cleanup ([e5019d8](https://github.com/hottim900/sparkle/commit/e5019d82d1ba877e736d702eec09ab9a78d645a5))
* make due date todo-only — notes no longer support due dates ([25bb71f](https://github.com/hottim900/sparkle/commit/25bb71fbb0bbfc24e66c6725f1a4b1899b933e4b))
* **mcp:** add entry point with stdio transport ([552f7af](https://github.com/hottim900/sparkle/commit/552f7af5ad666f2fbcfd6ca9611e4c058b7e542b))
* **mcp:** add knowledge layer with instructions, resources, and guide tool ([d6dc26e](https://github.com/hottim900/sparkle/commit/d6dc26e0e4a0643e67876314cdaa52aa4390ab9f))
* **mcp:** add markdown formatting helpers ([6e2dcb5](https://github.com/hottim900/sparkle/commit/6e2dcb59a44680e29e20fa90adc81926a272f7f3))
* **mcp:** add partial content update (find-and-replace) to sparkle_update_note ([5adcdbd](https://github.com/hottim900/sparkle/commit/5adcdbd66714822d8a86e091a777ed31db244ec7))
* **mcp:** add read-only tools (search, get, list, stats, tags) ([7e3935b](https://github.com/hottim900/sparkle/commit/7e3935b9b0448b09233922f6cf05a8ff88cfa955))
* **mcp:** add Sparkle API types and REST client ([c4ec1a9](https://github.com/hottim900/sparkle/commit/c4ec1a90384444972998f35a55b492f0a10b2201))
* **mcp:** add workflow tools (advance, export) ([7be345b](https://github.com/hottim900/sparkle/commit/7be345bcd9316ed7d69f94d99c9a8c32a7ffb855))
* **mcp:** add write tools (create, update) ([c8f0bbd](https://github.com/hottim900/sparkle/commit/c8f0bbdfd473c6fb95a7d7f8f57557961159370f))
* **mcp:** expand create/update tools with todo, priority, due, linked_note_id ([f75ffd5](https://github.com/hottim900/sparkle/commit/f75ffd52ceb121dbde6b08a2f173d9a49ee1422f))
* **mcp:** finalize sparkle-mcp-server with docs and config ([ce5b929](https://github.com/hottim900/sparkle/commit/ce5b929f1e44de9f144bb2cc2c8ce1f3a1cc3835))
* **mcp:** scaffold sparkle-mcp-server sub-project ([c3f8601](https://github.com/hottim900/sparkle/commit/c3f8601d478bf84946d8580ce1191fbd65cf8a87))
* migrate from VPN-only to full Cloudflare Tunnel + CF Access ([4ab1ee7](https://github.com/hottim900/sparkle/commit/4ab1ee780df649a9c2e5eb4250f3e1d55d5c5240))
* move Obsidian config from .env to Web UI settings page ([d7e3fde](https://github.com/hottim900/sparkle/commit/d7e3fde4d14c87a07b3990f1c0cf04520a93731c))
* pass currentView to QuickCapture for type-aware defaults ([e47efb7](https://github.com/hottim900/sparkle/commit/e47efb70cc8f4036b14cc0d87aa8c26cb3fca1c9))
* Phase 2 — deployment, dashboard, LINE Bot integration ([3ed7614](https://github.com/hottim900/sparkle/commit/3ed76144cc1e67012b29632e5fc13c730e4147e6))
* replace hand-written markdown renderer with react-markdown + remark-gfm ([d03d178](https://github.com/hottim900/sparkle/commit/d03d1782db9ce2056f3d1b503d8ea23a39930a5a))
* restrict port 3000 to localhost and WireGuard subnet via iptables ([becc296](https://github.com/hottim900/sparkle/commit/becc296f54baf3110ea1633a9e572d6309f2f37a))
* update MCP server tools to support scratch type ([0e4d72d](https://github.com/hottim900/sparkle/commit/0e4d72d746c6bdcf03e0dfd866803b5a564701da))
* UX improvements — sort by modified, linked note indicator, tag keyboard nav ([38ce624](https://github.com/hottim900/sparkle/commit/38ce624411eada6c4a053fcd510768aef62a540d))


### Bug Fixes

* add "notes" view type to match bottom nav "筆記" label ([fcee32e](https://github.com/hottim900/sparkle/commit/fcee32ee68fb48022f01a83f22b975c5f482a377))
* add AUTH_TOKEN startup check and improve docker-compose ([d76651f](https://github.com/hottim900/sparkle/commit/d76651f9ecacee22be99f33d9314b0157a038261))
* add error boundaries, Vary header, and fix React hook deps ([f0cf3c0](https://github.com/hottim900/sparkle/commit/f0cf3c055d8cf0b96003923a4a935c8a96ad2ad4))
* add mobile-friendly tag input with add button and IME support ([#17](https://github.com/hottim900/sparkle/issues/17)) ([395f6dc](https://github.com/hottim900/sparkle/commit/395f6dc058961a8dcf9b23eb9e09e3b4640d77af))
* address cleanup review feedback ([7f09d76](https://github.com/hottim900/sparkle/commit/7f09d763b64c2efd5addb40628e03a710beddea4))
* address P2 medium-risk deployment vulnerabilities ([3a2c2f4](https://github.com/hottim900/sparkle/commit/3a2c2f4c3994fde0239532d865d979ed93230357))
* align todo linked note display with note linked todo card style ([681084e](https://github.com/hottim900/sparkle/commit/681084ef82d37ecf51592fda3e45b75bcd6da26b))
* allow WSL2 host network in iptables to fix VPN access ([65bded2](https://github.com/hottim900/sparkle/commit/65bded26d72a145f4afe6105d466d613db35d486))
* auto-logout on 401 response to prevent stuck invalid token state ([775d2a8](https://github.com/hottim900/sparkle/commit/775d2a8877659e14ebf0b6711b2b2d2a94bcc6b2))
* correct anchor links in README.md ([15afadd](https://github.com/hottim900/sparkle/commit/15afadd573a0aba71b45093d0c930b21981b7a00))
* delete only synced items from offline queue instead of clearing all ([47fe950](https://github.com/hottim900/sparkle/commit/47fe95034d9395ebf263691c15290ab040f0ffb7))
* enrich API responses with computed fields and add missing MCP types ([2be13d7](https://github.com/hottim900/sparkle/commit/2be13d75d93239a1b83b204780104117a3b302f0))
* escape FTS5 search queries to prevent 500 on special characters ([a793151](https://github.com/hottim900/sparkle/commit/a793151656fec0a177ee9fb31e87bd7832198046))
* fix LINE reply failures by adding error logging and fixing empty quick reply text ([b10fee6](https://github.com/hottim900/sparkle/commit/b10fee6477c335f4966027e33b4bf5bba470da2d))
* guard against invalid status values in listItems API client ([26c0d16](https://github.com/hottim900/sparkle/commit/26c0d166d85312ae26221af88b4fe708e8e93a3e))
* handle nvm in non-interactive login shell for node detection ([3f7f8c3](https://github.com/hottim900/sparkle/commit/3f7f8c3f565e61f0549ce4ec4fa04e7774923fdd))
* harden deployment security (P0+P1 audit remediation) ([a9f09a8](https://github.com/hottim900/sparkle/commit/a9f09a89492f92b9e382f3b71217d67a12224524))
* harden deployment security and resilience ([c540856](https://github.com/hottim900/sparkle/commit/c5408565f7ed97ce02c9945f8cc9e65a231780bf))
* improve network resilience with retry, caching, and SW updates ([#16](https://github.com/hottim900/sparkle/issues/16)) ([4629617](https://github.com/hottim900/sparkle/commit/4629617e6db5281f360f8670d830025ae8770a27))
* make install-services.sh interactive and conditional ([14e0563](https://github.com/hottim900/sparkle/commit/14e0563af937b47d0f5b5163a7182721789badd4))
* move tsx to dependencies and auto-create data directory ([d7209bd](https://github.com/hottim900/sparkle/commit/d7209bd31c4bb0b5dc788d5cd7eb8007b2ff2b3d))
* prevent long URLs from overflowing item detail layout ([e8eb2f7](https://github.com/hottim900/sparkle/commit/e8eb2f775c556e7894e62307bd587c5628c81612))
* prevent SW controllerchange reload on first install ([#18](https://github.com/hottim900/sparkle/issues/18)) ([72ed9e4](https://github.com/hottim900/sparkle/commit/72ed9e40600130c57a4d307b7e4dfe3420345c39))
* quality consolidation — 7 issues from code review ([f2d4dfc](https://github.com/hottim900/sparkle/commit/f2d4dfca847f66fc217886e40868926e8fa0545f))
* refresh sidebar tags when items are updated ([6e7b6af](https://github.com/hottim900/sparkle/commit/6e7b6afbbff81df70c561fdec75aca685ee637f8))
* relax rate limit and increase debounce for better typing UX ([84057c4](https://github.com/hottim900/sparkle/commit/84057c42ffb88a0d6f4f33af45c1749bbcf91aee))
* render Dashboard full-width instead of inside narrow list panel ([4267d18](https://github.com/hottim900/sparkle/commit/4267d183aa2a520556ea56a33609efcf48e0880f))
* replace native select with shadcn Select for sort dropdown ([4bf3904](https://github.com/hottim900/sparkle/commit/4bf3904424b6e78285659e50d9ce271c0554fd82))
* resolve all critical deployment vulnerabilities ([d2a8c68](https://github.com/hottim900/sparkle/commit/d2a8c68072d01923839f4f6a5b54652965ae4415))
* resolve all server TypeScript strict mode errors ([e3a0fba](https://github.com/hottim900/sparkle/commit/e3a0fba791397d6326f2e74201d2f3edc422bacb))
* resolve CI type-check failures ([bba69ac](https://github.com/hottim900/sparkle/commit/bba69aca876057d83cccc3ab476ed55c560b874c))
* resolve code review findings for share indicators ([570f65b](https://github.com/hottim900/sparkle/commit/570f65b535f325d8ee981b02e3b67176adf3135b))
* restrict !done and !due commands to todo-only in LINE Bot ([b535063](https://github.com/hottim900/sparkle/commit/b535063429ba6e782e3d4dd8377173647206c4e7))
* revert eslint 10 upgrade (ecosystem not ready) ([#20](https://github.com/hottim900/sparkle/issues/20)) ([20591ee](https://github.com/hottim900/sparkle/commit/20591ee03d1de4e6b09ae5ee28603965aceb57ed))
* switch FTS5 to trigram tokenizer for Chinese search support ([1682064](https://github.com/hottim900/sparkle/commit/1682064179c1d4aaee1bdeb30572a3d53e5a5313))
* update all https://localhost:3000 references to http after TLS removal ([0191810](https://github.com/hottim900/sparkle/commit/01918105fcf49a71877693aee471257172d42d7c))
* update E2E tag test locator for new TagInput DOM structure ([#19](https://github.com/hottim900/sparkle/issues/19)) ([aeb664e](https://github.com/hottim900/sparkle/commit/aeb664ee82bacf280c3e59f785dfbc81821652f9))
* use getRequestListener for HTTPS compatibility with Hono ([7166b84](https://github.com/hottim900/sparkle/commit/7166b84fdf0293f42dd6018c0904f7987e3fde18))
* use local timezone consistently in stats date calculations ([3e5c3d9](https://github.com/hottim900/sparkle/commit/3e5c3d9c355c869d42486b1371558f06388eface))
* use resolvedTheme for correct dark/light mode button label ([f1c27c5](https://github.com/hottim900/sparkle/commit/f1c27c5ccc6dba149260834d74db6ca1bb788999))


### Performance Improvements

* add compression, code splitting, cache headers, and remove loopback TLS ([647f8cb](https://github.com/hottim900/sparkle/commit/647f8cb48148d69ebfe494b8e2656b788c44d54d))
* replace new URL(c.req.url).pathname with c.req.path (M5) ([c6c3741](https://github.com/hottim900/sparkle/commit/c6c37416863b8b22d3bb7627fcca53562222c43d))
