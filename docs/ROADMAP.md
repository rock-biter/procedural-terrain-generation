# Technical Roadmap And Work Register

## Purpose

This is the living register for technical debt, performance work, architectural decisions, and future features. It records why work is needed before prescribing an implementation.

The first analysis focuses on terrain generation and streaming because they dominate current startup and traversal cost. Current behavior remains documented in [Terrain](TERRAIN.md), [Architecture](ARCHITECTURE.md), and [Rendering](RENDERING.md). Validation rules remain in [Quality](QUALITY.md).

Last baseline review: **2026-09-26**. The full-project review of **2026-10-02** ([Project Review](reviews/2026-10-02-project-review.md)) lists its findings by area, a phased plan, and which items are done; promote an item into this register when it becomes part of a milestone.

Current implementation scope: `WORLD_FEATURES` enables scenery (trees, cacti, and rocks as octahedral impostors, `FEAT-003`, replaced by real meshes near the eye, `FEAT-004`) and clouds (a world-level field with the same impostor treatment and their own shadows, `FEAT-006`), and still disables boats. The dormant boat implementation remains for later reintroduction; the historical cost analysis of the former per-chunk clouds stays in this document for reference.

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
World.tic() (src/world.js)
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

The removed tree path used detail `5`: 720 triangles and 2,160 vertices per tree. Scenery impostors now cost 4 vertices and 2 triangles per instance; near the eye, `FEAT-004` draws the real source meshes instead, in two levels of detail (264 to 876 triangles per type at LOD 0, 78 to 364 at LOD 1). They share one baked atlas of about `57` MB on desktop and mobile (albedo, normal, and the paint mask of trees and cacti; `43` MB before the sea rock's column), and each chunk adds a quad plus 32 bytes per instance.

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
| `TEST-001`  | P1       | In progress | Streaming and generation rules need broader automated regression coverage.              | Node tests now cover policy, deterministic buffers, topology, sea clamp, and edge continuity, and since 2026-10-04 the reconcile state machine end to end (fake workers running the real job: streaming, disposal across borders, stale results, retries) and the worker pool's restarts. GPU upload and rendering remain browser-only. |
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
| `LOAD-002`  | P3       | Reliability         | Resolved for the one critical asset (2026-10-04): an airplane failure shows an error with Retry, which reloads the whole page; the other assets degrade without a message. |
| `ASSET-001` | P1       | Licensing           | Soundtrack and texture provenance are not recorded in dedicated license metadata.                  |
| `QUAL-001`  | P1       | Quality             | There is no type checking or browser automation in CI. ESLint, Prettier, and a GitHub Actions workflow (lint, format, test, build) exist since 2026-10-04; `pnpm bench --shots` compares builds visually, but only locally. |

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

The features below are implemented; their behavior, parameters, and costs live in the owning guides. What stays here is what the guides do not hold: the alternatives that were rejected and the work still open. Each feature's frame-time acceptance depends on `OBS-001`, and none has been validated on real mobile devices yet.

| ID         | Feature                                                         | Status      | Owning guide                                                                                   |
| ---------- | --------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `FEAT-001` | Post-processing pipeline and speed effect                       | In progress | [Rendering](RENDERING.md#post-processing-pipeline)                                             |
| `FEAT-002` | Day/night cycle                                                 | In progress | [Rendering](RENDERING.md#daynight-cycle)                                                       |
| `FEAT-003` | Biome scenery with octahedral impostors                         | In progress | [Terrain](TERRAIN.md#per-chunk-scenery), [Rendering](RENDERING.md#impostor-scenery)            |
| `FEAT-004` | Near scenery meshes                                             | In progress | [Rendering](RENDERING.md#near-scenery-meshes)                                                  |
| `FEAT-005` | Soft scenery shadows                                            | In progress | [Rendering](RENDERING.md#scenery-shadows)                                                      |
| `FEAT-006` | Carved-wood clouds with impostors and cloud shadows             | In progress | [Terrain](TERRAIN.md#clouds), [Rendering](RENDERING.md#clouds)                                 |

### `FEAT-001`: Post-Processing Pipeline And Speed Effect

- **Rejected:** hardware mipmap blur (box-filtered mips look blocky); one blurred image mixed with the sharp one (ghosts). The pyramid with B-spline sampling gives a variable radius at low cost; its downsample moved from the 13-tap Jimenez filter to a 5-tap dual filter (about 60% fewer reads).
- **MSAA:** measured at 2560×1600 on an Apple M1, the composer alone cost about +6 ms with 4x MSAA, +3–4 ms with 2x, and +0.5 ms without; blur and aberration add 1–2 ms. Hence 2x. Skipping the MSAA depth resolve gave nothing measurable. Untried: rendering to the MSAA canvas and copying only while active, or SMAA with an unsampled composer (about −5 ms, different antialiasing in the sharp center).
- **Open:** mobile validation and a baseline frame-time measurement.

### `FEAT-002`: Day/Night Cycle

- **Rejected:** the Three.js `Sky` addon (physically based, less stylized) and flat background colors (no celestial bodies), in favor of palette interpolation with a gradient dome.
- **Open:** art-direction tuning of the palettes under ACES Filmic (default since 2026-10-03; it darkens the night, which the night exposure of `1.3` only partly offsets); airplane lights (a first sprite version was removed); curved lighting for the boats when they return.

### `FEAT-003`: Biome Scenery With Octahedral Impostors

- **Rejected:** real instanced meshes for every instance (too many instances; `FEAT-004` uses them near the eye only) and loaded `.glb` models (sources stay procedural). An `8 × 8` view grid used about `17` MB but ghosted between its 13–26° frames; desktop used `16 × 16` (about `67` MB) until the near meshes took over the close range.
- **Open:** density, scale (cacti read small), and palette tuning; steep-slope clipping (the baked depth could drive a `gl_FragDepth` correction); overdraw measurement.

### `FEAT-004`: Near Scenery Meshes

- **Rejected:** a per-chunk mesh draw without CPU selection (transforms every near instance, even collapsed ones), an alpha-blended cross-fade (sorting and double draws), and a temporal dither (flickers without TAA).
- **Measured** on an Apple M1 at `1280 × 800` on a paused forest view: 48 mesh instances, about 10,300 triangles, six draws, selection at most `0.1` ms; LOD 0 everywhere about 18,900 triangles.
- **Open:** a mobile run with scenery inside the band, weaker GPUs, and an art review of the band distances at boost.

### `FEAT-005`: Soft Scenery Shadows

- **Rejected:** `renderer.shadowMap` (no cascades or distance fade, and every patched material would need custom depth materials), real meshes as near casters (a CPU selection outside the frustum), and blob decals (no shape, z-fighting on slopes).
- **Measured:** the constant PCF kernel (2026-10-03) saved about `0.5` ms per frame at `3840 × 2160` on an Apple M1; the simplified airplane caster (2026-10-04) cut the frame's triangles from about `0.99` M to `0.81` M.
- **Open:** a shimmer review on long flights; the airplane receives no shadows.

### `FEAT-006`: Carved-Wood Clouds With Impostors And Cloud Shadows

- **Rejected:** per-chunk clouds in the worker (clouds are few, large, and must stay visible beyond the scenery range); clouds in the scenery cascades (their `450`-unit fade would cut cloud shadows near the airplane, and depth cascades need many taps, while a coverage map needs one); a full-sphere atlas and then the lower-hemisphere grid (a frontal band of 30 views replaces 144, about four times less memory; only the shadow caster keeps a small lower-hemisphere coverage atlas).
- **Open:** tuning of density, sizes, and the ambient boost.

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
