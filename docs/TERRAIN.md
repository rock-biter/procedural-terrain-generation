# Terrain And World Streaming

## Purpose

This document describes procedural height generation, terrain geometry, chunk streaming, LOD, and per-chunk scenery. The primary sources are [`src/chunk.js`](../src/chunk.js) and [`src/chunkManager.js`](../src/chunkManager.js).

## Coordinate Model

- A chunk is a `256` by `256` unit plane by default; `main.js` passes this size to `ChunkManager`.
- Chunk keys use the string form `i|j`.
- The current chunk coordinate is `floor(position.x / chunkSize), floor(position.z / chunkSize)`.
- `ChunkManager` currently receives the moving `Plane` as its tracked object even though the field and helper names refer to a camera.
- A chunk at grid coordinate `(i, j)` is centered at `((i + 0.5) * size, 0, (j + 0.5) * size)`.
- Terrain vertices stay local to the chunk mesh. Height sampling adds the chunk's world position before evaluating noise.

Keep CPU sampling, chunk placement, instance placement, and shader world coordinates aligned when changing this model.

## Height Generation

`getHeight(x, z, noises, params, biomeOffset)` in [`src/chunkGeometry.js`](../src/chunkGeometry.js) is the shared CPU height function. `biomeOffset` is the seeded offset from `createBiomeOffset(seed)`; every caller must pass the same one the shader uses as `uBiomeOffset`.

1. For every configured octave, sample simplex noise using `frequency`, `lacunarity`, and world coordinates.
2. Square each sample and scale it by `amplitude * persistance ** octave`.
3. Add a lower-frequency landmass term blended through Three.js `smoothstep` and `lerp` helpers.

### Biome Topography

The desert is lower and softer than the temperate biome, while the large-scale shape of the world stays the same:

- Octave `0` and the landmass term are shared by both biomes, so continents and the big hills keep their layout.
- **Detail:** the detail octaves (`1` and above) are summed twice. The temperate sum is unchanged. The desert sum multiplies their frequency by `params.desert.frequency` (`0.5`, broader forms) and their amplitude by `params.desert.amplitude` (`0.45`). `getDesertWeight()` mixes them with `1 - smoothstep(biomeValue, -blend, blend)`, with `blend` from `params.desert.blend` (`0.08`). The weight uses the same `getBiomeValue()` as the color border, so the change in relief follows it.
- **Height reduction:** `getDesertFlattening()` removes a share of the land height that grows with the distance into the desert, measured in biome-noise value: `flatten * smoothstep(-biomeValue, 0, depth)`. It is `0` at the border and reaches `params.desert.flatten` (`0.5`, half the height) once the value is `params.desert.depth` (`0.4`) below it. Only positive heights are scaled, so coastlines and sea depth do not change; the slope bends slightly at the shoreline.
- Heights are mixed rather than frequencies: interpolating the frequency would compress the noise into artificial ripples across the transition. Each detail sum is only evaluated where its weight is non-zero, so away from the border one set of detail octaves is computed.
- Temperate terrain away from the border is unchanged. Desert height bands, and so their colors, become broader because they follow the height.
- Defaults live in `DESERT_TERRAIN_DEFAULTS`; `main.js` copies them into `params.desert`, and `ChunkManager` snapshots them into every worker request. The **Terrain > Desert topography** GUI edits them and regenerates the chunks when a control is released.
- **Cost:** each height sample also evaluates the biome field (three `snoise` calls). In Node, a LOD `0` chunk at density `1` went from about `86` to `130`–`140` ms. The work runs in the workers.

`ChunkManager` and each worker create one `simplex-noise` function per octave using Alea and the same world seed, and never fewer than two, because the landmass always reads noises `0` and `1` (`createTerrainNoises()`); a single octave therefore keeps the same landmass. Pass `?seed=<value>` for a reproducible world; without it, `main.js` creates a random eight-character base-36 seed (`createRandomSeed()` in [`src/worldSeed.js`](../src/worldSeed.js)). One seed drives topology (`seed:octave` noises), biomes (`seed:biome` offset), scenery placement, and the cloud field. Each worker caches its noise functions until the seed or octave count changes.

With `?gui=1`, the **World** folder shows the current seed and changes it at runtime. Text is trimmed, and a blank value restores the current seed. **Random seed** picks a new one. The address bar is not updated. `ChunkManager.setSeed()` then:
- rebuilds the noises and the biome offset;
- writes `uBiomeOffset` in place;
- regenerates every desired chunk, terrain and scenery, through the same revisioned path as a parameter change, so in-flight results for the old seed are discarded.

`main.js` also calls `Clouds.setSeed()`, which re-places the cloud field on the next frame. It then lifts the airplane to the spawn floor (`max(height, 0) + 60`) if the new ground is above it and resets its smoothed terrain corridor. While chunks regenerate, the new biome colors briefly shade the old geometry, because `uBiomeOffset` is global. Entering the original seed again reproduces the original world.

`main.js` also gives `Plane` a sampler backed by this same seeded `getHeight()` path, with `chunkManager.biomeOffset`. Flight safety therefore reads terrain in world coordinates and agrees with the generated chunks without synchronously creating geometry.

For every terrain vertex, `generateChunkGeometryData()` stores the raw height in the custom `height` buffer and clamps visible Y to at least `-1`. Shaders use the raw attribute for effects and coloring, so do not remove it.

Normals come from the height function, not from mesh triangles. `getSurfaceNormal()` takes central differences of the clamped surface height `max(getHeight(), -1)` at `±NORMAL_EPSILON` (`1` world unit) along X and Z. The step is a fixed world-space constant, independent of LOD and density, so a vertex shared by neighboring chunks gets the same normal even when the chunks have different LODs, and chunk borders show no lighting seams. Each vertex costs four extra `getHeight()` calls. Keep the epsilon fixed; do not derive it from grid spacing.

The worker transfers position, normal, UV, height, and index buffers. The main thread wraps them in `BufferGeometry`; it does not resample heights or recompute normals.

## Chunk Lifecycle

`ChunkManager.updateChunks()` drives streaming:

- [`src/chunkPolicy.js`](../src/chunkPolicy.js) computes a desired set biased toward the flight direction. `CHUNK_STREAMING` sets its shape in chunks:

  | Setting        | Desktop | Mobile | Meaning                                                  |
  | -------------- | ------: | -----: | -------------------------------------------------------- |
  | `maxDistance`  |     `6` |    `5` | Reach to the sides and beyond the look-ahead segment.    |
  | `lookAhead`    |     `2` |    `1` | Length of the segment ahead of the current chunk center. |
  | `rearDistance` |     `3` |  `2.5` | Reach straight behind; the rear is a half ellipse.        |

  Ahead of the current chunk, a coordinate is desired when its distance to the segment from the chunk center to `lookAhead` chunks along the heading is at most `maxDistance`. Behind it, the set is a half ellipse with semi-axes `rearDistance` (behind) and `maxDistance` (sideways), so the outline stays continuous at the sides. Heading north, this gives `110` coordinates on desktop and `73` on mobile; diagonal headings give slightly different counts.
- The heading is the tracked Plane's world +Z axis, projected on XZ and quantized by `getHeadingSector()` into `8` sectors of 45°. The sector changes only when the heading passes a boundary by more than `0.15` sector (about 7°), so small oscillations do not rebuild the set. A vertical heading keeps the previous sector.
- Entering a new chunk or a new heading sector increments the desired-set revision and diffs every live chunk against the new set.
- Out-of-range chunks are immediately disposed and deleted from the live `Map`; pending jobs outside the set are deleted as well.
- Missing chunks and changed LODs become keyed jobs in a pending `Map`, so each coordinate has at most one queued operation.
- Jobs carry key, desired-set revision, LOD, scenery range, seed, biome offset, and a snapshot of terrain parameters (including `desert`). Workers echo key and the revision the job was dispatched with; mismatched or obsolete responses are discarded before `BufferGeometry` allocation.
- On a reconcile, an in-flight job from the previous revision is adopted when it still produces exactly what the new target asks for: a `create` or `updateLOD` with the same LOD and scenery range, or a `regenerate` or `scenery` job on a chunk whose LOD is unchanged. Its revision moves to the new one and its result is committed. Other in-flight results become stale. Jobs from before a parameter or scenery change are never adopted.
- A `regenerate` job, queued or in flight, is queued again after a reconcile, so a parameter change is not lost when the plane crosses a chunk or turns.
- While the tracked position remains in the same chunk, the manager processes up to three jobs per frame on desktop or two on mobile. Near LOD 0/1 work remains limited to one job in that frame.
- Pending jobs are sorted by `priority`, the LOD distance described below, so chunks ahead run before chunks equally far behind.
- Generation is bounded by a pool of up to two workers on desktop and one on mobile. Only one request per chunk key may be in flight.
- A new `Chunk` is added directly to the scene and registered in the live `Map`.

`ChunkManager.getStats()` additionally reports queued/in-flight work, generated/stale/failed results, worker count, the current `headingSector`, and seed. The browser exposes it through `window.__INFINITE_WORLD__.getChunkStats()`.

The worker pool removes height sampling and normal computation from the rendering thread. Scenery placement also runs in the worker. Main-thread geometry wrapping, GPU upload, scene insertion, and disposal remain synchronous and require profiling.

## Level Of Detail

LOD is distance-based, but the distance is measured to the look-ahead segment instead of to the current chunk:

```text
along       = offset · heading
lodDistance = distance(offset, heading * clamp(along, 0, lookAhead))
LOD         = floor(lodDistance * 0.7)
segments    = max(floor(size * 0.5 ** LOD), density) / density
```

Offsets are in chunks from the current chunk. Straight ahead, the LOD rings move forward by `lookAhead` chunks: on desktop, LOD `0` reaches three chunks ahead, so LOD seams stay far from a plane flying high. Behind and beside the current chunk, `lodDistance` is the plain radial distance and the rings are unchanged. Desktop can reach LOD `4` (`8` segments); mobile stops at LOD `3`.

A heading change can change the LOD of many chunks at once: in a continuous desktop turn, each new sector re-generates about 40 to 60 chunks, mostly as `updateLOD` jobs.

The density divisor is `2` on desktop and `4` on mobile. An LOD job generates a complete replacement buffer set in a worker. `Chunk.replaceGeometry()` then disposes the previous geometry and installs the result on the main thread.

The manager does not enqueue an LOD job when the target matches the live chunk. Any new LOD rule must preserve this guard and keep neighboring chunk edges compatible enough to avoid obvious cracks.

## Per-Chunk Scenery

`main.js` passes `worldFeatures` with `scenery` and `clouds` set to `true` and `boats` set to `false`. Scenery means trees, cacti, and rocks. Each one is drawn as an octahedral impostor, and as its real mesh near the eye; the rendering side is in [Rendering](RENDERING.md#impostor-scenery) and [Near Scenery Meshes](RENDERING.md#near-scenery-meshes). Clouds are not per-chunk content: they form a world-level field (see [Clouds](#clouds)). Boats keep their dormant implementation behind their flag.

### Biome Field

[`src/biome.js`](../src/biome.js) is the CPU twin of the GLSL `getBiomeValue()` in `common.glsl`, which `color-fragment.glsl` uses to select biomes.

- It ports the GLSL Ashima `snoise` exactly, using a floor-based `mod`, and applies the same three-frequency formula.
- `createBiomeOffset(seed)` derives a seeded world offset in `±10000`. `main.js` passes that offset to the shader as `uBiomeOffset`, and `ChunkManager` passes it to workers in both the terrain and the scenery part of each request, so the seed moves biomes and their topography.
- A negative value is desert and a non-negative value is temperate.
- In a headless SwiftShader comparison over 16,384 points, JS and GLSL differed by at most `8e-6`, with no sign mismatch.
- Placement skips candidates within `BIOME_BORDER_MARGIN` (`0.04`) of the border.

### Placement

[`src/sceneryPlacement.js`](../src/sceneryPlacement.js) runs in the chunk worker.

- **Settings:** each placement request carries a snapshot of `params.scenery`, created by `createScenerySettings()`. The **Scenery** debug folder edits it (see [Scenery Settings](#scenery-settings)). Cells align to chunk borders, so every candidate belongs to exactly one chunk: neighbours never duplicate or miss instances.
- **Grid:** a jittered world-space grid whose cell size is `settings.cellSize`: `4` units on desktop and `8` on mobile by default, and it must divide the chunk size. Cells align to chunk borders, so every candidate belongs to exactly one chunk: neighbours never duplicate or miss instances.
- **Randomness:** each cell draws its values from a stateless integer hash of the seed and the cell coordinates. The result does not depend on generation order or LOD, and revisiting a coordinate reproduces the same instances.
- **Rejected candidates:** a candidate is skipped when any of these hold:
  - it is on water or beach (height `< 1.8`);
  - it is on snow (the same wobble formula as the shader snow line);
  - it is within the biome-border margin;
  - it fails the density test;
  - the surface normal's Y is below `0.8` (temperate) or `0.75` (desert).
- **Types:** each candidate first draws its type from a weighted table in `SCENERY_CONFIG`:
  - temperate grass band: round trees, some conifers and boulders;
  - temperate land band (`≥ 14`): mostly conifers;
  - temperate rock band (`≥ 22`): conifers and boulders;
  - desert: one-arm and two-arm cacti, boulders, and layered rocks.

  Scale, vertical stretch, yaw, and tint vary per instance. Boulders are grey in temperate areas and sandy in the desert.
- **Density:** the candidate is then accepted with probability `baseDensity × settings.density[category]`. `baseDensity` follows a low-frequency cluster noise in temperate areas (maximum `0.55` per cell), which produces woods and clearings, and is a flat `0.16` in the desert. Type and acceptance use independent random values, so changing one category's density adds or removes only that category.
- **Size:** `settings.size[typeKey]` multiplies the instance scale drawn from the `SCENERY_CONFIG` range.
- **Height:** the base sits at the exact `getHeight()` value minus `0.35 × scale`, so it does not float where coarse terrain LODs cut below the true surface.
- **Cap:** when a chunk has more than `settings.maxPerChunk` instances (default `1000`), it keeps those with the lowest per-cell random priority. The subset is deterministic and spatially uniform.
- **Output:** a transferable `Float32Array` with `IMPOSTOR_INSTANCE_STRIDE = 8` floats per instance: chunk-local `x, y, z`, scale, yaw, type, packed RGB tint, stretch.

With the default settings, placement costs about `1.35` ms per chunk on desktop and `0.32` ms on mobile in Node. Instance counts reach about 550 and 120 per land chunk.

### Scenery LOD And Jobs

- Scenery range is radial and does not follow the forward LOD shift: `hasSceneryAtDistance()` keeps scenery on chunks whose radial LOD, `floor(distance * 0.7)`, is at most `SCENERY_MAX_LOD` (`2`). Impostors shrink into the fog by `950` units whatever the heading, so scenery farther ahead would never be visible. Each desired target carries this result as `scenery`.
- `needsSceneryPlacement()` in `chunkPolicy.js` asks the worker for placement on every `create`, `regenerate`, and `scenery` job within range, and on any job flagged `refreshScenery`. An ordinary `updateLOD` job requests it only when the chunk has none.
- When a live chunk enters the range without a LOD change, the reconcile queues a `scenery` job for it. When it leaves the range without a LOD change, the reconcile clears its scenery directly on the main thread.
- A `scenery` job sends `terrain: false`: the worker skips terrain generation and returns only instances, and the manager replaces the chunk's scenery without touching its geometry. Scenery jobs do not count toward the one-near-job-per-frame limit.
- When a committed job's target is outside the range, the scenery is cleared. It is regenerated identically when the chunk comes back into range.
- `getStats()` reports `sceneryChunks` and `sceneryInstances`.

### Scenery Settings

`params.scenery` holds:

- `cellSize`, one of `SCENERY_CELL_SIZES` (`4`, `8`, `16`, or `32`); the default is `8` on desktop and `16` on mobile;
- `maxPerChunk`, default `1000`;
- density multipliers, with defaults `density.trees = 0.39`, `density.cacti = 0.2`, and `density.rocks = 0.65`;
- size multipliers, copied from the `SCENERY_DEFAULT_SIZES` configuration object:
  - `roundTree`: `1.35`;
  - `conifer`: `1.7`;
  - `cactusOneArm`: `1.29`;
  - `cactusTwoArms`: `1.68`;
  - `boulder`: `0.6`;
  - `layeredRock`: `0.48`.

Edit `SCENERY_DEFAULT_SIZES` and `createScenerySettings()` in `src/sceneryPlacement.js` to change the starting values. The GUI changes only the current session.

`SCENERY_CATEGORIES` maps each type to its category.

`ChunkManager.onSceneryChange()` applies a change:

- It increments the revision.
- Queued and in-flight jobs are queued again with `refreshScenery`.
- Missing chunks get `create` jobs, and other live chunks in scenery range get `scenery` jobs.
- Terrain is never regenerated.

`reconcileChunks()` keeps pending or in-flight scenery refreshes across a chunk-boundary crossing or heading change, so a change made just before it is not lost. A cell of `4` gives 4,096 candidates per chunk, four times as many as the desktop default of `8`; measure before using it on mobile.

### Boats (Dormant)

- When enabled, each chunk attempts to place between zero and three boats.
- Each boat gets at most `20` random placement attempts.
- Accepted terrain height must be between `-10` and `-2`.
- The loaded boat model is cloned, randomly rotated, positioned at Y `0.8`, and given the boat vertex-shader replacement.

Boat placement still uses `Math.random()`, so re-enabling boats would not be reproducible between sessions.

## Clouds

Clouds are a world-level field around the airplane, independent of terrain chunks, LOD, and workers. [`src/clouds.js`](../src/clouds.js) owns it; [`src/cloudPlacement.js`](../src/cloudPlacement.js) holds the pure, deterministic placement. The rendering side (impostors, near meshes, shadows) is in [Rendering](RENDERING.md#clouds).

- **Grid:** a jittered world-space grid of `CLOUD_CONFIG.cellSize` (`160`) units. Each cell holds at most one cloud, whose base stays at least `12%` of a cell from the cell edges. The grid is the same on every device, so desktop and mobile see the same sky.
- **Randomness:** every value comes from `cellRandom()` (exported by `sceneryPlacement.js`) over the seed hash and the cell. A cell's cloud never depends on the field center, so the field can be rebuilt anywhere and every cloud stays where it was.
- **Coverage:** a low-frequency `snoise()` field (wavelength `coverageScale`, `1400` units) splits the sky into cloudy and clear patches with a soft edge. The local coverage is the share of cloudy sky: `0` is clear everywhere, `1` cloudy everywhere. A cell holds a cloud with probability `local density × cloudiness`.
- **Regional variation:** `getCloudRegion()` modulates density, coverage, and size at each candidate's position with three independent low-frequency noise fields (two `snoise()` octaves each, wavelength `settings.regional.scale`, `4000` units by default). Regions therefore hold packed or scattered, large or small clouds, and the sky changes character gradually over a few thousand units of flight. The local density is `density × (1 ± regional.density)` (`0.6`), the local coverage `coverage ± regional.coverage` (`0.3`), both clamped to `[0, 1]`, and the size multiplier `2^(± regional.size)` (`0.5` stops). The fields are continuous, so neighbouring clouds stay alike, and they are sampled at the world position, so the field center never changes them. At amplitude `0` a setting is uniform. Altitude and field radius never vary. Over many `800`-unit windows, the cloud count spans about `3`–`52` (instead of `17`–`40` without the fields) and the mean scale about `0.87`–`1.53` (instead of `1.02`–`1.21`), with the same averages.
- **Seed offsets:** `getCloudFieldOffsets(seed)` gives the coverage field and each regional field its own seeded offset, so every seed has its own sky.
- **Types and size:** each cloud draws a type (`BANK` `0.35`, `HEAP` `0.3`, `PUFF` `0.35`), a scale from its `CLOUD_CONFIG.shape` range times `settings.size[typeKey]` and the regional size multiplier, and a vertical stretch.
- **Altitude:** the base (the cloud's flat bottom) lies in `settings.altitude`, Y `197` to `257` by default. The highest eye is about Y `102`: the `95` flight ceiling plus the follow camera's `7`. Terrain peaks measured over several seeds stay below about `95`.
- **Orientation:** placement stores no heading. The shaders turn every cloud about its vertical axis so its front face looks at the airplane (`getFacingYaw()`, see [Rendering](RENDERING.md#clouds)). The yaw slot of the instance layout holds only a dither seed.
- **Neighbours:** `CLOUD_CONFIG.extent` bounds each source model. Because clouds turn, each one's footprint is the circle of radius `hypot(halfWidth, halfDepth) × scale` around its base. A cloud whose footprint and height range overlap those of a raw neighbouring candidate with a lower priority value is dropped. `getCloudNeighbourRing(settings)` sets how many cells to check in each direction: bases `k` cells apart are at least `(k - span) × cellSize` apart, so the ring reaches as far as two of the largest possible footprints (largest type scale × its size setting × the largest regional size factor), and at least one cell. With the default sizes it is `2` cells. The ring depends only on the settings, so the test stays independent of the field center.
- **Output:** `generateCloudInstances()` returns a `Float32Array` in the `IMPOSTOR_INSTANCE_STRIDE` layout with world-space bases, for clouds whose base lies within `settings.radius` (horizontal) of the center.
- **Field:** `Clouds.update(planePosition, camera)` regenerates when the airplane enters a new cloud cell, after `setSeed()`, or after `applySettings()`. It centers the field on the cell center and replaces the single impostor geometry, then selects the near meshes. The radius is `1850` units on desktop and `1100` on mobile (`CLOUD_FIELD_RADIUS`); impostors shrink into the fog over `getCloudFarFade(radius)`, inside it, so clouds never pop at the field edge.
- **Seed:** `applyWorldSeed()` in `main.js` calls `Clouds.setSeed()`, so a GUI seed change also changes the sky.
- **Cost:** about `0.5` ms per rebuild on desktop (about 130 clouds on average) and `0.19` ms on mobile (about 46) in Node after warm-up, once per `160` units of travel.

### Cloud Settings

`params.clouds.placement` (`createCloudSettings()`) holds `radius`, `density` (`0.55`), `coverage` (`0.6`), `altitude` (`min 197`, `range 60`), `size` (`bank 1.69`, `heap 1.04`, `puff 1.14`), and `regional` (`scale 4000`, `density 0.6`, `coverage 0.3`, `size 0.5`). The **Clouds** GUI folder edits them, the regional ones under **Regional variation**, and re-places the field when a control is released. The same folder sets the near-mesh bands, the wood detail (re-bake), the ambient boost, the brightness variation, and the shadows (see [Rendering](RENDERING.md#clouds)).

## Resource Lifecycle

`Chunk.dispose()` removes the chunk from its parent, disposes the terrain geometry, clears the scenery, and removes boat clones. Review all owned GPU resources when adding new per-chunk content.

- `Chunk.setScenery()` builds one `InstancedBufferGeometry` per chunk: a 4-vertex quad plus the instance buffer. The chunk owns it, and `clearScenery()` disposes it. The scenery mesh has one child, the debug wireframe overlay, which shares that geometry and the shared `assets.impostorWireframeMaterial`.
- The impostor material and its atlas textures are shared through `assets.impostorMaterial` and are never disposed by chunks.
- `SceneryMeshes` reads each live chunk's instance array (`chunk.scenery.geometry.attributes.aInstanceA.data.array`) every frame and copies the near instances into its own buffers. It never keeps a reference to a chunk or its arrays across frames, so `clearScenery()` and `dispose()` need no coordination with it.
- `SceneryShadows` points pooled caster proxies at live chunks' scenery geometries. It re-syncs them in every update before rendering any cascade, so proxies of removed chunks are hidden before they could draw. A hidden proxy may still hold a disposed geometry, but it is never rendered and never disposes it.
- `Chunk.dispose()` does not dispose shared materials or cloned boat resources.
- Clouds own no per-chunk resources. `Clouds` disposes its previous impostor geometry on every regeneration, and its atlas, materials, and near meshes in `dispose()`. `CloudShadows` borrows the current impostor geometry for its caster proxy every render and never disposes it.

Record and test ownership before changing disposal; shared resources must not be destroyed while another chunk still uses them.

## Invariants For Changes

- Sample noise in world coordinates so adjacent chunks share edge heights.
- Keep the raw `height` buffer attribute available to terrain shaders.
- Dispose replaced geometries.
- Keep expensive creation and LOD work bounded per frame.
- Test negative world coordinates because chunk indexing uses `Math.floor()`.
- Validate desktop and narrow/mobile paths because density and streaming radius differ.
- Check terrain, scenery, clouds, and boats after changing height bands. Scenery thresholds in `SCENERY_CONFIG` and `isSnow()` mirror `color-fragment.glsl`.
- Keep `getBiomeValue()` in `src/biome.js` identical to `getBiomeValue()` in `common.glsl`, including `uBiomeOffset`. If the formula can grow steeper, raise `BIOME_MAX_GRADIENT` in `color-fragment.glsl`, or the separator can be clipped.
- Treat changes to `params.octaves` as changes to both the height loop and the number of available noise functions; `createTerrainNoises()` keeps at least the two the landmass needs.

## Open Questions

- Should a generated terrain seed be persisted when no URL seed is supplied? It is shown in the `?gui=1` **World** folder but not written to the URL.
- What frame-time budget should govern queue throughput and chunk radius?
- Should chunk resources be pooled rather than recreated after disposal?
- What scenery density and instance scale best match the style references in [`docs/style-references/`](style-references/)?
- How should visible geometric seams (T-junctions between LODs) be measured?
