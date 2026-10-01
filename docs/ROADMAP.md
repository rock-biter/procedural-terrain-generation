# Technical Roadmap And Work Register

## Purpose

This is the living register for technical debt, performance work, architectural decisions, and future features. It records why work is needed before prescribing an implementation.

The first analysis focuses on terrain generation and streaming because they dominate current startup and traversal cost. Current behavior remains documented in [Terrain](TERRAIN.md), [Architecture](ARCHITECTURE.md), and [Rendering](RENDERING.md). Validation rules remain in [Quality](QUALITY.md).

Last baseline review: **2026-09-26**.

Current implementation scope: `worldFeatures` enables scenery (trees, cacti, and rocks as octahedral impostors, `FEAT-003`, replaced by real meshes near the eye, `FEAT-004`) and still disables clouds and boats. The dormant cloud and boat implementations and their historical cost analysis remain in this document for later reintroduction.

Terrain geometry generation now runs in a bounded module-worker pool. This is a verified implementation slice of Phase 3, not performance acceptance: p95 frame time and first-visible-terrain latency have not been measured against a baseline.

## How To Use This Document

- Give every problem and future feature a stable ID.
- Keep verified facts separate from estimates and hypotheses.
- Add measurements before and after performance work.
- Define acceptance criteria before changing architecture.
- Update status and decisions in the same task as the implementation.
- Do not mark an item complete until its documentation and validation are complete.

### Status

| Status        | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| `Observed`    | Verified in the current source, but not yet scheduled.    |
| `Ready`       | Scope, dependencies, and acceptance criteria are defined. |
| `In progress` | Implementation is active.                                 |
| `Blocked`     | A decision, dependency, or measurement is missing.        |
| `Done`        | Implementation and validation are complete.               |

### Priority

| Priority | Meaning                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| `P0`     | Correctness, unbounded growth, or a dominant frame-time risk.                     |
| `P1`     | Material performance or maintainability problem needed for the next architecture. |
| `P2`     | Important improvement that can follow stabilization and measurement.              |
| `P3`     | Cleanup or deferred quality work with limited immediate runtime impact.           |

## Evidence Levels

- **Confirmed:** directly visible in source or library behavior.
- **Static estimate:** derived exactly from current constants and loops, but not timed in a browser.
- **Hypothesis:** plausible runtime impact that requires profiling.

Time estimates from unmeasured hardware are intentionally excluded. Static operation counts identify where to measure; they do not predict milliseconds.

## Current Terrain Hot Path

```text
main.js: tic()
  -> Plane.update()
  -> ChunkManager.updateChunks()
     -> on a chunk boundary or heading-sector change, build a heading-biased desired Map
     -> dispose every live chunk outside the desired set
     -> cancel obsolete work and enqueue one keyed job per coordinate
     -> on later frames, sort pending jobs and dispatch into a bounded pool
            -> chunkGeometry.worker.js
                 -> seeded PlaneGeometry allocation
                 -> getHeight() for every terrain vertex
                 -> getSurfaceNormal() central differences (4 extra samples/vertex)
                 -> transfer position/normal/UV/height/index buffers
            -> main thread validates key + revision
                 -> wrap buffers in BufferGeometry
                 -> create Chunk or replace its geometry
                 -> scenery placement within the radial range (transferred Float32Array)
            -> main thread: Chunk.setScenery() -> one impostor quad mesh per chunk
                 -> [disabled] clouds / boats
  -> SceneryMeshes.update(): select near instances -> one instanced mesh per type
  -> renderer.render()
```

Height sampling and normal computation execute off the main thread. Main-thread commits are still limited by job count rather than elapsed time, and their GPU-upload cost has not been profiled.

## Quantitative Static Baseline

### Assumptions

- Chunk size: `256`.
- Default octaves: `3`.
- `getHeight()` performs five terrain simplex-noise evaluations at the default octave count (one per octave plus two landmass samples) and three biome-field samples. Near a biome border the two detail octaves are evaluated twice, for seven terrain samples.
- Desktop uses `maxDistance = 6`, `lookAhead = 2`, `rearDistance = 3`, terrain density divisor `2`, and a `4`-unit scenery cell.
- Mobile uses `maxDistance = 5`, `lookAhead = 1`, `rearDistance = 2.5`, terrain density divisor `4`, and an `8`-unit scenery cell.
- The scenery cells above are the former defaults the scenery counts were computed with. The current defaults are `8` units on desktop and `16` on mobile, a quarter of those candidates; the scenery rows have not been recomputed.
- Counts model the heading-biased desired set with a northward heading; diagonal headings differ by a few chunks. Keyed pending work prevents duplicate jobs for one coordinate.

### Desired Window At Startup

| Metric                        |                                                         Desktop |                                             Mobile |
| ----------------------------- | --------------------------------------------------------------: | -------------------------------------------------: |
| Desired chunks                |                                                             110 |                                                 73 |
| LOD distribution              | 15 at LOD 0, 20 at LOD 1, 35 at LOD 2, 29 at LOD 3, 11 at LOD 4 | 12 at LOD 0, 18 at LOD 1, 30 at LOD 2, 13 at LOD 3 |
| Terrain vertices              |                                                         381,502 |                                             80,025 |
| Terrain triangles             |                                                         743,296 |                                            152,192 |
| Terrain noise evaluations     |                                                       1,907,510 |                                            400,125 |
| Scenery chunks (radial range) |                                                              52 |                                                 51 |
| Scenery candidates            |                                                         212,992 |                                             52,224 |
| Scenery height evaluations    |                                                       1,064,960 |                                            261,120 |
| Cloud candidates              |                                                       7,208,960 |                                          4,784,128 |
| Cloud noise evaluations       |                                                      14,417,920 |                                          9,568,256 |

Terrain startup performs about **1.91 million** noise evaluations on desktop and **400 thousand** on mobile, distributed across up to two desktop workers or one mobile worker.

Scenery placement also runs in those workers. With the default `params.scenery`, it uses one candidate per `4`-unit cell on desktop and per `8`-unit cell on mobile. Each candidate costs five height evaluations. Land candidates add three biome and two cluster simplex samples, and density-accepted candidates add four more height samples for the slope.

The former tree path would have needed 1.15 million main-thread evaluations on desktop. With the default settings, the new path measured about `1.35` ms per chunk on desktop and `0.32` ms on mobile in Node, with at most about 550 and 120 instances per chunk. Enabling the dormant clouds would still add about **14.4 million** desktop and **9.6 million** mobile main-thread evaluations.

### Terrain Cost Per Chunk

| LOD | Desktop segments / vertices / triangles | Mobile segments / vertices / triangles |
| --- | --------------------------------------: | -------------------------------------: |
| 0   |                   128 / 16,641 / 32,768 |                     64 / 4,225 / 8,192 |
| 1   |                      64 / 4,225 / 8,192 |                     32 / 1,089 / 2,048 |
| 2   |                      32 / 1,089 / 2,048 |                         16 / 289 / 512 |
| 3   |                          16 / 289 / 512 |                           8 / 81 / 128 |
| 4   |                             8 / 81 / 128 |                                    n/a |

Normals are sampled from the height function inside the worker with four extra `getHeight()` calls per vertex, so a job costs about five height samples per vertex. LOD changes still allocate, resample, transfer, and replace complete geometry; the work is asynchronous but not cached.

### Decoration Geometry

Three.js r186 builds `IcosahedronGeometry` as a non-indexed polyhedron with:

```text
triangles = 20 * (detail + 1)^2
vertices = triangles * 3
```

| Type  | Detail | Base triangles | Base vertices | Position + normal + UV bytes |
| ----- | -----: | -------------: | ------------: | ---------------------------: |
| Cloud |     10 |          2,420 |         7,260 |                      232,320 |

The removed tree path used detail `5`: 720 triangles and 2,160 vertices per tree. Scenery impostors now cost 4 vertices and 2 triangles per instance; near the eye, `FEAT-004` draws the real source meshes instead (264 to 876 triangles per type). They share one baked atlas of about `67` MB on desktop and `38` MB on mobile, and each chunk adds a quad plus 32 bytes per instance.

Each chunk creates new copies of the cloud base geometry. Instance transforms and colors add more buffers, and GPU vertex work multiplies base geometry by the number of visible instances. Actual instance counts must be measured because placement depends on noise and `Math.random()`.

## Known Problem Register

| ID          | Priority | Status      | Problem                                                                                 | Evidence                                                                                                                                         |
| ----------- | -------- | ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OBS-001`   | P0       | In progress | No repeatable performance baseline or complete streaming telemetry.                     | Read-only chunk counters now exist; frame time, stage duration, and `renderer.info` telemetry remain absent.                                     |
| `STRM-001`  | P0       | Done        | Pending work must be keyed consistently and reject stale operations.                    | One `Map` entry per key plus desired-set revisions prevent duplicate and obsolete jobs.                                                          |
| `STRM-002`  | P0       | Done        | Desired-set reconciliation must inspect all live chunks.                                | A pure symmetric desired set is diffed against every live and pending key on each chunk transition.                                              |
| `PERF-001`  | P0       | Observed    | Dormant cloud placement scans all 65,536 integer positions in every chunk at every LOD. | The current feature flag prevents execution; `generateClouds()` still ignores its `density` variable and performs two noise calls per candidate. |
| `LIFE-001`  | P0       | Observed    | Per-chunk GPU resource ownership and disposal are incomplete.                           | Scenery geometry is disposed by `clearScenery()`; `Chunk.dispose()` still omits clouds and their unique geometry.                                |
| `PERF-002`  | P1       | In progress | Main-thread commits are limited by job count rather than a frame-time budget.           | Workers handle sampling/normals; buffer wrapping, GPU upload, scene mutation, and future scenery still commit synchronously.                     |
| `PERF-003`  | P1       | In progress | Every LOD transition reallocates and fully recomputes terrain geometry.                 | Workers now perform the computation, but each transition still creates and transfers a complete replacement buffer set.                          |
| `PERF-004`  | P1       | Observed    | Identical cloud base geometries are recreated per chunk.                                | The dormant cloud constructor allocates a new `IcosahedronGeometry`; scenery impostors already share one material and atlas.                     |
| `STATE-001` | P1       | Done        | Chunk registries must delete historical keys and remain bounded.                        | Live and pending state use keyed `Map` instances; disposal deletes entries. Browser traversal kept `created - disposed = live`.                  |
| `CORR-001`  | P1       | Observed    | Cloud candidates are offset by a full chunk instead of half a chunk.                    | Generation subtracts `size`; terrain local bounds are centered on `size / 2`. Scenery uses a chunk-aligned grid and is not affected.             |
| `CORR-002`  | P1       | Observed    | Boat world coordinates are assigned as local coordinates on a chunk child.              | `createBoat()` receives world X/Z, sets them on the clone, then adds it to the positioned chunk.                                                 |
| `STATE-002` | P1       | In progress | Runtime terrain-parameter updates remain incomplete.                                    | Parameter changes revision jobs, rebuild seeded noises, and regenerate scenery; dormant clouds and boats would retain old placement.              |
| `DET-001`   | P1       | In progress | Dormant cloud and boat placement is not deterministic.                                  | `?seed=` drives terrain, biomes, and hashed scenery placement; dormant clouds and boats still use `Math.random()`.                               |
| `TEST-001`  | P1       | In progress | Streaming and generation rules need broader automated regression coverage.              | Node tests now cover policy, deterministic buffers, topology, sea clamp, and edge continuity; cancellation and disposal remain browser-only.     |
| `STRM-003`  | P2       | In progress | Priority is biased by heading only and LOD has no hysteresis.                           | The set and LOD follow a quantized heading with sector hysteresis; camera visibility and recent LOD state are ignored, so turns re-generate many chunks. |
| `REND-001`  | P2       | Observed    | Shared material hooks and shared glTF resources have implicit ownership.                | Per-instance constructors overwrite callbacks on module-level or cloned shared materials.                                                        |
| `FRAME-001` | P2       | Observed    | Delta clamping slows traversal during stalls and can hide streaming pressure.           | Movement receives at most `0.016` seconds even when a frame takes longer.                                                                        |
| `LOAD-001`  | P3       | Done        | Re-enabling trees loaded the normal map through two independent paths.                  | The tree path was removed; `normal.jpg` now loads once from `chunk.js`.                                                                          |
| `MAINT-001` | P3       | Observed    | Dead paths and misleading names still obscure some lifecycle behavior.                  | `camera` is the plane and dormant scenery code remains; the former callback pool and unnecessary async declaration were removed.                 |

## Detailed Findings

### `STRM-001`: Keyed And Revision-Safe Work

Resolved on 2026-09-26. Pending work is now a `Map` keyed by chunk coordinate. Every desired-set transition increments a revision, replaces the target job for still-needed coordinates, removes jobs outside the desired set, and validates key, revision, and LOD immediately before execution.

Verified behavior:

- Each coordinate has at most one pending job.
- Jobs resolve the current chunk from the live `Map` instead of closing over a stale instance.
- A 20-second desktop traversal reached revision `8` with `live = 81`, `pending = 0`, and `created - disposed = 81` at every sample.
- Worker requests and responses carry key and revision; the manager validates both before allocating renderer-owned geometry.

### `STRM-002`: Complete Desired-Set Reconciliation

Resolved on 2026-09-26. `chunkPolicy.js` computes a pure symmetric Euclidean set around any positive or negative center. `ChunkManager` diffs every live and pending key against that set on a chunk transition, disposes live entries outside it, and deletes their registry records.

Verified behavior:

- Automated tests prove symmetric `81` desktop and `49` mobile sets, including a negative center.
- On 2026-09-30 the runtime adopted the heading-biased set described in [Terrain](TERRAIN.md#chunk-lifecycle); the symmetric set remains the policy's no-heading case. A desktop turn kept `live = desired = 110` after each sector change with `stale = 0` and `failed = 0`; mobile kept `73` or `68` depending on the sector.
- Desktop and mobile browser startup converged to `live = desired` and `pending = 0` without console or network errors.
- Retirement is still synchronous on a boundary frame; measuring that cost remains part of `OBS-001` and `PERF-002`.

### `PERF-001`: Cloud Sampling Dominates Static CPU Work

When clouds are enabled, every chunk performs `256 * 256` cloud candidates, including distant LOD 3 chunks. Each candidate evaluates two simplex-noise functions before the random acceptance test. The mobile/desktop density constant is unused, so mobile receives no reduction. The current terrain-only flags avoid this work but do not resolve the dormant implementation.

Candidate strategies:

- Sample a coarse seeded grid and scale cloud instances.
- Generate clouds only in near LODs.
- Use a deterministic sparse distribution such as jittered cells or Poisson-disc candidates.
- Move clouds to a world-level ring or tile cache independent of terrain chunks.
- Reuse lower-frequency values when neighboring candidates share a cell.

The first implementation should reduce candidate count before moving the same waste into a worker.

### `LIFE-001`: Resource Ownership Is Undefined

In Three.js r186, `Object3D.dispose()` dispatches a disposal event but explicitly does not dispose geometry, materials, or textures because they may be shared.

Current ownership facts:

- Terrain geometry is unique and explicitly disposed.
- Scenery geometry (a quad plus the instance buffer) is unique per chunk and disposed by `Chunk.clearScenery()`, including from `Chunk.dispose()`.
- Cloud geometry is unique per chunk but is not explicitly disposed, and the cloud instanced object is not disposed during chunk removal.
- The impostor material and atlas, and the cloud material, are shared resources and must not be disposed per chunk.
- Boat clones share geometry and material references with the template by default. Blindly disposing those resources per clone would break remaining boats and the template.
- Stale work can retain detached chunks and their children after scene removal.

Required direction: write an ownership table in code design, separate shared immutable resources from per-chunk buffers, and dispose only resources with a single owner. Boat resources either remain shared and immutable or must be cloned explicitly with reference-counted disposal.

### `PERF-002` And `PERF-003`: Main-Thread Spikes

The scheduler dispatches one near job or up to three farther jobs, bounded further by one mobile or up to two desktop workers. A near LOD 0 worker job performs 16,641 vertex height samples plus 66,564 normal samples; the main thread still wraps buffers and triggers GPU upload.

LOD transitions avoid recreating existing decorations but still allocate a new `PlaneGeometry`, evaluate heights, compute normals, transfer buffers, and replace the old geometry. There is no height cache or reusable geometry buffer. Running work is not interrupted; obsolete responses are discarded by key and revision.

Required direction: instrument worker duration, transfer delay, main-thread wrapping, GPU upload, and scene commit separately, then adopt a millisecond budget for the remaining main-thread stages.

### `CORR-001` And `CORR-002`: Ownership Coordinates

The dormant cloud loop generates local values in `[-size, -1]`, while a centered terrain chunk spans approximately `[-size / 2, size / 2]`. Its world samples are internally consistent, but most instances are owned by a neighboring spatial region. Scenery placement avoids this with a jittered grid aligned to chunk borders. This complicates culling, streaming edges, and disposal.

Boats sample valid world coordinates, then store those world values as the local transform of an object parented to the positioned chunk. The chunk transform is therefore applied a second time.

These correctness fixes must precede visual-density tuning so benchmarks measure content in the intended region.

## Strategy Options

| Strategy                                       | Solves                                             | Benefits                                                      | Risks and tradeoffs                                                                          | Recommendation                                |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Stabilize current tile system                  | Queue, registry, disposal, coordinate correctness  | Lowest migration risk; creates a trustworthy baseline         | Does not remove main-thread generation cost                                                  | Do first                                      |
| Keyed, cancellable, time-budgeted scheduler    | Duplicate/stale work and frame spikes              | Bounded state, observable priorities, supports workers later  | Requires explicit chunk states and cancellation semantics                                    | Foundation for further work                   |
| Reduce and stage decoration generation         | Dominant cloud scan and startup work               | Largest immediate CPU reduction; can preserve visual style    | Distribution must be redesigned and visually compared                                        | Do before worker migration                    |
| Share immutable geometry and cache height data | Allocation, GC, repeated sampling                  | Lower memory churn and faster LOD changes                     | Cache invalidation and ownership become explicit concerns                                    | Add after lifecycle repair                    |
| Worker pool with transferable typed arrays     | Main-thread terrain sampling and normal generation | Bounded off-thread CPU work with stale-result rejection       | Transfer, GPU upload, errors, and worker lifecycle still require measurement                 | Implemented for terrain; measure next         |
| Direction/frustum priority plus LOD hysteresis | Work usefulness and LOD churn                      | Generates visible/ahead content first                         | Can expose holes if desired-set policy is wrong                                              | Add after keyed scheduler                     |
| Fixed rings or geometry clipmap                | Repeated chunk creation and deletion               | Reuses a bounded mesh set; strong fit for an infinite flyover | Major shader, placement, culling, and CPU-height-query redesign                              | Evaluate after feature requirements are known |
| GPU procedural displacement                    | CPU vertex generation                              | Can eliminate most terrain vertex sampling on CPU             | Plane height, decorations, boats, normals, determinism, and tests still need a CPU/data path | Do not choose first                           |

### Architecture Direction

The tile lifecycle is stabilized and the terrain worker slice is active. The next step is to measure it before expanding workers to decorations, adding caches, or changing terrain architecture.

After stabilization, compare two strategic paths:

1. **Improved tiles:** keyed scheduler, worker-generated typed arrays, deterministic tile cache, shared decoration resources, LOD hysteresis.
2. **Clipmap/ring terrain:** a fixed set of reusable meshes centered around the plane, with world-space sampling and separate sparse systems for decorations.

Future gameplay requirements will determine the choice. Persistent world edits, exact object interaction, and deterministic revisiting favor explicit tiles. A mostly visual continuous flyover with limited terrain mutation favors clipmaps.

## Phased Remediation Plan

### Phase 0: Measure And Make Reproducible

Target issues: `OBS-001`, `DET-001`, `TEST-001`.

Tasks:

- Define target desktop and mobile devices, resolution, pixel ratio, and frame-time budgets.
- Add a deterministic seed for terrain and placement.
- Define a repeatable route that crosses enough chunk boundaries in multiple directions.
- Record frame p50/p95/p99, long tasks, create/update/dispose stage durations, queue length, desired/live/in-flight counts, and `renderer.info.memory`.
- Add pure tests for chunk coordinates, symmetric desired sets, LOD selection, and height continuity.

Acceptance criteria:

- The same seed and route produce comparable content and operation counts.
- A baseline report captures startup, five-minute traversal, and post-traversal memory.
- Instrumentation can be disabled and does not materially alter the measured path.

### Phase 1: Repair Streaming And Ownership

Target issues: `STRM-001`, `STRM-002`, `LIFE-001`, `STATE-001`, `CORR-001`, `CORR-002`, `STATE-002`.

Tasks:

- Replace object-plus-array registries with explicit `Map`-based desired, pending, live, and retiring states.
- Replace callbacks with keyed operations carrying desired LOD and a revision token.
- Cancel operations and reject results that are no longer desired.
- Diff all live chunks against a pure symmetric desired set.
- Delete retired registry entries and bound any cache intentionally.
- Define shared versus unique geometry, material, texture, and model ownership.
- Correct decoration and boat coordinate spaces.
- Make parameter changes rebuild noise and dependent content coherently or remove unsupported live controls.

Acceptance criteria:

- The queue contains at most one operation per chunk key.
- After long traversal, live and pending counts remain bounded by documented limits.
- No callback or worker result mutates a retired chunk.
- The adopted heading-biased shape produces 110 desktop and 73 mobile coordinates heading north (see [Terrain](TERRAIN.md#chunk-lifecycle)).
- Repeated create/retire cycles reach a stable renderer-memory plateau.
- Scenery, clouds, and boats remain inside their documented ownership region.

### Phase 2: Remove Dominant Waste

Target issues: `PERF-001`, `PERF-002`, `PERF-003`, `PERF-004`.

Tasks:

- Replace per-unit cloud scanning with a sparse deterministic strategy.
- Generate decorations only at LODs where they can contribute visually.
- Share immutable cloud base geometries (scenery already shares one impostor material and atlas).
- Lower geometry detail based on measured image quality.
- Split chunk generation into terrain, normals, and decoration stages.
- Schedule work by elapsed milliseconds, priority, and cancellation state.
- Evaluate a bounded height-data cache for adjacent LODs and revisited chunks.

Acceptance criteria:

- Cloud candidates fall by at least 90 percent from 65,536 per chunk, subject to visual approval.
- Only one base geometry per decoration type exists unless variants are justified.
- No scheduled main-thread stage exceeds the agreed frame budget on target devices.
- Visual comparison covers terrain seams, biome bands, scenery, clouds, boats, and distance fades.

### Phase 3: Move Pure Generation Off The Main Thread

Dependencies: Phases 0-2 and deterministic pure generation functions.

Current status: terrain topology, heights, normals, and transferable buffers are implemented with one mobile or up to two desktop workers. Decoration placement and performance acceptance remain open.

Tasks:

- Introduce a bounded worker pool rather than one worker per chunk.
- Generate height and placement typed arrays in workers.
- Transfer buffers instead of cloning large arrays.
- Carry key, LOD, seed, and revision in every request and response.
- Reject stale responses before allocating Three.js objects.
- Keep GPU object creation and renderer interaction on the main thread.

Acceptance criteria:

- Worker count and in-flight memory are bounded.
- Stale results are demonstrably ignored.
- Main-thread p95 frame time improves against the Phase 0 baseline.
- First-visible-terrain time does not regress beyond an agreed threshold.

### Phase 4: Decide The Long-Term Terrain Architecture

Dependencies: future feature list and measurements from optimized tiles.

Create an architecture decision record comparing improved tiles with fixed rings/clipmaps. Include:

- World persistence and editability.
- Required CPU height queries and collision precision.
- Decoration persistence and interaction.
- LOD seams and visual range.
- Memory limits and target hardware.
- Worker and GPU portability.
- Migration cost and test strategy.

Do not begin a clipmap or GPU-displacement rewrite before this decision.

## Secondary Known Debt

These issues are real but have not received the same depth of performance analysis:

| ID          | Priority | Area                | Current issue                                                                                      |
| ----------- | -------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `APP-001`   | P2       | Lifecycle           | No teardown for animation frames, listeners, audio, renderer, or scene resources.                  |
| `EXP-001`   | P2       | Responsive behavior | Mobile policy is fixed at startup width; crossing the breakpoint does not rebuild runtime policy.  |
| `EXP-002`   | P2       | Camera              | Mobile play transition ends at Z `-16`, but the later effect baseline is Z `-18`.                  |
| `A11Y-001`  | P2       | Interface           | Play and sound controls are not semantic buttons and lack keyboard behavior and accessible labels. |
| `LOAD-002`  | P2       | Reliability         | Startup-critical assets have no visible error or retry state.                                      |
| `ASSET-001` | P1       | Licensing           | Soundtrack and texture provenance are not recorded in dedicated license metadata.                  |
| `QUAL-001`  | P1       | Quality             | There is no linting, type checking, CI, browser automation, or visual regression baseline.         |

See the owning guides for current behavior and constraints. Promote an item into a detailed phase when it becomes part of an implementation milestone.

## Decisions Needed Before Implementation

1. Which desktop, laptop, and mobile devices define the support baseline?
2. Is the target 60 FPS, 30 FPS on mobile, or an adaptive quality policy?
3. Must revisiting coordinates reproduce identical terrain and decorations?
4. Will future features modify terrain or persist objects at world coordinates?
5. How dense must scenery and clouds remain to preserve the intended art direction?
6. Is short-term compatibility with the current world appearance more important than a clipmap migration?
7. How much startup latency is acceptable before the play action appears?

## Future Feature Intake

### `FEAT-001`: Post-Processing Pipeline And Speed Effect

- **Status:** In progress
- **User value:** Makes acceleration feel faster without affecting the sharp center of the view.
- **Behavior:** While boosting, blur and chromatic aberration grow from configurable radii toward the viewport edges. Idle frames bypass post-processing.
- **Dependencies:** `postprocessing` 6.x within its `three` peer range.
- **Affected systems:** Rendering, frame loop, debug GUI.
- **Performance budget:** No idle cost beyond the canvas render and, when the grain intensity is above `0`, one fullscreen canvas overlay without texture reads. While active: one 2x MSAA scene target, up to four downsample and three upsample passes at half resolution and below, and one fullscreen composite that samples only where masks are nonzero.
- **Options:** Hardware mipmap blur was rejected because box-filtered mips looked blocky. A single-level blurred image mixed with the sharp image was rejected because it ghosts. The pyramid with B-spline sampling gives a variable radius at low cost. Its downsample started as the 13-tap Jimenez filter and now uses a 5-tap dual filter (Bjørge 2015), about 60% fewer pyramid reads. Measured in headless Chrome on an Apple M1 at 2560×1600 with the flight paused, as frame time over idle at full intensity: the composer path alone cost about +6 ms with 4x MSAA, +3–4 ms with 2x, and +0.5 ms without MSAA; blur and aberration together add only 1–2 ms. The composer therefore uses 2x MSAA. Skipping the MSAA depth resolve (`resolveDepthBuffer`/`storeMultisampledDepthBuffer`) gave no measurable gain and was reverted. A masked upsample chain that moves the two-level blend from the full-resolution composite to the reduced levels (24 to 12 composite taps per aberrated pixel) also showed no measurable gain on the M1, where the whole blur costs 1–2 ms; it was later reintroduced to cut composite reads after reading red and blue with one bilinear tap per level visibly degraded the blur. Untried options for the remaining MSAA cost: rendering the scene to the MSAA canvas and copying it to a texture only while active (same quality), or SMAA with an unsampled composer (about −5 ms, different antialiasing in the sharp center).
- **Acceptance criteria:** Smooth blur without blockiness at maximum strength; sharp center; no shader errors; bypass restored after the boost. Remaining: mobile-device validation and frame-time measurement against a baseline (`OBS-001`).
- **Documentation:** [Rendering](RENDERING.md), [Architecture](ARCHITECTURE.md), [Experience](EXPERIENCE.md), [Development](DEVELOPMENT.md), [Quality](QUALITY.md).

### `FEAT-002`: Day/Night Cycle

- **Status:** In progress
- **User value:** Gives the flight a sense of time and variety: sunrise, daylight, sunset, and a starry night over the same procedural world.
- **Behavior:** Time of day advances continuously (default `240` seconds per day, start `0.3`). The sky dome shows a horizon-to-zenith gradient, sun and moon discs, and stars at night. Lights, fog, background, and the distant-terrain atmosphere follow keyframed palettes; shading follows the sun and moon. Everything is aligned with the curved world: the horizon dip sets the sky gradient, disc visibility, palette timing, and light fades, and terrain normals bend with the curvature and have a per-fragment terminator. The wing trails are tinted pink at dawn, orange at sunset, and blue at night; the airplane has no navigation lights for now. `?time=` sets the start, and the `?gui=1` **Day/night** folder scrubs, pauses, or changes the duration.
- **Dependencies:** None blocking. Scenery impostors use `uAtmosphere`, and dormant clouds share it for reactivation. Frame-time acceptance depends on `OBS-001`.
- **Affected systems:** Rendering (sky `ShaderMaterial`, shared `uAtmosphere`, lights, fog), terrain lighting (bent normals, `lights_fragment_begin` terminator), `Plane` (trail tint), frame loop, debug GUI, tests.
- **Performance budget:** One extra draw call for the sky (32×16 sphere, stars branch skipped by day), one extra directional light (moon), a few ALU ops per terrain vertex and per directional light per fragment, no `PointLight`, no shadows, and no per-frame allocation in the policy or runtime.
- **Options:** Palette interpolation with a gradient dome was chosen over the Three.js `Sky` addon (physically based but less stylized, and it needs tone mapping) and over flat background colors (no celestial bodies).
- **Acceptance criteria:** No shader errors. The horizon has no seam between the sky and fogged terrain. No light switches direction while lit. The sun rises and sets on the curved edge in sync with the palette. The dusk keyframe keeps the original static sky colors. Stars appear only at night. Pure policy tests pass. Verified so far in headless Chrome (SwiftShader) on desktop and a 390 px mobile viewport. Remaining: real mobile devices, frame-time measurement (`OBS-001`), and art-direction tuning of the palettes, especially night water saturation without tone mapping.
- **Follow-ups:** decide on airplane lights later (the first sprite version was removed); align cloud and boat lighting with curved normals when they are re-enabled (scenery impostors already use bent normals and the terminator).
- **Documentation:** [Rendering](RENDERING.md#daynight-cycle), [Architecture](ARCHITECTURE.md), [Experience](EXPERIENCE.md), [Development](DEVELOPMENT.md), [Quality](QUALITY.md).

### `FEAT-003`: Biome Scenery With Octahedral Impostors

- **Status:** In progress
- **User value:** Populates each biome in the clay/toy style of `public/style-references/`: round trees and conifers in temperate areas; cacti and red layered rocks in the desert; boulders in both.
- **Behavior:**
  - Six scenery types are built from Three.js primitives and baked at startup into a hemi-octahedral impostor atlas with albedo plus normals: `16 × 16` views per type on desktop and `12 × 12` on mobile.
  - Each instance is one camera-facing quad. It blends three frames and is lit from its baked normals with the terrain's curvature bend and terminator.
  - Placement is deterministic per seed. A world-space jittered grid runs in the chunk worker and applies biome, height band, slope, snow, and cluster rules.
  - Only chunks at LOD `≤ 2` carry scenery.
  - The `?gui=1` **Scenery** folder tunes the grid cell, the per-chunk cap, density per category (trees, cacti, rocks), and size per type. Changes use scenery-only worker jobs. The folder also sets a position-based brightness variation per type (shader uniforms, live) and the baked wood-grain detail (re-bake on release).
  - The seed now also moves the biome field (`uBiomeOffset`).
- **Dependencies:** `STRM-001` and `STRM-002` (keyed jobs and revisions carry the scenery result). The feature resolves the tree parts of `PERF-004`, `CORR-001`, `DET-001`, `LIFE-001`, and `LOAD-001`. Frame-time acceptance depends on `OBS-001`.
- **Affected systems:**
  - Terrain: `biome.js`, `sceneryPlacement.js`, worker protocol, chunk policy, and `Chunk` ownership.
  - Rendering: `src/impostors/`, impostor shaders, `curvedLights.js`, `uBiomeOffset`, and `rotateAroundAxis()`.
  - Also the loader (bake in `init()`), tests, and every guide.
- **Performance budget:**
  - Scenery work per frame: one draw call per scenery chunk (at most 61 on desktop) and 2 triangles per instance.
  - Instance counts: at most about 550 per chunk on desktop and 120 on mobile with the current defaults. The earlier `8`-unit, density-`1` defaults gave 1,800–2,300 at a desktop start over land.
  - Fragment cost: up to six atlas fetches per fragment, three on mobile with single-frame sampling.
  - Memory: an RGBA8 atlas pair of `3072 × 2048` on desktop (about `67` MB with mips) or `2304 × 1536` on mobile (about `38` MB). An earlier `8 × 8` grid used about `17` MB, but its 13–26° view spacing ghosted more between frames.
  - Bake and placement cost: the bake runs once, taking about `0.2`–`0.35` s in SwiftShader for the `16 × 16` grid, and placement costs about `1.35` ms per chunk on desktop and `0.32` ms on mobile (measured in Node).
  - Real-GPU frame time has not been measured.
- **Options:** real low-poly instanced meshes for every instance were rejected because the total instance count is high; `FEAT-004` uses them only for the few instances near the eye. Loaded `.glb` models were declined; sources stay procedural. An `IMPOSTOR_SINGLE_FRAME` path trades blend quality for fetches. A baked depth channel is reserved for a `gl_FragDepth` correction if slopes clip impostors visibly.
- **Acceptance criteria:**
  - Met so far:
    - JS and GLSL biome values match within `1e-5` (SwiftShader).
    - Placement is deterministic, unique per chunk, and biome-correct, which pure tests cover.
    - There are no shader errors.
    - Types appear in the correct biomes, and lighting is coherent at day, sunset, and night.
    - During desktop and mobile traversals, lifecycle counters stay bounded (`created - disposed = live`, `stale = failed = 0`).
  - Remaining:
    - Art-direction tuning of density, scale (cacti read small), and palette.
    - Real mobile devices.
    - Frame-time and overdraw measurement against `OBS-001`.
    - Steep-slope clipping review. Near-camera parallax and ghosting are handled by `FEAT-004`.
- **Documentation:** [Terrain](TERRAIN.md#per-chunk-scenery), [Rendering](RENDERING.md#impostor-scenery), [Architecture](ARCHITECTURE.md), [Assets](ASSETS.md), [Experience](EXPERIENCE.md), [Development](DEVELOPMENT.md), [Quality](QUALITY.md), `AGENTS.md`.

### `FEAT-004`: Near Scenery Meshes

- **Status:** In progress
- **User value:** Trees, cacti, and rocks stay sharp and solid when the airplane passes close to them. Impostors blur up close (64 px frames), their flat quad shows parallax and frame ghosting, and it clips into slopes.
- **Behavior:**
  - Inside an eye-distance band, each instance cross-fades from its impostor to its real source mesh: `110 → 150` units on desktop and `60 → 90` on mobile.
  - The cross-fade is a complementary screen-space dither, so every pixel shows exactly one of the two, with no blending or sorting.
  - The `?gui=1` **Scenery > Near meshes** folder toggles the system and moves the band live.
- **Dependencies:** `FEAT-003` (sources, placement layout, shared variation and wood detail). Frame-time acceptance depends on `OBS-001`.
- **Affected systems:**
  - Rendering: `src/impostors/sceneryMeshes.js`, the shared `scenery-*` GLSL chunks, the impostor vertex and color shaders, and `uSceneryMeshRange`.
  - Pure selection rules: `src/sceneryMeshPolicy.js` with tests.
  - Source geometry detail, which also changes the bake.
  - Also the frame loop, the GUI, and the stats.
- **Performance budget:**
  - Draws: at most six extra draw calls (one per type).
  - Geometry: source meshes lowered to 264–876 triangles per type, from up to 1,824.
  - CPU, per frame: a selection that visits only chunks near the eye, reads their instance arrays in place, frustum-culls each instance, and reuses doubling per-type buffers. It allocates nothing in steady state.
  - Upload: only the used buffer range, 32 bytes per selected instance.
  - Impostors inside the band start skip their fragments entirely.
  - Measured on an Apple M1 (Chrome, Metal, `1280 × 800`) at the default band with the default density:
    - up to 27 mesh instances, about 10,000 triangles, and three draw calls, with selection at or below the `0.1` ms timer resolution;
    - a stress band of `400 → 500` units reached 101 instances and about 39,000 triangles;
    - frame time stayed at the `16.7` ms vsync cap in every case.
- **Options:**
  - A per-chunk mesh draw without CPU selection was rejected, because every instance of every near chunk would be transformed even when collapsed.
  - An alpha-blended cross-fade was rejected, because it needs sorting and double-draws pixels.
  - A temporal dither was rejected, because it flickers without TAA.
  - The baked depth channel (`gl_FragDepth`) could reduce the remaining silhouette mismatch inside the band but is not used.
- **Acceptance criteria:**
  - Met so far:
    - no shader errors on the desktop and mobile paths;
    - with the flight paused, toggling the system swaps nearby instances with matching position, scale, color, wood detail, tint, and lighting at day and dusk;
    - the dither leaves no gaps beyond the small impostor silhouette mismatch;
    - pure tests pass.
  - Remaining:
    - real mobile devices and a mobile run with scenery inside the band;
    - frame-time measurement on weaker GPUs against `OBS-001`;
    - art review of the band distances while flying at boost.
- **Documentation:** [Rendering](RENDERING.md#near-scenery-meshes), [Architecture](ARCHITECTURE.md), [Terrain](TERRAIN.md#resource-lifecycle), [Experience](EXPERIENCE.md#responsive-behavior), [Development](DEVELOPMENT.md), [Quality](QUALITY.md), [Assets](ASSETS.md#textures), `AGENTS.md`.

Add further features with this template:

```markdown
### `FEAT-XXX`: Short Title

- **Status:** Observed | Ready | In progress | Blocked | Done
- **User value:** Why this feature exists.
- **Behavior:** What the user can observe or do.
- **Dependencies:** Issue IDs, assets, or decisions required first.
- **Affected systems:** Terrain, rendering, controls, assets, audio, UI, or tooling.
- **Performance budget:** Frame time, memory, loading, or network constraints.
- **Options:** Candidate implementations and tradeoffs.
- **Acceptance criteria:** Observable and measurable completion conditions.
- **Documentation:** Guides that must be updated.
```

Feature work must reference the technical issues it depends on. This prevents a feature from being designed around lifecycle or performance behavior already scheduled for replacement.
