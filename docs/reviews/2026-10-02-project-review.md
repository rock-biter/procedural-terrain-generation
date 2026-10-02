# Project Review: 2026-10-02

## Purpose

This is a snapshot of a full-project review: organization, code reuse, bottlenecks, and general optimizations. It records every finding with its location and status, and the phased plan that follows from them. Phase 1 was implemented on the same day; its items are marked **Done**, as are the Phase 2 and Phase 3 items implemented since.

This document does not replace the owning guides. Current behavior lives in [Architecture](../ARCHITECTURE.md), [Terrain](../TERRAIN.md), [Rendering](../RENDERING.md), [Experience](../EXPERIENCE.md), and [Assets](../ASSETS.md); tracked debt lives in the [Roadmap](../ROADMAP.md). Promote an open item into the roadmap register when it becomes part of a milestone. Line numbers refer to the code at review time and drift as the code changes.

## Method And Evidence

- Five parallel read-only reviews, one per area: bootstrap and post-processing; terrain streaming; impostors and shadows; clouds and airplane; assets, build, tests, and docs. The key claims were re-checked in the code before being recorded here.
- **Measured** values come from Node 24 on an Apple M1 (worker jobs, scheduler simulation, noise micro-benchmarks), from `vite build`, from re-encoding assets, or from headless Chrome on the same machine (ANGLE Metal). Values marked **est.** are estimates. No GPU frame time was profiled at review time; Phase 3 (2026-10-03) added the telemetry and the first measurements ([`OBS-001`](../ROADMAP.md#known-problem-register), [Phase 3](#phase-3-measurement-and-gpu-experiments)).
- `[KNOWN]` marks findings the roadmap or the architecture guide already listed.

## Summary

The architecture is sound. The split between pure, tested policy modules and Three.js owners is consistent (131 tests at review time, 98–100% line coverage on the pure modules). The keyed, revision-checked worker pipeline has no correctness issue we could find. The frame loop allocates nothing, near-mesh selection is allocation-free, shadow cascades render on staggered frames, and clouds face the airplane in the vertex shader.

The largest margins were in five places:

1. **Startup:** 11 MB downloaded before Play appeared, 6.9 MB of it the soundtrack, which was then decoded to about 76 MB of PCM.
2. **GPU cost per pixel:**
   - The logarithmic depth buffer disables early-Z.
   - The canvas MSAA was redundant behind the always-on composer.
   - The sea, about 78% of the world, evaluated land-only noise.
3. **Worker scheduling:** at most one job per worker per frame, so terrain converges 3–7× slower than the workers allow.
4. **Memory:**
   - The airplane: about 67 MB of textures and 183k triangles drawn twice per frame.
   - Shadow targets: 64 MB.
   - Index and UV buffers duplicated per chunk.
5. **Organization:**
   - `main.js` does too much; the debug GUI alone is 42% of it.
   - Scenery and cloud shadows, impostor and caster GLSL, and math helpers exist in parallel copies.

## Status Legend

| Status | Meaning |
| --- | --- |
| Done | Implemented and verified (Phase 1 on 2026-10-02 unless the row or the plan says otherwise). |
| Partial | Part implemented; the rest is described in the row. |
| Open | Not started. |
| Decision | Needs an owner decision before work starts. |

## 1. Correctness

| ID | Finding | Where | Status |
| --- | --- | --- | --- |
| B1 | `octaves = 1` from the GUI made `getLandmass()` call `noises[1]`, which did not exist: the frame loop threw every frame and stopped. | `chunkGeometry.js` `getLandmass()` | Done: `createTerrainNoises()` always creates at least two noises; test added. |
| B2 | The **Speed effect** slider called `plane.updateSpeedEffect()`: TypeError before `init()`, and a permanent NaN FOV before the intro ended. | `main.js` GUI, `plane.js` | Done: the method is removed; the slider only feeds the post-processing hold. |
| B3 | The intro used `ease: 'expo3.out'`, which GSAP does not know, so it silently fell back to `power1.out`. | `main.js` play handler | Done: `expo.out`, the intended ease. The intro motion changes accordingly. |
| B4 | A failed soundtrack load left `assets.soundtrack` null, so Play and the sound toggle threw and the app stayed stuck. | `main.js` | Done: `Soundtrack` always exists and only warns on failure. |
| B5 | `xOffset`/`zOffset` were never sent to the workers, yet every slider tick regenerated all 110 chunks. The terrain sliders used `onChange`, with duplicated handlers, and parameter changes did not lift the airplane. | `main.js` GUI | Done: offsets removed, `onFinishChange`, and `regenerateTerrain()` lifts the airplane like a seed change. |
| B6 | The cloud far fade ends at `radius - 50` from the airplane, but the field is centered on the cell, up to 113 units away, so clouds can pop at 6–23% size. | `cloudPlacement.js`, `clouds.js` | Open: generate up to `radius + cellSize·√2/2`, or widen the fade margin. |
| B7 | `DEFAULT_FEATURES.boats` was `true`, so a `Chunk` built without features would clone a null boat. | `chunk.js` | Done. |
| B8 | Bounding spheres ignore the curvature drop; with the debug orbit camera pitched down, distant chunks can be culled while visible. | `project-vertex.glsl`, chunk geometry | Open: the worker returns the height range and the sphere. |
| B9 | Tests use `amplitude: 23`; production uses `32`. Scenery-on-terrain rules are not tested against the real terrain. | `test/chunkGeometry.test.js`, `test/sceneryPlacement.test.js` | Open: share `TERRAIN_DEFAULTS` from a pure module. |
| B10 | `pnpm texture:wood` wrote PNG bytes to `wood.jpg`, not `wood-grain.png`; neither was used. | `scripts/generate-wood-texture.mjs` | Done: script, npm script, and both images removed. |
| B11 | The cloud overlap test checked only the 8 neighbor cells; larger sizes could overlap undetected. The new default sizes (`bank 1.69`) made it happen: about 2 pairs per 79,000 clouds, up to 15 units deep. | `cloudPlacement.js` | Done (with the new cloud defaults): `getCloudNeighbourRing()` derives the ring from the largest possible footprint (2 cells by default); test added. |
| B12 | A worker `error` restarts the worker with no retry cap, so a module that fails to load loops forever. | `chunkWorkerPool.js` | Open: cap and back off. |
| B13 | No favicon, so every page load logged a `favicon.ico` 404. | `index.html` | Done: empty data-URI icon. |
| B14 | A zero frame delta (`THREE.Timer` reports `0` while the page is hidden) made the vertical speed `0 / 0`, and the pitch `lerp()` kept the NaN, so the airplane disappeared until the page was reloaded. A negative first delta after the tab is shown again also reached `plane.update()`. Found in Phase 3, when a controlled benchmark clock produced such deltas. | `plane.js` `updateAltitude()`, `main.js` `tic()` | Done (2026-10-03): the vertical speed is `0` for a zero delta, and `tic()` clamps the delta to `0`–`0.016`. |

## 2. GPU Cost Per Frame

| ID | Finding | Where | Status |
| --- | --- | --- | --- |
| G1 | `logarithmicDepthBuffer` makes every built-in material write `gl_FragDepth`, which disables early-Z. Hidden terrain fragments still run biome noise, normal maps, and up to 12 PCF taps. | `main.js` renderer | Done (2026-10-03): standard depth with near `1` (one depth step below `0.25` units out to the fog end), `-10%` frame time. Reversed depth would need a float depth buffer in the composer and `EXT_clip_control`, so it was not needed. Polygon offset does not apply to lines, so the wireframe pulls its fragment depth by `0.1%` of the distance instead. |
| G2 | With `idleSpeedEffect = 0.4` the composer never bypasses, yet the canvas had 4x MSAA and depth (about 130 MB at 2560×1600), and the grain was a separate blended full-screen pass. | `main.js`, `postProcessing.js` | Done: canvas `antialias: false, depth: false`; grain is the last effect of the `EffectPass`; the bypass path is removed. |
| G3 | Sea pixels evaluated 7–13 land-only `snoise()` calls whose results were masked. | `color-fragment.glsl` | Partial: land block inside `if (wPosition.y >= 0.1)`, identical output. `getBiomeValue()` (3 samples) stays outside for `fwidth()`; an analytic derivative would remove it too. |
| G4 | PCF computes `cos`/`sin` per tap and per cascade (16–24 transcendentals per terrain pixel near the airplane). | `scenery-shadow-pars-fragment.glsl` | Done (2026-10-03): a constant 16-tap spiral table, one rotation `mat2` per pixel for both cascades, and tap counts as material defines (`getSceneryShadowTapDefines()`); `-0.5` ms per frame, identical shadows. |
| G5 | The airplane has 183k triangles and is drawn in the main pass and the near cascade every frame. | `plane-toy-2.glb`, `sceneryShadows.js` | Decision: a 2–5k-triangle shadow caster is invisible; simplifying the drawn GLB (keeping the propeller UV charts) changes the look and needs approval. |
| G6 | The trail ran 5 `snoise()` calls before its discard, over the full ribbon, even at cruise when nothing shows. | `plane.js` | Done: the draw range covers only segments with a stripe (none at cruise), and a conservative bound discards before the noise. |
| G7 | The sky is shaded on every pixel before the scene (`depthTest: false`, `renderOrder = -1`). | `dayNight.js` | Done (2026-10-03): drawn after the opaque meshes just inside the far plane with the depth test on, and the dip uploaded in radians; `-0.3` ms per frame. |
| G8 | Shadow cascades used 32-bit depth plus an RGBA8 color attachment nobody writes (64 MB on desktop). | `sceneryShadows.js` | Done: `DEPTH_COMPONENT16` and `RedFormat` (24 MB). A 1024² far cascade (about 15 MB) is Open and needs a visual check. |
| G9 | Micro costs: the normal map is fetched past its fade; impostor quad corners (21%) are discarded after 6 atlas fetches; single-frame impostors still compute 3 frames; clouds read a constant `textureLod(…, 16.0)` per fragment; light direction is normalized per fragment; `speed-effect.glsl` re-reads `inputColor`. | various shaders | Open. |
| G10 | Cloud shadow blur computes `exp()` per tap; the map re-renders about 7.5 times per second during the day cycle. | `cloud-shadow-blur-fragment.glsl`, `cloudShadows.js` | Open (low value). |

## 3. CPU, Streaming, And Startup

| ID | Finding | Where | Status |
| --- | --- | --- | --- |
| C1 | Jobs dispatch only from `updateChunks()`, at most one per worker per frame; the near-job `break` idles the second worker; `jobsPerFrame = 3` is unreachable with 2 workers. Simulated: desktop startup 1234 → 426 ms, mobile 1234 → 216 ms, a forward crossing 434 → 117 ms with re-dispatch on completion. | `chunkManager.js` `processPendingJobs()` | Done (Phase 2): `dispatchJobs()` on every frame and every completion, a `ready` queue committed within `CHUNK_STREAMING.commitBytes`/`commitMs`, `getChunkWorkerCount()` (up to 4 on desktop). Measured in headless Chrome: desktop startup 1.55 → 0.46 s; a 12 s boosted, turning flight ends with 0 instead of 48 pending jobs, frame times unchanged. |
| C2 | Startup was fully serial: bundle, then assets including the mp3, then a 1 s fade, then a synchronous `init()` with three bakes, and only then the workers. | `main.js` | Done (Phase 2): the soundtrack no longer gates loading (Phase 1) and an inline script preloads the default airplane GLB, reused by the loader. Starting `ChunkManager` before `init()` is not needed after C1: the terrain is complete about 0.46 s after `init()`, before the canvas finishes fading in. |
| C3 | Shaders were never precompiled: near scenery and cloud meshes compiled on first approach mid-flight, and cloud shadows at the first sunrise. | `main.js` | Done: `precompileShaders()` uses `compileAsync()` against the composer buffer, plus `CloudShadows.compileAsync()`. |
| C4 | Desktop LOD 0 normals sample 5 heights per vertex, although neighbors share samples. | `chunkGeometry.js` | Done (Phase 2): desktop LOD 0 job 31 → 16 ms (−50%), bit-identical normals (reuse only where coordinates are exactly equal). |
| C5 | `createSources()` runs for every consumer (scenery twice, clouds three times, about 90 ms at startup); the resolve program is compiled once per bake; atlas mipmaps regenerate after every bake render. | `impostorBaker.js`, `sceneryMeshes.js`, `clouds.js`, `cloudShadows.js` | Done (Phase 2): `getCatalogSources()` builds each type once (187 → 76 ms in Node); the resolve material and program persist across bakes; atlas mipmaps are generated once per bake. Longest startup task in headless Chrome 341–348 → 188–190 ms. |
| C6 | `permute()` in the CPU `snoise` only sees integers below 600. | `biome.js` | Done (Phase 2): table-based `permute()`, identical over 300,000 points; other LODs about −20%. |
| C7 | No hysteresis on the current chunk: flying along a border repeats 41–64 jobs per crossing. | `chunkManager.js` | Open (`STRM-003` [KNOWN]). |
| C8 | The `AudioListener` on the camera scheduled about 540 audio automation events per second for non-positional music. | `main.js` | Done: removed with the soundtrack change. |
| C9 | Small per-frame allocations (`findSegment()`, `selectShadowLight()`, `getFlightCorridor()`, cloud-shadow options) contradict the "no per-frame allocation" notes. | policy modules | Open (negligible cost). |
| C10 | Every wheel event creates a GSAP tween (60–120 per second on trackpads), and `acceleration` has two writers. | `plane.js` | Open: a target value damped in `update()`. |

## 4. Memory

| ID | Finding | Status |
| --- | --- | --- |
| M1 | The soundtrack was decoded to about 76 MB of PCM. | Done: streamed through a media element. |
| M2 | Airplane textures are three 2048² maps, about 67 MB of VRAM with mipmaps. | Partial (Phase 2): the textures stay 2048² but are ETC1S, so they take about an eighth of their RGBA8 memory (about 8 MB instead of 67 MB, est.). The 183k triangles wait for the G5 decision. |
| M3 | Shadow targets: 64 MB on desktop, 16 MB on mobile. | Done: 24 MB and 6 MB (G8). |
| M4 | Terrain index and UV depend only on LOD but are generated, transferred, uploaded, and kept per chunk: 7.16 of 17.35 MB on desktop. The CPU copies stay on the heap after upload. | Partial (Phase 2): index and uv shared per LOD (`src/chunkTopology.js`), per-chunk CPU arrays freed after upload, bounding sphere from the worker. Int16 normals and a shared XZ grid are Open. |
| M5 | Mobile uses the same 38 MB scenery atlas as desktop. | Open: 48 px frames (about 21 MB) after an art check. |

## 5. Assets, Bundle, And Build

| ID | Finding | Status |
| --- | --- | --- |
| A1 | The soundtrack is 256 kbps (6.9 MB). Measured re-encodes: MP3 128k 3.46 MB, Opus 96k 2.76 MB. | Done (Phase 2): MP3 at 128 kbps, 6.9 → 3.5 MB (a placeholder until the final music and effects). |
| A2 | Terrain normal maps are JPEG quality 99 (4.92 MB); WebP q85 measured at 1.47 MB. Three of them are not square (1024×1025, ×1018, ×1010). | Done (Phase 2, decision: KTX2): ETC1S with X in color and Y in alpha, resampled to 1024², GPU-like box mipmaps; 4.92 → 2.07 MB for the five maps in use, about a quarter of the RGBA8 GPU memory. A sharper, renormalized mip chain made rocks and snow noisy and was rejected. |
| A3 | GLB textures: WebP measured at −2.1 MB on the biplane (3.59 → about 1.46 MB). | Done (Phase 2, decision: KTX2): every texture re-encoded inside the GLBs at 2048² (ETC1S, PSNR 36–44 dB, normal 0.9°), geometry unchanged; biplane 3.59 → 2.24 MB, monoplane 4.21 → 2.65 MB. Masters in `assets-src/`, pipeline in `scripts/encode-assets.mjs`. |
| A4 | `dist/` was 37.8 MB, 15.5 MB never requested; `src/textures/` held about 18 MB of unused files. | Partial: style references moved to `docs/style-references/`; unused textures, `vite.svg`, and `javascript.svg` removed. The dormant boat (10.5 MB) and the former airplane stay in `public/` under the `AGENTS.md` rule: **Decision**. |
| A5 | `lil-gui`, `OrbitControls`, and `gsap` are always in the main bundle: −122 KB raw / −39 KB gzip measured without them. | Partial (Phase 2): `lil-gui` (with `?gui=1`) and `FlightPauseDebug` with `OrbitControls` (with `?debug=1`) load through top-level dynamic `import()`; default JS 1,032 → 985 KB raw (281 → 271 KB gzip). Replacing `gsap` is Open (it changes visible animations). |
| A6 | The worker bundles 106 KB of three.js for `PlaneGeometry` and `MathUtils`. | Done (Phase 2): the worker builds the grid in typed arrays; 119 → 10.6 KB. |
| A7 | GLSL minification is off (−5.7 KB raw). | Open. |
| A8 | `package.json` is still named `three-vite-basic-scene`; there is no `LICENSE` file although the README claims MIT; `vite --host` exposes the dev server on the LAN. | Open. |

## 6. Organization And Reuse

| ID | Finding | Status |
| --- | --- | --- |
| O1 | `main.js` (1305 lines at review time) mixes parameters, uniforms, asset loading, intro, the 549-line GUI, renderer setup, `init()`, and the frame loop. Proposed split: `debug/debugGui.js` (lazy), `appParams.js`, `sharedUniforms.js`, `assetLoader.js` (with failure states, `LOAD-002`), `intro.js`, a `World` owner encoding the frame order, `renderSetup.js`, `worldConstants.js`. | Open |
| O2 | Scenery impostor wiring (variation, wireframe, detail, re-bake) is spread across `main.js`, while clouds own theirs in `Clouds`. | Open: a `SceneryImpostors` owner mirroring `Clouds`. |
| O3 | `sceneryShadows.js` and `cloudShadows.js` duplicate `CLIP_TO_TEXTURE`, the light basis, the texel-snapped ortho fit, the matrix write, and the caster material factory. The scenery caster hard-codes its defines while clouds use `getCatalogDefines()`. | Open: `lightSpace.js` and `createImpostorCasterMaterial()`. |
| O4 | GLSL copies: impostor and caster frame selection, `rotateYaw()` (×2), interleaved gradient noise (×2 in one program), the curvature drop (×4), sRGB helpers that re-implement three's. | Partial: the unused `rotateZ()` is removed; the shared includes are Open. |
| O5 | JS helpers: `smoothstep` ×5, `clamp01` ×4, `pickWeighted` ×2; `hashSeed`/`cellRandom` live in `sceneryPlacement.js` and `snoise` in `biome.js`. | Open: three-free `math.js`, `random.js`, `noise.js`. |
| O6 | `window.innerWidth < 768` is computed in `main.js`, `chunkManager.js` (module scope, which keeps the reconcile logic out of Node tests), and `plane.js`. | Partial: removed from `plane.js`; the rest is Open. |
| O7 | CPU/GPU constants kept in sync by hand: biome frequencies, height bands (0.8% of instances stand on the shader's sand band), `TERRAIN_NORMAL_LAYERS`. | Open: generate `#define`s from one JS module. |
| O8 | The shadowed or unshadowed lighting setup is built three times (`impostorMaterial.js`, `sceneryMeshes.js`, `chunk.js`). | Open: `createSceneryLighting()` in `curvedLights.js`. |
| O9 | `plane.js` (744 lines at review time) keeps about 85 lines of trail GLSL inline, against the project convention; `project-vertex-plane.glsl` is really the trail chunk. | Open: split into `wingTrails.js`, `propeller.js`, `flightInput.js` (with `dispose()`), `followCamera.js`. |
| O10 | 37 `.replace('#include <…>')` sites fail silently if a three.js upgrade renames a chunk. | Open: a `replaceChunk()` that throws, plus a test against `ShaderLib`. |
| O11 | Dead code: unused imports, `uRocksColor`, `params.LOD`, `axesHelper`, `Plane` fields (`velocity`, `noise`, `finalFov`, `intialTan`, `RATIO`), `updateSpeedEffect()`, `getLODbyCoords()`, the forced-LOD path, `ChunkWorkerPool.busy`, `Chunk.applyCurvature()`, `rotateZ()`, a redundant `structuredClone`, and about 85 lines of commented-out code. | Done (`MAINT-001` updated). |
| O12 | No material defines `customProgramCacheKey`; tap counts and the ambient scale are captured by closures, not defines, so two materials differing only in those would share a program. | Partial: tap counts are defines since G4; the ambient scale is still a closure (latent). |

## 7. Tests, Tooling, And Documentation

| ID | Finding | Status |
| --- | --- | --- |
| T1 | No lint, formatter, or CI (`QUAL-001` [KNOWN]). ESLint `no-unused-vars` would have caught most of O11; `pnpm test && pnpm build` takes about 1 s. | Open |
| T2 | Untested: `terrainNormals.js` (imports images, not loadable in Node), `impostorArchetypes.js`, `impostorCatalogs.js`, `chunkWorkerPool.js`, and the reconcile state machine. | Open: a Node loader hook for `.glsl` and images, or pure policy splits. |
| T3 | Documentation drift. Fixed in Phase 1 where touched: post-processing, idle level `0.4`, grain `0.035`, the sea normal map, style references, `texture:wood`, audio. Still stale: color-noise defaults, `skyGradientHeight`, terrain normal fade, the impostor far fade "inside the fog", tree and rock densities and cell sizes in `TERRAIN.md`, "three jobs per frame", "dependency-free" tests, the test lists in `AGENTS.md` and `DEVELOPMENT.md`. `trailHistory.js` and `terrainSampleDebug.js` are not mentioned in any guide. | Partial |
| T4 | The docs total about 258 KB; finished FEAT specs in the roadmap repeat the owning guides, and the module map exists in both `AGENTS.md` and `ARCHITECTURE.md`. | Open |

## Preserve

- Pure, tested policy modules with documented GLSL twins (`sceneryMeshPolicy`, `shadowPolicy`, `octahedral`).
- Keyed jobs with revisions; stale results rejected before any Three.js object exists; buffers transferred, not copied.
- One catalog abstraction for scenery and clouds (baker, impostor material, near meshes).
- Allocation-free near-mesh selection with partial uploads; the complementary dither cross-fade.
- Staggered, texel-snapped cascades with a light-basis threshold; built-in `shadowMap` off; on-demand R8 cloud shadows.
- Clouds turned toward the airplane in the vertex shader; the propeller turned in the vertex shader through a UV-chart mask.
- Constant light count across day and night, so no recompiles; defensive `ShaderChunk` patches that warn on upgrades.

## Plan

### Phase 1: Quick Wins (Done, 2026-10-02)

B1–B5, B7, B10, B13, G2, G3 (partial), G6, G8, C3, C8, M1, M3, A4 (partial), O11, and the soundtrack streaming (`src/soundtrack.js`), with the documentation updated.

Follow-up on the same day: new cloud defaults tuned in the GUI (lowest base `197`, desktop field radius `1850`, sizes `bank 1.69`, `heap 1.04`, `puff 1.14`), which required B11.

Verification:

- `pnpm test`: 132 of 132 tests passed, including a new single-octave test. `pnpm build` succeeded.
- Headless Chrome (ANGLE Metal, Apple M1), production build, desktop 1280×800 and mobile 390×844 at 3x: no console errors and no failed requests. Checked with `?gui=1&debug=1&time=0.02` at night, with ACES tone mapping (half-float buffers), and with boost and turn.
- Side by side with the unmodified build at the same seed and time: terrain, sea, bands, biome lines, and trails look the same. The grain in a flat sky patch has the same mean and spread (green channel `σ ≈ 2.26` in both).
- Canvas context: `antialias: false`, `depth: false`; `KHR_parallel_shader_compile` available.
- Not checked: real iOS and Android devices (including the soundtrack volume on iOS), and GPU frame time against a baseline.

### Phase 2: Streaming And Startup

C1, C4, C6, M4 (shared index and UV per LOD), C5, A6, A1–A3 (recompression), A5, and the rest of C2.

Done on 2026-10-02: C1, C4, C6, M4 (partial), A6, then C5, C2, and A5 (partial). Verification: 139 of 139 tests passed; 200 chunks over 4 seeds, every LOD, and both densities matched the previous generator bit for bit (position, normal, height, index, uv); headless Chrome desktop, mobile, and `?gui=1&debug=1` at night showed no console errors. Second batch, verified the same way: 142 of 142 tests passed; the impostors look identical to the previous build; the GLB is requested once, `?plane=toy` loads only its model, and `?gui=1&debug=1` loads the two debug chunks with a working pause. Decisions then taken: keep `gsap`, KTX2 for textures, 128 kbps MP3. Third batch (A1–A3): 144 of 144 tests passed; in headless Chrome, close-ups of terrain, wood, and airplane match the previous build, there are no console errors, and the transfer before Play fell from 9.39 to 5.43 MB. Phase 2 is complete except the `gsap` replacement, which was declined.

### Phase 3: Measurement And GPU Experiments

`OBS-001` telemetry first (`renderer.info.autoReset = false` with a reset at the start of `tic`, frame-time percentiles), then G1, G4, G5 with M2, G7, adaptive device pixel ratio, and `powerPreference: 'high-performance'`.

Done on 2026-10-03: the telemetry (`src/frameStats.js`, `getRenderStats()`), G1, G4, G7, `powerPreference: 'high-performance'`, and B14, found while measuring. Waiting for a decision: G5 with M2 (a simplified drawn airplane changes its look) and the adaptive device pixel ratio (a product choice: minimum ratio and target frame rate).

Measurements, using the deterministic method in [Quality](../QUALITY.md#comparing-builds): headless Chrome, ANGLE Metal, Apple M1, `3840 × 2160` canvas, `?seed=s762&time=0.35`, mean of frames `300`–`900` after Play, two runs per build, alternated:

| Build | Mean frame time | Change |
| --- | --- | --- |
| Before Phase 3 (with the telemetry, which costs nothing measurable) | `21.6` ms | |
| G1 | `19.45` ms | `-10%` |
| G1 + G4 | `18.9` ms | `-12.5%` |
| G1 + G4 + G7 | `18.65` ms | `-14%` |

The p95 of the last build reads higher (`32` ms instead of `22`) because Chrome's headless compositor delivered more frame pairs (`~40` ms then `~0` ms); the mean, and the median of single frames, both fell. At `390 × 844` (DPR 3) the M1 is not GPU-bound (about `3` ms per frame): `3.1`–`3.4` ms became `2.9` ms. Phones remain to be measured.

Verification:

- `pnpm test`: 152 of 152 tests passed (frame telemetry, tap defines, and the GLSL kernel against its formula are new). `pnpm build` succeeded.
- Headless Chrome, production build: desktop `1440 × 900` at DPR 2, mobile `390 × 844` at DPR 3 (one-tap impostor shadows), and `?debug=1` at night, with no console errors or warnings.
- Captures at a held frame against the build before Phase 3 at the same airplane position: day `49.9` dB PSNR (`0.008%` of pixels off by more than `16` levels), dusk `43.6` dB, and night `43.2` dB, within the run-to-run noise; no z-fighting at the horizon, stars and discs unchanged. The debug wireframe overlay (`?gui=1`) looks the same, with continuous edges.
- Not checked: real phones and Windows or Linux GPUs, and `powerPreference` on a dual-GPU laptop.

Also on 2026-10-03, by owner decision: ACES Filmic became the default tone mapping. Its half-float composer buffers cost about `23%` more frame time than `NoToneMapping` at `3840 × 2160` (`39.9` against `32.6` ms, alternated runs while another Chrome tab loaded the GPU, so the absolute values are higher than in the table above). Captures at `?time=0.35`, `0.72`, and `0.9` show no artifact; the palettes, tuned without tone mapping, look slightly less saturated by day, more saturated at dusk, and darker at night.

### Phase 4: Refactor

O1–O10, O12, T1–T4, B6, B8, B9, B12, C9, C10.
