# Technical Roadmap And Work Register

## Purpose

This is the living register for technical debt, performance work, architectural decisions, and future features. It records why work is needed before prescribing an implementation.

The first analysis focuses on terrain generation and streaming because they dominate current startup and traversal cost. Current behavior remains documented in [Terrain](TERRAIN.md), [Architecture](ARCHITECTURE.md), and [Rendering](RENDERING.md). Validation rules remain in [Quality](QUALITY.md).

Last baseline review: **2026-09-26**.

Current implementation scope: `worldFeatures` disables trees, clouds, and boats so streaming work can be repaired and measured against terrain alone. Their implementations and historical cost analysis remain in this document for later reintroduction.

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
     -> on a chunk boundary, build a symmetric desired Map
     -> dispose every live chunk outside the desired set
     -> cancel obsolete work and enqueue one keyed job per coordinate
     -> on later frames, sort pending jobs and dispatch into a bounded pool
            -> chunkGeometry.worker.js
                 -> seeded PlaneGeometry allocation
                 -> getHeight() for every terrain vertex
                 -> computeVertexNormals()
                 -> transfer position/normal/UV/height/index buffers
            -> main thread validates key + revision
                 -> wrap buffers in BufferGeometry
                 -> create Chunk or replace its geometry
                 -> [disabled] trees / clouds / boats
  -> renderer.render()
```

Height sampling and normal computation execute off the main thread. Main-thread commits are still limited by job count rather than elapsed time, and their GPU-upload cost has not been profiled.

## Quantitative Static Baseline

### Assumptions

- Chunk size: `256`.
- Default octaves: `3`.
- `getHeight()` performs exactly five simplex-noise evaluations at the default octave count: one per octave plus two landmass samples.
- Desktop uses `maxDistance = 5`, terrain density divisor `2`, and tree step `5`.
- Mobile uses `maxDistance = 4`, terrain density divisor `4`, and tree step `8`.
- Counts model the symmetric desired-set policy. Keyed pending work prevents duplicate jobs for one coordinate.

### Desired Window At Startup

| Metric                         |                                           Desktop |                               Mobile |
| ------------------------------ | ------------------------------------------------: | -----------------------------------: |
| Desired chunks                 |                                                81 |                                   49 |
| LOD distribution               | 9 at LOD 0, 16 at LOD 1, 36 at LOD 2, 20 at LOD 3 | 9 at LOD 0, 16 at LOD 1, 24 at LOD 2 |
| Terrain vertices               |                                           262,353 |                               62,385 |
| Terrain triangles              |                                           509,952 |                              118,784 |
| Terrain noise evaluations      |                                         1,311,765 |                              311,925 |
| Tree-generating chunks         |                                                61 |                                   49 |
| Tree candidates                |                                           164,944 |                               50,176 |
| Tree-related noise evaluations |                                         1,154,608 |                              351,232 |
| Cloud candidates               |                                         5,308,416 |                            3,211,264 |
| Cloud noise evaluations        |                                        10,616,832 |                            6,422,528 |

The terrain-only startup performs about **1.31 million** noise evaluations on desktop and **312 thousand** on mobile, now distributed across up to two desktop workers or one mobile worker. With every dormant scenery path enabled, the same window would contain about **13.08 million** desktop and **7.09 million** mobile evaluations before boat placement; scenery remains main-thread work until redesigned.

### Terrain Cost Per Chunk

| LOD | Desktop segments / vertices / triangles | Mobile segments / vertices / triangles |
| --- | --------------------------------------: | -------------------------------------: |
| 0   |                   128 / 16,641 / 32,768 |                     64 / 4,225 / 8,192 |
| 1   |                      64 / 4,225 / 8,192 |                     32 / 1,089 / 2,048 |
| 2   |                      32 / 1,089 / 2,048 |                         16 / 289 / 512 |
| 3   |                          16 / 289 / 512 |                           8 / 81 / 128 |

`computeVertexNormals()` then walks the rebuilt indexed geometry inside the worker. LOD changes still allocate, resample, transfer, and replace complete geometry; the work is asynchronous but not cached.

### Decoration Geometry

Three.js r186 builds `IcosahedronGeometry` as a non-indexed polyhedron with:

```text
triangles = 20 * (detail + 1)^2
vertices = triangles * 3
```

| Type  | Detail | Base triangles | Base vertices | Position + normal + UV bytes |
| ----- | -----: | -------------: | ------------: | ---------------------------: |
| Tree  |      5 |            720 |         2,160 |                       69,120 |
| Cloud |     10 |          2,420 |         7,260 |                      232,320 |

Each chunk creates new copies of these identical base geometries. Instance transforms and colors add more buffers, and GPU vertex work multiplies base geometry by the number of visible instances. Actual instance counts must be measured because placement depends on noise and `Math.random()`.

## Known Problem Register

| ID          | Priority | Status      | Problem                                                                                 | Evidence                                                                                                                                         |
| ----------- | -------- | ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OBS-001`   | P0       | In progress | No repeatable performance baseline or complete streaming telemetry.                     | Read-only chunk counters now exist; frame time, stage duration, and `renderer.info` telemetry remain absent.                                     |
| `STRM-001`  | P0       | Done        | Pending work must be keyed consistently and reject stale operations.                    | One `Map` entry per key plus desired-set revisions prevent duplicate and obsolete jobs.                                                          |
| `STRM-002`  | P0       | Done        | Desired-set reconciliation must inspect all live chunks.                                | A pure symmetric desired set is diffed against every live and pending key on each chunk transition.                                              |
| `PERF-001`  | P0       | Observed    | Dormant cloud placement scans all 65,536 integer positions in every chunk at every LOD. | The current feature flag prevents execution; `generateClouds()` still ignores its `density` variable and performs two noise calls per candidate. |
| `LIFE-001`  | P0       | Observed    | Per-chunk GPU resource ownership and disposal are incomplete.                           | `Chunk.dispose()` omits clouds and does not dispose unique tree/cloud geometries.                                                                |
| `PERF-002`  | P1       | In progress | Main-thread commits are limited by job count rather than a frame-time budget.           | Workers handle sampling/normals; buffer wrapping, GPU upload, scene mutation, and future scenery still commit synchronously.                     |
| `PERF-003`  | P1       | In progress | Every LOD transition reallocates and fully recomputes terrain geometry.                 | Workers now perform the computation, but each transition still creates and transfers a complete replacement buffer set.                          |
| `PERF-004`  | P1       | Observed    | Identical tree and cloud base geometries are recreated per chunk.                       | Constructors allocate new `IcosahedronGeometry` instances while materials are shared.                                                            |
| `STATE-001` | P1       | Done        | Chunk registries must delete historical keys and remain bounded.                        | Live and pending state use keyed `Map` instances; disposal deletes entries. Browser traversal kept `created - disposed = live`.                  |
| `CORR-001`  | P1       | Observed    | Tree and cloud candidates are offset by a full chunk instead of half a chunk.           | Generation subtracts `size`; terrain local bounds are centered on `size / 2`.                                                                    |
| `CORR-002`  | P1       | Observed    | Boat world coordinates are assigned as local coordinates on a chunk child.              | `createBoat()` receives world X/Z, sets them on the clone, then adds it to the positioned chunk.                                                 |
| `STATE-002` | P1       | In progress | Runtime terrain-parameter updates remain incomplete.                                    | Parameter changes revision jobs and rebuild seeded noises, but dormant decorations would retain old placement.                                   |
| `DET-001`   | P1       | In progress | Terrain is deterministic but dormant decoration placement is not.                       | `?seed=` drives matching main/worker simplex fields; scenery still uses `Math.random()`.                                                         |
| `TEST-001`  | P1       | In progress | Streaming and generation rules need broader automated regression coverage.              | Node tests now cover policy, deterministic buffers, topology, sea clamp, and edge continuity; cancellation and disposal remain browser-only.     |
| `STRM-003`  | P2       | Observed    | Priority uses distance only and has no hysteresis.                                      | Work is not biased by movement direction, camera visibility, or recent LOD state.                                                                |
| `REND-001`  | P2       | Observed    | Shared material hooks and shared glTF resources have implicit ownership.                | Per-instance constructors overwrite callbacks on module-level or cloned shared materials.                                                        |
| `FRAME-001` | P2       | Observed    | Delta clamping slows traversal during stalls and can hide streaming pressure.           | Movement receives at most `0.016` seconds even when a frame takes longer.                                                                        |
| `LOAD-001`  | P3       | Observed    | Re-enabling trees loads the normal map through two independent paths.                   | The terrain-only runtime uses only `chunk.js`; the guarded tree path in `main.js` uses the loading manager.                                      |
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
- Tree and cloud geometry is unique per chunk but is not explicitly disposed.
- The tree instanced object receives `dispose()`; the cloud instanced object does not during chunk removal.
- Tree and cloud materials are shared module-level resources and must not be disposed per chunk.
- Boat clones share geometry and material references with the template by default. Blindly disposing those resources per clone would break remaining boats and the template.
- Stale work can retain detached chunks and their children after scene removal.

Required direction: write an ownership table in code design, separate shared immutable resources from per-chunk buffers, and dispose only resources with a single owner. Boat resources either remain shared and immutable or must be cloned explicitly with reference-counted disposal.

### `PERF-002` And `PERF-003`: Main-Thread Spikes

The scheduler dispatches one near job or up to three farther jobs, bounded further by one mobile or up to two desktop workers. A near LOD 0 worker job performs 16,641 height samples and normal generation; the main thread still wraps buffers and triggers GPU upload.

LOD transitions avoid recreating existing decorations but still allocate a new `PlaneGeometry`, evaluate heights, compute normals, transfer buffers, and replace the old geometry. There is no height cache or reusable geometry buffer. Running work is not interrupted; obsolete responses are discarded by key and revision.

Required direction: instrument worker duration, transfer delay, main-thread wrapping, GPU upload, and scene commit separately, then adopt a millisecond budget for the remaining main-thread stages.

### `CORR-001` And `CORR-002`: Ownership Coordinates

Tree and cloud loops generate local values in `[-size, -1]`, while a centered terrain chunk spans approximately `[-size / 2, size / 2]`. Their world samples are internally consistent, but most instances are owned by a neighboring spatial region. This complicates culling, streaming edges, and disposal.

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
- The chosen symmetric radius produces 81 desktop and 49 mobile coordinates, unless a different shape is explicitly adopted.
- Repeated create/retire cycles reach a stable renderer-memory plateau.
- Trees, clouds, and boats remain inside their documented ownership region.

### Phase 2: Remove Dominant Waste

Target issues: `PERF-001`, `PERF-002`, `PERF-003`, `PERF-004`.

Tasks:

- Replace per-unit cloud scanning with a sparse deterministic strategy.
- Generate decorations only at LODs where they can contribute visually.
- Share immutable tree and cloud base geometries.
- Lower geometry detail based on measured image quality.
- Split chunk generation into terrain, normals, and decoration stages.
- Schedule work by elapsed milliseconds, priority, and cancellation state.
- Evaluate a bounded height-data cache for adjacent LODs and revisited chunks.

Acceptance criteria:

- Cloud candidates fall by at least 90 percent from 65,536 per chunk, subject to visual approval.
- Only one base geometry per decoration type exists unless variants are justified.
- No scheduled main-thread stage exceeds the agreed frame budget on target devices.
- Visual comparison covers terrain seams, biome bands, trees, clouds, boats, and distance fades.

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
5. How dense must trees and clouds remain to preserve the intended art direction?
6. Is short-term compatibility with the current world appearance more important than a clipmap migration?
7. How much startup latency is acceptable before the play action appears?

## Future Feature Intake

No future feature requirements have been recorded yet. Add each one with this template:

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
