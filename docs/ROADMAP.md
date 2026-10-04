# Technical Roadmap And Work Register

## Purpose

This is the living register for technical debt, performance work, architectural decisions, and future features. It records why work is needed before prescribing an implementation.

The first analysis focuses on terrain generation and streaming because they dominate current startup and traversal cost. Current behavior remains documented in [Terrain](TERRAIN.md), [Architecture](ARCHITECTURE.md), and [Rendering](RENDERING.md). Validation rules remain in [Quality](QUALITY.md).

Last baseline review: **2026-09-26**. The full-project review of **2026-10-02** ([Project Review](reviews/2026-10-02-project-review.md)) lists its findings by area, a phased plan, and which items are done; promote an item into this register when it becomes part of a milestone.

Current implementation scope: `worldFeatures` enables scenery (trees, cacti, and rocks as octahedral impostors, `FEAT-003`, replaced by real meshes near the eye, `FEAT-004`) and clouds (a world-level field with the same impostor treatment and their own shadows, `FEAT-006`), and still disables boats. The dormant boat implementation remains for later reintroduction; the historical cost analysis of the former per-chunk clouds stays in this document for reference.

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
     -> every frame and on each worker completion, sort pending jobs and fill every idle worker
            -> chunkGeometry.worker.js (no three.js)
                 -> typed-array grid in PlaneGeometry layout
                 -> getHeight() for every terrain vertex
                 -> central-difference normals (4 extra samples/vertex, about 2 at desktop LOD 0)
                 -> transfer position/normal/height buffers and a bounding sphere
            -> ready queue, committed nearest first within the frame budget
            -> main thread validates key + revision
                 -> wrap buffers in BufferGeometry with the per-LOD shared index and uv
                 -> create Chunk or replace its geometry
                 -> scenery placement within the radial range (transferred Float32Array)
            -> main thread: Chunk.setScenery() -> one impostor quad mesh per chunk
                 -> [disabled] boats
  -> SceneryMeshes.update(): select near instances per level -> one instanced mesh per type and LOD
  -> Clouds.update(): re-place the cloud field on a new cloud cell -> one impostor mesh + near cloud meshes
  -> SceneryShadows.update() / CloudShadows.update(): depth cascades / blurred coverage map
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
| Former per-chunk cloud candidates |                                                   7,208,960 |                                          4,784,128 |
| Former cloud noise evaluations |                                                     14,417,920 |                                          9,568,256 |
| Cloud field cells per rebuild |                       625 (841 with the two-cell neighbour border) |      225 (361 with the two-cell neighbour border) |

Terrain startup performed about **1.91 million** noise evaluations on desktop and **400 thousand** on mobile at the 2026-09-26 baseline; shared normal samples at desktop LOD 0 now lower the desktop total, which has not been recounted. They are distributed across up to four desktop workers or one mobile worker.

Scenery placement also runs in those workers. With the default `params.scenery`, it uses one candidate per `4`-unit cell on desktop and per `8`-unit cell on mobile. Each candidate costs five height evaluations. Land candidates add three biome and two cluster simplex samples, and density-accepted candidates add four more height samples for the slope.

The former tree path would have needed 1.15 million main-thread evaluations on desktop. With the default settings, the new path measured about `1.35` ms per chunk on desktop and `0.32` ms on mobile in Node, with at most about 550 and 120 instances per chunk. The former per-chunk clouds would have added about **14.4 million** desktop and **9.6 million** mobile main-thread evaluations. The world-level cloud field (`FEAT-006`) evaluates one coverage noise and a few hashes per cell, at most 484 cells per rebuild on desktop, once per `160` units of travel: about `0.3` ms on desktop and `0.1` ms on mobile in Node.

### Terrain Cost Per Chunk

| LOD | Desktop segments / vertices / triangles | Mobile segments / vertices / triangles |
| --- | --------------------------------------: | -------------------------------------: |
| 0   |                   128 / 16,641 / 32,768 |                     64 / 4,225 / 8,192 |
| 1   |                      64 / 4,225 / 8,192 |                     32 / 1,089 / 2,048 |
| 2   |                      32 / 1,089 / 2,048 |                         16 / 289 / 512 |
| 3   |                          16 / 289 / 512 |                           8 / 81 / 128 |
| 4   |                             8 / 81 / 128 |                                    n/a |

Normals are sampled from the height function inside the worker with four extra `getHeight()` calls per vertex, so a job costs about five height samples per vertex; at desktop LOD 0 the shared samples bring it to about three. Measured in Node on an Apple M1 (2026-10-02): desktop LOD 0 `31` → `16` ms, LOD 1 `8.5` → `6.5` ms, mobile LOD 0 `8.2` → `6.5` ms, the other levels about `-20%` from the table-based `snoise()` permutation. LOD changes still allocate, resample, transfer, and replace per-chunk buffers; the work is asynchronous but not cached.

### Decoration Geometry

Three.js r186 builds `IcosahedronGeometry` as a non-indexed polyhedron with:

```text
triangles = 20 * (detail + 1)^2
vertices = triangles * 3
```

| Type         | Detail | Base triangles | Base vertices | Position + normal + UV bytes |
| ------------ | -----: | -------------: | ------------: | ---------------------------: |
| Former cloud |     10 |          2,420 |         7,260 |                      232,320 |

The removed tree path used detail `5`: 720 triangles and 2,160 vertices per tree. Scenery impostors now cost 4 vertices and 2 triangles per instance; near the eye, `FEAT-004` draws the real source meshes instead, in two levels of detail (264 to 876 triangles per type at LOD 0, 78 to 364 at LOD 1). They share one baked atlas of about `67` MB on desktop and `38` MB on mobile, and each chunk adds a quad plus 32 bytes per instance.

The former clouds created new copies of that base geometry in every chunk. The current clouds (`FEAT-006`) are one impostor quad per cloud (about 95 on desktop, 55 on mobile, one draw call), and near the eye one of three shared extruded sources per level: about 2,870–4,350 triangles at LOD 0 and 680–1,040 at LOD 1. A desktop flight view drew about 13–15 near cloud meshes for 11,000–20,000 triangles. Their frontal-view atlas takes about `9` MB on desktop (about `42` MB with the former lower-hemisphere grid), plus about `2` MB for the shadow atlas.

## Known Problem Register

| ID          | Priority | Status      | Problem                                                                                 | Evidence                                                                                                                                         |
| ----------- | -------- | ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OBS-001`   | P0       | In progress | No repeatable performance baseline or complete streaming telemetry.                     | Since 2026-10-03 `getRenderStats()` reports frame intervals, per-stage main-thread time, whole-frame `renderer.info` counters, and GPU time where the timer extension exists; `pnpm bench` compares builds with a deterministic headless-Chrome flight and bit-identical held captures ([Quality](QUALITY.md#comparing-builds)). Remaining: target devices and budgets, and measurements on real phones. |
| `STRM-001`  | P0       | Done        | Pending work must be keyed consistently and reject stale operations.                    | One `Map` entry per key plus desired-set revisions prevent duplicate and obsolete jobs.                                                          |
| `STRM-002`  | P0       | Done        | Desired-set reconciliation must inspect all live chunks.                                | A pure symmetric desired set is diffed against every live and pending key on each chunk transition.                                              |
| `PERF-001`  | P0       | Done        | Dormant cloud placement scanned all 65,536 integer positions in every chunk at every LOD. | Replaced by the world-level cloud field (`FEAT-006`): a `160`-unit grid, at most 841 cells per rebuild with the default sizes, once per cell of travel.                 |
| `LIFE-001`  | P0       | Observed    | Per-chunk GPU resource ownership and disposal are incomplete.                           | Scenery geometry is disposed by `clearScenery()`; clouds are no longer per-chunk. Boat clones and their shared resources remain undisposed.        |
| `PERF-002`  | P1       | In progress | Main-thread commits were limited by job count rather than a frame-time budget.          | Since 2026-10-02 workers take their next job on completion and results commit nearest first within `CHUNK_STREAMING.commitBytes` and `commitMs`; desktop startup converges in `0.46` s instead of `1.55` s (Apple M1). GPU upload time is still unmeasured (`OBS-001`). |
| `PERF-003`  | P1       | In progress | Every LOD transition reallocates and fully recomputes terrain geometry.                 | Each transition still recomputes heights and normals and transfers new position, normal, and height buffers; index and uv are shared per LOD, desktop LOD 0 jobs cost half (shared normal samples), and CPU copies are freed after upload. There is no height cache. |
| `PERF-004`  | P1       | Done        | Identical cloud base geometries were recreated per chunk.                               | Cloud sources are built once per near-mesh level and baked into one atlas; the field draws one impostor mesh (`FEAT-006`).                        |
| `STATE-001` | P1       | Done        | Chunk registries must delete historical keys and remain bounded.                        | Live and pending state use keyed `Map` instances; disposal deletes entries. Browser traversal kept `created - disposed = live`.                  |
| `CORR-001`  | P1       | Done        | Cloud candidates were offset by a full chunk instead of half a chunk.                   | The per-chunk cloud loop was removed; the cloud field places world-space bases on its own grid (`FEAT-006`).                                     |
| `CORR-002`  | P1       | Observed    | Boat world coordinates are assigned as local coordinates on a chunk child.              | `createBoat()` receives world X/Z, sets them on the clone, then adds it to the positioned chunk.                                                 |
| `STATE-002` | P1       | In progress | Runtime terrain-parameter updates remain incomplete.                                    | Parameter and GUI seed changes revision jobs, rebuild seeded noises and the biome offset, and regenerate scenery; a seed change re-places the clouds; dormant boats would retain old placement. |
| `DET-001`   | P1       | In progress | Dormant boat placement is not deterministic.                                            | `?seed=` drives terrain, biomes, hashed scenery placement, and the cloud field; dormant boats still use `Math.random()`.                          |
| `TEST-001`  | P1       | In progress | Streaming and generation rules need broader automated regression coverage.              | Node tests now cover policy, deterministic buffers, topology, sea clamp, and edge continuity; cancellation and disposal remain browser-only.     |
| `STRM-003`  | P2       | In progress | Priority is biased by heading only and LOD has no hysteresis.                           | The set and LOD follow a quantized heading with sector hysteresis; camera visibility and recent LOD state are ignored, so turns re-generate many chunks. |
| `REND-001`  | P2       | Observed    | Shared material hooks and shared glTF resources have implicit ownership.                | Per-instance constructors overwrite callbacks on module-level or cloned shared materials.                                                        |
| `FRAME-001` | P2       | Observed    | Delta clamping slows traversal during stalls and can hide streaming pressure.           | Movement receives at most `0.016` seconds even when a frame takes longer.                                                                        |
| `LOAD-001`  | P3       | Done        | Re-enabling trees loaded the normal map through two independent paths.                  | The tree path was removed; terrain normal maps load once through `getTerrainNormalTexture()` in `terrainNormals.js`.                              |
| `MAINT-001` | P3       | In progress | Dead paths and misleading names still obscure some lifecycle behavior.                  | `camera` is the plane and the dormant boat code remains. Removed: the former callback pool, an unnecessary async declaration, and (2026-10-02) `Chunk.applyCurvature()`, the forced-LOD path, unused fields and imports, and most commented-out code. |

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

Resolved on 2026-10-02 by `FEAT-006`, which took the world-level option below with a jittered seeded grid. The former implementation performed `256 * 256` cloud candidates in every chunk, including distant LOD 3 chunks. Each candidate evaluated two simplex-noise functions before the random acceptance test, and the mobile/desktop density constant was unused.

Candidate strategies considered:

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
- Clouds are no longer per-chunk content. `Clouds` owns its atlas, materials, near meshes, and one impostor geometry, replaced and disposed on every regeneration.
- The scenery impostor material and atlas are shared resources and must not be disposed per chunk.
- Boat clones share geometry and material references with the template by default. Blindly disposing those resources per clone would break remaining boats and the template.
- Stale work can retain detached chunks and their children after scene removal.

Required direction: write an ownership table in code design, separate shared immutable resources from per-chunk buffers, and dispose only resources with a single owner. Boat resources either remain shared and immutable or must be cloned explicitly with reference-counted disposal.

### `PERF-002` And `PERF-003`: Main-Thread Spikes

Since 2026-10-02 the scheduler fills every idle worker each frame and again whenever a worker finishes (one mobile worker, half the logical cores up to four on desktop), and finished results commit nearest first within a per-frame byte and time budget. A near desktop LOD 0 worker job performs 16,641 vertex height samples plus about 33,000 shared normal samples; the main thread still wraps buffers and triggers GPU upload.

LOD transitions avoid recreating existing decorations but still evaluate heights, compute normals, transfer new position, normal, and height buffers, and replace the old geometry; index and uv are shared per LOD. There is no height cache or reusable geometry buffer. Running work is not interrupted; obsolete responses are discarded by key and revision.

Required direction: instrument worker duration, transfer delay, main-thread wrapping, GPU upload, and scene commit separately, then adopt a millisecond budget for the remaining main-thread stages.

### `CORR-001` And `CORR-002`: Ownership Coordinates

`CORR-001` is resolved: the former cloud loop generated local values in `[-size, -1]`, while a centered terrain chunk spans approximately `[-size / 2, size / 2]`, so most instances were owned by a neighboring spatial region. The loop was removed; the cloud field uses world-space bases on its own grid, and scenery uses a jittered grid aligned to chunk borders.

Boats sample valid world coordinates, then store those world values as the local transform of an object parented to the positioned chunk. The chunk transform is therefore applied a second time.

These correctness fixes must precede visual-density tuning so benchmarks measure content in the intended region.

## Strategy Options

| Strategy                                       | Solves                                             | Benefits                                                      | Risks and tradeoffs                                                                          | Recommendation                                |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Stabilize current tile system                  | Queue, registry, disposal, coordinate correctness  | Lowest migration risk; creates a trustworthy baseline         | Does not remove main-thread generation cost                                                  | Do first                                      |
| Keyed, cancellable, time-budgeted scheduler    | Duplicate/stale work and frame spikes              | Bounded state, observable priorities, supports workers later  | Requires explicit chunk states and cancellation semantics                                    | Foundation for further work                   |
| Reduce and stage decoration generation         | Decoration scans and startup work (the cloud scan is done) | Largest immediate CPU reduction; can preserve visual style    | Distribution must be redesigned and visually compared                                        | Do before worker migration                    |
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

- Replace per-unit cloud scanning with a sparse deterministic strategy. Done by `FEAT-006`.
- Generate decorations only at LODs where they can contribute visually.
- Share immutable cloud base geometries. Done by `FEAT-006`; scenery already shares one impostor material and atlas.
- Lower geometry detail based on measured image quality.
- Split chunk generation into terrain, normals, and decoration stages.
- Schedule work by elapsed milliseconds, priority, and cancellation state.
- Evaluate a bounded height-data cache for adjacent LODs and revisited chunks.

Acceptance criteria:

- Cloud candidates fall by at least 90 percent from 65,536 per chunk, subject to visual approval. Met: at most 841 candidates per field rebuild with the default sizes, independent of chunks.
- Only one base geometry per decoration type exists unless variants are justified.
- No scheduled main-thread stage exceeds the agreed frame budget on target devices.
- Visual comparison covers terrain seams, biome bands, scenery, clouds, boats, and distance fades.

### Phase 3: Move Pure Generation Off The Main Thread

Dependencies: Phases 0-2 and deterministic pure generation functions.

Current status: terrain heights, normals, and transferable buffers are implemented in a worker pool of one mobile or up to four desktop workers that load no three.js; scenery placement also runs there. Performance acceptance against a Phase 0 baseline remains open.

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
- **Behavior:** A minimum edge blur and chromatic aberration is always on, equal to a `0.4` speed effect (`params.postProcessing.idleSpeedEffect`). While boosting they grow from configurable radii toward the viewport edges up to full strength. The FOV kick is unchanged. Every frame renders through the composer, whose 2x MSAA is the only antialiasing; the canvas has no MSAA or depth buffer, and the film grain is the last effect of the same pass. With the idle level at `0` the edges stay sharp, but the chain still runs.
- **Dependencies:** `postprocessing` 6.x within its `three` peer range.
- **Affected systems:** Rendering, frame loop, debug GUI.
- **Performance budget:** The composer chain runs every frame, so the cost below (mostly the 2x MSAA resolve, measured at about +3–4 ms at 2560×1600 on an Apple M1) applies at cruise too. At the default idle intensity (about `0.259`) the reachable blur exceeds `8` pixels on viewports taller than about `825` pixels, so all four pyramid levels render. The canvas no longer allocates or resolves its own MSAA color and depth buffers (removed 2026-10-02, because the composer was already always on), and the grain no longer adds a blended full-screen draw. Per frame: one 2x MSAA scene target, up to four downsample and three upsample passes at half resolution and below, and one fullscreen composite that samples only where masks are nonzero. Not yet measured against a baseline.
- **Options:** Hardware mipmap blur was rejected because box-filtered mips looked blocky. A single-level blurred image mixed with the sharp image was rejected because it ghosts. The pyramid with B-spline sampling gives a variable radius at low cost. Its downsample started as the 13-tap Jimenez filter and now uses a 5-tap dual filter (Bjørge 2015), about 60% fewer pyramid reads. Measured in headless Chrome on an Apple M1 at 2560×1600 with the flight paused, as frame time over idle at full intensity: the composer path alone cost about +6 ms with 4x MSAA, +3–4 ms with 2x, and +0.5 ms without MSAA; blur and aberration together add only 1–2 ms. The composer therefore uses 2x MSAA. Skipping the MSAA depth resolve (`resolveDepthBuffer`/`storeMultisampledDepthBuffer`) gave no measurable gain and was reverted. A masked upsample chain that moves the two-level blend from the full-resolution composite to the reduced levels (24 to 12 composite taps per aberrated pixel) also showed no measurable gain on the M1, where the whole blur costs 1–2 ms; it was later reintroduced to cut composite reads after reading red and blue with one bilinear tap per level visibly degraded the blur. Untried options for the remaining MSAA cost: rendering the scene to the MSAA canvas and copying it to a texture only while active (same quality), or SMAA with an unsampled composer (about −5 ms, different antialiasing in the sharp center).
- **Acceptance criteria:** Smooth blur without blockiness at maximum strength; sharp center; no shader errors; the cruise minimum restored after the boost with the default idle level. Remaining: mobile-device validation and frame-time measurement against a baseline (`OBS-001`).
- **Documentation:** [Rendering](RENDERING.md), [Architecture](ARCHITECTURE.md), [Experience](EXPERIENCE.md), [Development](DEVELOPMENT.md), [Quality](QUALITY.md).

### `FEAT-002`: Day/Night Cycle

- **Status:** In progress
- **User value:** Gives the flight a sense of time and variety: sunrise, daylight, sunset, and a starry night over the same procedural world.
- **Behavior:** Time of day advances continuously (default `240` seconds per day, start `0.3`). The sky dome shows a horizon-to-zenith gradient, sun and moon discs, and stars at night. Lights, fog, background, and the distant-terrain atmosphere follow keyframed palettes; shading follows the sun and moon. Everything is aligned with the curved world: the horizon dip sets the sky gradient, disc visibility, palette timing, and light fades, and terrain normals bend with the curvature and have a per-fragment terminator. The wing trails are tinted pink at dawn, orange at sunset, and blue at night; the airplane has no navigation lights for now. `?time=` sets the start, the `?gui=1` **Day/night** folder scrubs, pauses, or changes the duration, and the **Sky** folder tunes the gradient height, the radial fog range, and every keyframe's palette live.
- **Dependencies:** None blocking. Scenery impostors use `uAtmosphere`; clouds skip its clamp and only fog fades them. Frame-time acceptance depends on `OBS-001`.
- **Affected systems:** Rendering (sky `ShaderMaterial`, shared `uAtmosphere`, lights, fog), terrain lighting (bent normals, `lights_fragment_begin` terminator), `Plane` (trail tint), frame loop, debug GUI, tests.
- **Performance budget:** One extra draw call for the sky (32×16 sphere, drawn last on the far plane so only pixels the scene leaves empty run its shader; stars branch skipped by day), one extra directional light (moon), a few ALU ops per terrain vertex and per directional light per fragment, no `PointLight`, no Three.js shadow maps, and no per-frame allocation in the policy or runtime. Scenery shadows from the sun or moon are a separate feature (`FEAT-005`).
- **Options:** Palette interpolation with a gradient dome was chosen over the Three.js `Sky` addon (physically based but less stylized, and it needs tone mapping) and over flat background colors (no celestial bodies).
- **Acceptance criteria:** No shader errors. The horizon has no seam between the sky and fogged terrain. No light switches direction while lit. The sun rises and sets on the curved edge in sync with the palette. The dusk keyframe keeps the original static sky colors. Stars appear only at night. Pure policy tests pass. Verified so far in headless Chrome (SwiftShader) on desktop and a 390 px mobile viewport. Remaining: real mobile devices, frame-time measurement (`OBS-001`), and art-direction tuning of the palettes, now under the default ACES Filmic tone mapping (since 2026-10-03), which darkens the night.
- **Follow-ups:** decide on airplane lights later (the first sprite version was removed); align boat lighting with curved normals when boats are re-enabled (scenery and clouds already use bent normals and the terminator).
- **Documentation:** [Rendering](RENDERING.md#daynight-cycle), [Architecture](ARCHITECTURE.md), [Experience](EXPERIENCE.md), [Development](DEVELOPMENT.md), [Quality](QUALITY.md).

### `FEAT-003`: Biome Scenery With Octahedral Impostors

- **Status:** In progress
- **User value:** Populates each biome in the clay/toy style of [`docs/style-references/`](style-references/): round trees and conifers in temperate areas; cacti and red layered rocks in the desert; boulders in both.
- **Behavior:**
  - Six scenery types are built from Three.js primitives and baked at startup into a hemi-octahedral impostor atlas with albedo plus normals: `12 × 12` views per type on desktop and mobile (desktop used `16 × 16` until the near meshes took over the close range).
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
  - Memory: an RGBA8 atlas pair of `2304 × 1536` (about `38` MB with mips) on desktop and mobile. The earlier `16 × 16` desktop grid used `3072 × 2048` (about `67` MB). An earlier `8 × 8` grid used about `17` MB, but its 13–26° view spacing ghosted more between frames.
  - Bake and placement cost: the bake runs once, taking about `0.2`–`0.35` s in SwiftShader for the earlier `16 × 16` grid (the `12 × 12` grid renders 44% fewer views), and placement costs about `1.35` ms per chunk on desktop and `0.32` ms on mobile (measured in Node).
  - Real-GPU frame time has not been measured.
- **Options:** real low-poly instanced meshes for every instance were rejected because the total instance count is high; `FEAT-004` uses them only for the few instances near the eye. Loaded `.glb` models were declined; sources stay procedural. An `IMPOSTOR_SINGLE_FRAME` path trades blend quality for fetches. The baked depth channel could also drive a `gl_FragDepth` correction if slopes clip impostors visibly; `FEAT-005` reads it to rebuild impostor surfaces for shadows.
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
  - Near the eye each instance is a real mesh in two levels of detail.
    - Impostor to reduced-detail mesh (LOD 1): `220 → 300` units on desktop and `120 → 180` on mobile.
    - LOD 1 to full-detail mesh (LOD 0): `110 → 150` on desktop and `60 → 90` on mobile.
  - Every hand-over is a complementary screen-space dither, so every pixel shows exactly one of LOD 0, LOD 1, or the impostor, with no blending or sorting.
  - The `?gui=1` **Scenery > Near meshes** folder toggles the system and moves both bands live.
  - The first version used a single level with the impostor band at `110 → 150` / `60 → 90`. The meshes now appear from twice that distance, and LOD 1 keeps the extra instances cheap.
- **Dependencies:** `FEAT-003` (sources, placement layout, shared variation and wood detail). Frame-time acceptance depends on `OBS-001`.
- **Affected systems:**
  - Rendering: `src/impostors/sceneryMeshes.js`, the shared `scenery-*` GLSL chunks, the impostor vertex and color shaders, `uSceneryMeshRange`, and `uSceneryMeshLodRange`.
  - Pure selection rules: `src/sceneryMeshPolicy.js` with tests.
  - Source geometry detail, which also changes the bake, plus the reduced LOD 1 builders.
  - Also the frame loop, the GUI, and the stats.
- **Performance budget:**
  - Draws: at most twelve extra draw calls (one per type and level).
  - Geometry: LOD 0 source meshes lowered to 264–876 triangles per type, from up to 1,824. LOD 1 uses 78–364.
  - CPU, per frame: a selection that visits only chunks near the eye, reads their instance arrays in place, frustum-culls each instance, and reuses doubling per-type buffers. It allocates nothing in steady state.
  - Upload: only the used buffer range, 32 bytes per selected instance.
  - Impostors inside the band start skip their fragments entirely.
  - Measured on an Apple M1 (Chrome, Metal, `1280 × 800`, default density), on the same paused forest view:
    - with the two-level defaults: 48 mesh instances (5 at LOD 0, 43 at LOD 1), about 10,300 triangles, and six draw calls, with selection at or below the `0.1` ms timer resolution;
    - the same view with LOD 0 everywhere: about 18,900 triangles;
    - the earlier single-level stress band of `400 → 500` units: 101 instances and about 39,000 triangles;
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
    - at its distances, LOD 1 is indistinguishable from the impostor and from LOD 0;
    - the dither leaves no gaps beyond the small impostor silhouette mismatch;
    - pure tests pass.
  - Remaining:
    - real mobile devices and a mobile run with scenery inside the band;
    - frame-time measurement on weaker GPUs against `OBS-001`;
    - art review of the band distances while flying at boost.
- **Documentation:** [Rendering](RENDERING.md#near-scenery-meshes), [Architecture](ARCHITECTURE.md), [Terrain](TERRAIN.md#resource-lifecycle), [Experience](EXPERIENCE.md#responsive-behavior), [Development](DEVELOPMENT.md), [Quality](QUALITY.md), [Assets](ASSETS.md#textures), `AGENTS.md`.

### `FEAT-005`: Soft Scenery Shadows

- **Status:** In progress
- **User value:** Trees, cacti, rocks, and the airplane cast shadows on the ground and on neighboring scenery, which anchors objects to the terrain and shows the sun direction.
- **Behavior:**
  - The sun by day and the moon by night cast shadows. Shadows fade in with the light's elevation, so they are gone at the hand-over and never pop.
  - Two light-aligned cascades: a sharper near one around the plane and a coarser far one. The near cascade renders every frame and the far one every 2 frames (3 on mobile).
  - Edges are always soft and grow softer with distance. Shadows weaken with distance and vanish at `450` units (`360` on mobile). The cascade hand-over is a radial blend.
  - The `?gui=1` **Shadows** folder sets enable, strength, softness, fade, bias, and cascade radii live.
- **Dependencies:** `FEAT-002` (light directions), `FEAT-003` (atlas, instance layout, baked depth), `FEAT-004` (near-mesh receivers). Frame-time acceptance depends on `OBS-001`.
- **Affected systems:** `src/sceneryShadows.js`, `src/shadowPolicy.js` with tests, the caster and receiver GLSL, `curvedLights.js`, terrain, impostor, and near-mesh materials, the frame loop, the GUI, and the stats.
- **Performance budget:**
  - GPU passes: about 5–25 instanced quad draws per rendered cascade plus the airplane's simplified caster (about 4,000 triangles, since 2026-10-04) in the near cascade only, depth only.
  - CPU: one loop over live chunks and a few matrix updates per frame, with no per-instance work and no per-frame allocation. `updateMs` was about `0.3` ms in headless Chrome.
  - Fragments: terrain samples 8 PCF taps near, 4 far, and at most 12 in the blend band (4/2 on mobile); scenery uses 4 (mesh) or 2 (impostor) taps. Since 2026-10-03 the taps read a constant kernel with one rotation per pixel instead of a cosine and sine per tap, which saved about `0.5` ms (`2.8%`) per frame at `3840 × 2160` on an Apple M1. Pixels beyond the fade only pay a branch.
  - Memory: about `25` MB on desktop (two `2048²` targets with 16-bit depth and the required `R8` color attachment), a quarter on mobile.
  - Frame time on phones has not been measured.
- **Options:**
  - Three.js `renderer.shadowMap` was rejected: it has no cascades or distance fade, and every patched material would need custom depth materials.
  - Real meshes as near casters were rejected: they need a CPU selection outside the camera frustum. Light-facing impostor silhouettes match the near-cascade texel density.
  - Blob decals were rejected: they have no shape and z-fight on slopes.
- **Acceptance criteria:**
  - Met so far:
    - no shader errors on the desktop and 390 px mobile paths in headless Chrome;
    - soft rock and cactus shadows attached at the base, in the right direction, by day and under the moon;
    - with the flight paused and shadows toggled, objects are not self-shadowed;
    - pure tests pass.
  - Remaining:
    - visual confirmation of the airplane shadow and of tree-on-tree shadows on impostors;
    - shimmer review during long flights;
    - real mobile devices;
    - frame-time measurement against `OBS-001`.
- **Documentation:** [Rendering](RENDERING.md#scenery-shadows), [Architecture](ARCHITECTURE.md), [Quality](QUALITY.md), `AGENTS.md`.

### `FEAT-006`: Carved-Wood Clouds With Impostors And Cloud Shadows

- **Status:** In progress
- **User value:** Fills the sky with cream, carved-wood clouds in the style of [`docs/style-references/cloud-reference.png`](style-references/cloud-reference.png), above the flight ceiling, and lets their soft shadows drift over the land.
- **Behavior:**
  - Three cloud shapes (`bank`, `heap`, `puff`), each two extruded slabs with flat faces and rounded edges, in varied sizes. Every cloud turns about its vertical axis so its front face looks at the airplane.
  - A world-level field around the airplane, independent of chunks: a deterministic seeded grid (`160` units) with cloudy and clear regions, bases at Y `197`–`257` (raised from `130`–`190` on 2026-10-02), above the highest eye (about Y `102`). Radius `1850` units on desktop (`1500` before 2026-10-02) and `1100` on mobile, with a far fade inside it. Three seeded low-frequency noise fields vary density, coverage, and size smoothly across the world (about `4000`-unit regions), so the sky changes character during the flight; altitude and radius stay fixed.
  - The scenery treatment: impostors far away, baked only from a frontal band of views because clouds face the airplane and are always seen from below, and real meshes in two levels of detail near the eye, cross-faded by the shared dither.
  - Soft cloud shadows on the terrain and the scenery from a blurred, light-aligned coverage map, re-rendered only after travel, light rotation, or a field change.
  - The `?gui=1` **Clouds** folder tunes placement and its regional variation, near-mesh bands, wood detail, ambient boost, brightness variation, and shadows.
- **Dependencies:** `FEAT-003` and `FEAT-004` (impostor pipeline and near meshes, generalized through impostor catalogs), `FEAT-005` (shadowing light). Resolves `PERF-001`, `PERF-004`, `CORR-001`, and the cloud parts of `LIFE-001`, `STATE-002`, and `DET-001`. Frame-time acceptance depends on `OBS-001`.
- **Affected systems:**
  - Terrain: `cloudPlacement.js` (pure), the removed per-chunk cloud code in `Chunk`, and `sceneryPlacement.js` (exported `cellRandom()`).
  - Rendering: `impostorCatalogs.js`, `cloudArchetypes.js`, `scenery-facing.glsl` (the facing yaw), the generalized baker, impostor material, and `SceneryMeshes`, `octahedral.js` and its GLSL twin (view layouts: the lower hemisphere and the frontal band), `curvedLights.js` (unshadowed variant with ambient scale), `clouds.js`, `cloudShadows.js`, the shadow caster shaders, and every shadow receiver.
  - Also the frame loop, the GUI, the stats, and tests.
- **Performance budget:**
  - Draws: one impostor draw for the whole field, at most six near cloud mesh draws, and per shadow render one caster draw and two blur passes.
  - Geometry: about 11,000–20,000 near cloud triangles in a desktop flight view (13–15 meshes).
  - CPU: about `0.3` ms per field rebuild on desktop (once per `160` units of travel), and a near-mesh selection over about 95 instances per frame.
  - Memory: an `864 × 960` RGBA8 atlas pair on desktop (about `9` MB with mips), `576 × 640` on mobile (about `4` MB); a `768 × 256` shadow atlas (about `2` MB); two `R8` coverage maps (`1024²` desktop, `512²` mobile). The former lower-hemisphere grid took about `42` MB on desktop and `19` MB on mobile.
  - Receivers: one extra texture tap within the shadow disk.
  - Real-GPU frame time has not been measured.
- **Options:**
  - Per-chunk clouds in the worker were rejected: clouds are few and large and must stay visible beyond the scenery range, and per-chunk impostor meshes would add a draw call per chunk.
  - Adding the clouds to the existing shadow cascades was rejected: their `450`-unit fade would cut cloud shadows off near the airplane, and depth cascades need many PCF taps. Clouds float above every receiver, so a blurred coverage map needs one tap.
  - A full-sphere atlas was rejected, and then the lower-hemisphere grid too: clouds face the airplane, so a frontal band of 30 views per type replaces 144 at the same frame resolution, about four times less memory. Only the shadow caster needs other sides (the light can come from any side), so it reads its own small lower-hemisphere coverage atlas. It can look from below because an orthographic silhouette is the same from both ends of the light ray.
- **Acceptance criteria:**
  - Met so far:
    - no shader errors on the desktop and 390 px mobile paths in headless Chrome (Metal);
    - the look matches the reference: two-slab carved-wood shapes, horizontal grain, front faces turned toward the airplane (also after turns), warm at sunset and dark without glow at night;
    - the LOD 0, LOD 1, and impostor bands hand over without visible mismatch (wireframe overlay);
    - cloud shadows appear on terrain, offset away from the sun, also with the scenery shadows disabled;
    - pure tests pass.
  - Remaining:
    - art-direction tuning of density, sizes, and the ambient boost;
    - the airplane does not receive cloud (or scenery) shadows;
    - real mobile devices;
    - frame-time and overdraw measurement against `OBS-001`.
- **Documentation:** [Terrain](TERRAIN.md#clouds), [Rendering](RENDERING.md#clouds), [Architecture](ARCHITECTURE.md), [Assets](ASSETS.md), [Experience](EXPERIENCE.md), [Quality](QUALITY.md), `AGENTS.md`.

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
