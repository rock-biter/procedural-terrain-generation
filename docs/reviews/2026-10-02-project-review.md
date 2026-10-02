# Project Review: 2026-10-02

## Purpose

This is a snapshot of a full-project review: organization, code reuse, bottlenecks, and general optimizations. It records every finding with its location and status, and the phased plan that follows from them. Phase 1 was implemented on the same day; its items are marked **Done**.

This document does not replace the owning guides. Current behavior lives in [Architecture](../ARCHITECTURE.md), [Terrain](../TERRAIN.md), [Rendering](../RENDERING.md), [Experience](../EXPERIENCE.md), and [Assets](../ASSETS.md); tracked debt lives in the [Roadmap](../ROADMAP.md). Promote an open item into the roadmap register when it becomes part of a milestone. Line numbers refer to the code at review time and drift as the code changes.

## Method And Evidence

- Five parallel read-only reviews, one per area: bootstrap and post-processing; terrain streaming; impostors and shadows; clouds and airplane; assets, build, tests, and docs. The key claims were re-checked in the code before being recorded here.
- **Measured** values come from Node 24 on an Apple M1 (worker jobs, scheduler simulation, noise micro-benchmarks), from `vite build`, from re-encoding assets, or from headless Chrome on the same machine (ANGLE Metal). Values marked **est.** are estimates. No GPU frame time was profiled; that remains [`OBS-001`](../ROADMAP.md#known-problem-register).
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
| Done | Implemented and verified in Phase 1 (2026-10-02). |
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

## 2. GPU Cost Per Frame

| ID | Finding | Where | Status |
| --- | --- | --- | --- |
| G1 | `logarithmicDepthBuffer` makes every built-in material write `gl_FragDepth`, which disables early-Z. Hidden terrain fragments still run biome noise, normal maps, and up to 12 PCF taps. | `main.js` renderer | Open: measure with `false` and near `0.5–1`, or `reversedDepthBuffer: true`. The wireframe would then need `polygonOffset`. Likely the largest single GPU gain. |
| G2 | With `idleSpeedEffect = 0.4` the composer never bypasses, yet the canvas had 4x MSAA and depth (about 130 MB at 2560×1600), and the grain was a separate blended full-screen pass. | `main.js`, `postProcessing.js` | Done: canvas `antialias: false, depth: false`; grain is the last effect of the `EffectPass`; the bypass path is removed. |
| G3 | Sea pixels evaluated 7–13 land-only `snoise()` calls whose results were masked. | `color-fragment.glsl` | Partial: land block inside `if (wPosition.y >= 0.1)`, identical output. `getBiomeValue()` (3 samples) stays outside for `fwidth()`; an analytic derivative would remove it too. |
| G4 | PCF computes `cos`/`sin` per tap and per cascade (16–24 transcendentals per terrain pixel near the airplane). | `scenery-shadow-pars-fragment.glsl` | Open: constant Vogel offsets, one rotation `mat2` per pixel, taps as defines (also fixes the program-cache-key gap, O12). |
| G5 | The airplane has 183k triangles and is drawn in the main pass and the near cascade every frame. | `plane-toy-2.glb`, `sceneryShadows.js` | Open: a 2–5k-triangle shadow caster; simplify the GLB (keep the propeller UV charts). |
| G6 | The trail ran 5 `snoise()` calls before its discard, over the full ribbon, even at cruise when nothing shows. | `plane.js` | Done: the draw range covers only segments with a stripe (none at cruise), and a conservative bound discards before the noise. |
| G7 | The sky is shaded on every pixel before the scene (`depthTest: false`, `renderOrder = -1`). | `dayNight.js` | Open: draw last at the far plane (`xyww`) with the depth test on; upload `dip` instead of `asin()` per pixel. |
| G8 | Shadow cascades used 32-bit depth plus an RGBA8 color attachment nobody writes (64 MB on desktop). | `sceneryShadows.js` | Done: `DEPTH_COMPONENT16` and `RedFormat` (24 MB). A 1024² far cascade (about 15 MB) is Open and needs a visual check. |
| G9 | Micro costs: the normal map is fetched past its fade; impostor quad corners (21%) are discarded after 6 atlas fetches; single-frame impostors still compute 3 frames; clouds read a constant `textureLod(…, 16.0)` per fragment; light direction is normalized per fragment; `speed-effect.glsl` re-reads `inputColor`. | various shaders | Open. |
| G10 | Cloud shadow blur computes `exp()` per tap; the map re-renders about 7.5 times per second during the day cycle. | `cloud-shadow-blur-fragment.glsl`, `cloudShadows.js` | Open (low value). |

## 3. CPU, Streaming, And Startup

| ID | Finding | Where | Status |
| --- | --- | --- | --- |
| C1 | Jobs dispatch only from `updateChunks()`, at most one per worker per frame; the near-job `break` idles the second worker; `jobsPerFrame = 3` is unreachable with 2 workers. Simulated: desktop startup 1234 → 426 ms, mobile 1234 → 216 ms, a forward crossing 434 → 117 ms with re-dispatch on completion. | `chunkManager.js` `processPendingJobs()` | Open: re-dispatch on completion, a ready queue committed under a ms or byte budget (`PERF-002` [KNOWN]), 3–4 workers when `hardwareConcurrency >= 8`. |
| C2 | Startup was fully serial: bundle, then assets including the mp3, then a 1 s fade, then a synchronous `init()` with three bakes, and only then the workers. | `main.js` | Partial: the soundtrack no longer gates loading (Play appeared after 2.0 s instead of 3.1 s on localhost with a warm cache). Starting `ChunkManager` before `init()` and preloading the GLB remain Open. |
| C3 | Shaders were never precompiled: near scenery and cloud meshes compiled on first approach mid-flight, and cloud shadows at the first sunrise. | `main.js` | Done: `precompileShaders()` uses `compileAsync()` against the composer buffer, plus `CloudShadows.compileAsync()`. |
| C4 | Desktop LOD 0 normals sample 5 heights per vertex, although neighbors share samples. | `chunkGeometry.js` | Open: midpoint grid, prototyped at 29 → 17 ms per job (−42%). |
| C5 | `createSources()` runs for every consumer (scenery twice, clouds three times, about 90 ms at startup); the resolve program is compiled once per bake; atlas mipmaps regenerate after every bake render. | `impostorBaker.js`, `sceneryMeshes.js`, `clouds.js`, `cloudShadows.js` | Open: memoize per catalog, type, and LOD; the baker must not dispose shared sources. |
| C6 | `permute()` in the CPU `snoise` only sees integers below 600. | `biome.js` | Open: a lookup table gives bit-identical results, 1.63× faster `snoise`, about −17% per `getHeight()`. |
| C7 | No hysteresis on the current chunk: flying along a border repeats 41–64 jobs per crossing. | `chunkManager.js` | Open (`STRM-003` [KNOWN]). |
| C8 | The `AudioListener` on the camera scheduled about 540 audio automation events per second for non-positional music. | `main.js` | Done: removed with the soundtrack change. |
| C9 | Small per-frame allocations (`findSegment()`, `selectShadowLight()`, `getFlightCorridor()`, cloud-shadow options) contradict the "no per-frame allocation" notes. | policy modules | Open (negligible cost). |
| C10 | Every wheel event creates a GSAP tween (60–120 per second on trackpads), and `acceleration` has two writers. | `plane.js` | Open: a target value damped in `update()`. |

## 4. Memory

| ID | Finding | Status |
| --- | --- | --- |
| M1 | The soundtrack was decoded to about 76 MB of PCM. | Done: streamed through a media element. |
| M2 | Airplane textures are three 2048² maps, about 67 MB of VRAM with mipmaps. | Open: 1024² or KTX2 (about 17 MB or less). |
| M3 | Shadow targets: 64 MB on desktop, 16 MB on mobile. | Done: 24 MB and 6 MB (G8). |
| M4 | Terrain index and UV depend only on LOD but are generated, transferred, uploaded, and kept per chunk: 7.16 of 17.35 MB on desktop. The CPU copies stay on the heap after upload. | Open: share them per LOD (−41%), Int16 normals and a shared XZ grid (up to −79%), `array = null` in `onUpload`. |
| M5 | Mobile uses the same 38 MB scenery atlas as desktop. | Open: 48 px frames (about 21 MB) after an art check. |

## 5. Assets, Bundle, And Build

| ID | Finding | Status |
| --- | --- | --- |
| A1 | The soundtrack is 256 kbps (6.9 MB). Measured re-encodes: MP3 128k 3.46 MB, Opus 96k 2.76 MB. | Open. |
| A2 | Terrain normal maps are JPEG quality 99 (4.92 MB); WebP q85 measured at 1.47 MB. Three of them are not square (1024×1025, ×1018, ×1010). | Open: WebP or KTX2 after a visual check; crop to 1024². |
| A3 | GLB textures: WebP measured at −2.1 MB on the biplane (3.59 → about 1.46 MB). | Open (with G5 and M2). |
| A4 | `dist/` was 37.8 MB, 15.5 MB never requested; `src/textures/` held about 18 MB of unused files. | Partial: style references moved to `docs/style-references/`; unused textures, `vite.svg`, and `javascript.svg` removed. The dormant boat (10.5 MB) and the former airplane stay in `public/` under the `AGENTS.md` rule: **Decision**. |
| A5 | `lil-gui`, `OrbitControls`, and `gsap` are always in the main bundle: −122 KB raw / −39 KB gzip measured without them. | Open: dynamic `import()` behind `?gui=1` and `?debug=1`; CSS transitions plus a small tween for `gsap` ([KNOWN] for the GUI). |
| A6 | The worker bundles 106 KB of three.js for `PlaneGeometry` and `MathUtils`. | Open: build the grid in typed arrays; worker to about 12 KB (est.). |
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
| O12 | No material defines `customProgramCacheKey`; tap counts and the ambient scale are captured by closures, not defines, so two materials differing only in those would share a program. | Open (latent; G4 fixes the taps). |

## 7. Tests, Tooling, And Documentation

| ID | Finding | Status |
| --- | --- | --- |
| T1 | No lint, formatter, or CI (`QUAL-001` [KNOWN]). ESLint `no-unused-vars` would have caught most of O11; `pnpm test && pnpm build` takes about 1 s. | Open |
| T2 | Untested: `terrainNormals.js` (imports images, not loadable in Node), `impostorArchetypes.js`, `impostorCatalogs.js`, `chunkWorkerPool.js`, and the reconcile state machine. | Open: a Node loader hook for `.glsl` and images, or pure policy splits. |
| T3 | Documentation drift. Fixed in Phase 1 where touched: post-processing, idle level `0.4`, grain `0.035`, the sea normal map, style references, `texture:wood`, audio. Still stale: fog default (`250`–`900` in docs, `200`–`2100` in code), color-noise defaults, `skyGradientHeight`, terrain normal fade, the impostor far fade "inside the fog", tree and rock densities and cell sizes in `TERRAIN.md`, "three jobs per frame", "dependency-free" tests, the test lists in `AGENTS.md` and `DEVELOPMENT.md`. `trailHistory.js` and `terrainSampleDebug.js` are not mentioned in any guide. | Partial |
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

### Phase 3: Measurement And GPU Experiments

`OBS-001` telemetry first (`renderer.info.autoReset = false` with a reset at the start of `tic`, frame-time percentiles), then G1, G4, G5 with M2, G7, adaptive device pixel ratio, and `powerPreference: 'high-performance'`.

### Phase 4: Refactor

O1–O10, O12, T1–T4, B6, B8, B9, B12, C9, C10.
