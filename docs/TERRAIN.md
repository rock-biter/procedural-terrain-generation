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

`getHeight(x, z, noises, params)` in [`src/chunkGeometry.js`](../src/chunkGeometry.js) is the shared CPU height function.

1. For every configured octave, sample simplex noise using `frequency`, `lacunarity`, and world coordinates.
2. Square each sample and scale it by `amplitude * persistance ** octave`.
3. Add a lower-frequency landmass term blended through Three.js `smoothstep` and `lerp` helpers.

`ChunkManager` and each worker create one `simplex-noise` function per octave using Alea and the same world seed. Pass `?seed=<value>` for a reproducible world; without it, `main.js` creates a random per-load seed. Each worker caches its noise functions until the seed or octave count changes.

`main.js` also gives `Plane` a sampler backed by this same seeded `getHeight()` path. Flight safety therefore reads terrain in world coordinates and agrees with the generated chunks without synchronously creating geometry.

For every terrain vertex, `generateChunkGeometryData()` stores the raw height in the custom `height` buffer and clamps visible Y to at least `-1`. Shaders use the raw attribute for effects and coloring, so do not remove it.

Normals come from the height function, not from mesh triangles. `getSurfaceNormal()` takes central differences of the clamped surface height `max(getHeight(), -1)` at `±NORMAL_EPSILON` (`1` world unit) along X and Z. The step is a fixed world-space constant, independent of LOD and density, so a vertex shared by neighboring chunks gets the same normal even when the chunks have different LODs, and chunk borders show no lighting seams. Each vertex costs four extra `getHeight()` calls. Keep the epsilon fixed; do not derive it from grid spacing.

The worker transfers position, normal, UV, height, and index buffers. The main thread wraps them in `BufferGeometry`; it does not resample heights or recompute normals.

## Chunk Lifecycle

`ChunkManager.updateChunks()` drives streaming:

- Desktop keeps chunks within `maxDistance = 5`; mobile uses `4`.
- [`src/chunkPolicy.js`](../src/chunkPolicy.js) computes a symmetric Euclidean desired set: `81` coordinates on desktop and `49` on mobile.
- Entering a new chunk increments the desired-set revision and diffs every live chunk against the new set.
- Out-of-range chunks are immediately disposed and deleted from the live `Map`; pending jobs outside the set are deleted as well.
- Missing chunks and changed LODs become keyed jobs in a pending `Map`, so each coordinate has at most one queued operation.
- Jobs carry key, desired-set revision, LOD, seed, and a snapshot of terrain parameters. Workers echo key and revision; mismatched or obsolete responses are discarded before `BufferGeometry` allocation.
- While the tracked position remains in the same chunk, the manager processes up to three jobs per frame on desktop or two on mobile. Near LOD 0/1 work remains limited to one job in that frame.
- Pending jobs are sorted by distance so nearer work runs first.
- Generation is bounded by a pool of up to two workers on desktop and one on mobile. Only one request per chunk key may be in flight.
- A new `Chunk` is added directly to the scene and registered in the live `Map`.

`ChunkManager.getStats()` additionally reports queued/in-flight work, generated/stale/failed results, worker count, and seed. The browser exposes it through `window.__INFINITE_WORLD__.getChunkStats()`.

The worker pool removes height sampling and normal computation from the rendering thread. Scenery placement also runs in the worker. Main-thread geometry wrapping, GPU upload, scene insertion, and disposal remain synchronous and require profiling.

## Level Of Detail

LOD is distance-based:

```text
LOD = floor(distanceInChunks * 0.7)
segments = max(floor(size * 0.5 ** LOD), density) / density
```

The density divisor is `2` on desktop and `4` on mobile. An LOD job generates a complete replacement buffer set in a worker. `Chunk.replaceGeometry()` then disposes the previous geometry and installs the result on the main thread.

The manager does not enqueue an LOD job when the target matches the live chunk. Any new LOD rule must preserve this guard and keep neighboring chunk edges compatible enough to avoid obvious cracks.

## Per-Chunk Scenery

`main.js` passes `worldFeatures` with `scenery` set to `true` and `clouds` and `boats` set to `false`. Scenery means trees, cacti, and rocks. Each one is drawn as an octahedral impostor; the rendering side is in [Rendering](RENDERING.md#impostor-scenery). Clouds and boats keep their dormant implementations behind their flags.

### Biome Field

[`src/biome.js`](../src/biome.js) is the CPU twin of the biome selector in `color-fragment.glsl`.

- It ports the GLSL Ashima `snoise` exactly, using a floor-based `mod`, and applies the same three-frequency formula.
- `createBiomeOffset(seed)` derives a seeded world offset in `±10000`. `main.js` passes that offset to the shader as `uBiomeOffset`, and `ChunkManager` passes it to workers, so the seed now moves biomes as well.
- A negative value is desert and a non-negative value is temperate.
- In a headless SwiftShader comparison over 16,384 points, JS and GLSL differed by at most `8e-6`, with no sign mismatch.
- Placement skips candidates within `BIOME_BORDER_MARGIN` (`0.04`) of the border.

### Placement

[`src/sceneryPlacement.js`](../src/sceneryPlacement.js) runs in the chunk worker.

- **Settings:** each placement request carries a snapshot of `params.scenery`, created by `createScenerySettings()`. The **Scenery** debug folder edits it (see [Scenery Settings](#scenery-settings)). Cells align to chunk borders, so every candidate belongs to exactly one chunk: neighbours never duplicate or miss instances.
- **Grid:** a jittered world-space grid whose cell size is `settings.cellSize`: `8` units on desktop and `16` on mobile by default, and it must divide the chunk size. Cells align to chunk borders, so every candidate belongs to exactly one chunk: neighbours never duplicate or miss instances.
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
- **Density:** the candidate is then accepted with probability `baseDensity × settings.density[category]`. `baseDensity` follows a low-frequency cluster noise in temperate areas (maximum `0.55` per cell), which produces woods and clearings, and is a flat `0.16` in the desert. Type and acceptance use independent random values, so changing one category's density adds or removes only that category. At the default multipliers of `1` the result matches the original fixed rules.
- **Size:** `settings.size[typeKey]` multiplies the instance scale.
- **Height:** the base sits at the exact `getHeight()` value minus `0.35 × scale`, so it does not float where coarse terrain LODs cut below the true surface.
- **Cap:** when a chunk has more than `settings.maxPerChunk` instances (default `1000`), it keeps those with the lowest per-cell random priority. The subset is deterministic and spatially uniform.
- **Output:** a transferable `Float32Array` with `IMPOSTOR_INSTANCE_STRIDE = 8` floats per instance: chunk-local `x, y, z`, scale, yaw, type, packed RGB tint, stretch.

On desktop, placement costs roughly `0.3` ms per chunk in Node. Instance counts reach about 270 per land chunk.

### Scenery LOD And Jobs

- Only chunks with LOD `≤ SCENERY_MAX_LOD` (`2`) carry scenery. Farther chunks sit inside the fog.
- `needsSceneryPlacement()` in `chunkPolicy.js` asks the worker for placement on every `create`, `regenerate`, and `scenery` job within range, and on any job flagged `refreshScenery`. An ordinary `updateLOD` job requests it only when the chunk has none.
- A `scenery` job sends `terrain: false`: the worker skips terrain generation and returns only instances, and the manager replaces the chunk's scenery without touching its geometry. Scenery jobs do not count toward the one-near-job-per-frame limit.
- When a committed job's LOD leaves the range, the scenery is cleared. It is regenerated identically when the chunk comes back into range.
- `getStats()` reports `sceneryChunks` and `sceneryInstances`.

### Scenery Settings

`params.scenery` holds:

- `cellSize`, one of `SCENERY_CELL_SIZES`: `4`, `8`, `16`, or `32`;
- `maxPerChunk`;
- `density.trees`, `density.cacti`, and `density.rocks`;
- `size.roundTree`, `size.conifer`, `size.cactusOneArm`, `size.cactusTwoArms`, `size.boulder`, and `size.layeredRock`.

`SCENERY_CATEGORIES` maps each type to its category.

`ChunkManager.onSceneryChange()` applies a change:

- It increments the revision.
- Queued and in-flight jobs are queued again with `refreshScenery`.
- Missing chunks get `create` jobs, and other live chunks in scenery range get `scenery` jobs.
- Terrain is never regenerated.

`reconcileChunks()` keeps pending or in-flight scenery refreshes across a chunk-boundary crossing, so a change made just before crossing is not lost. A cell of `4` quadruples candidates (4,096 per chunk) compared with `8`; measure before raising it on mobile.

### Clouds (Dormant)

- When enabled, clouds are generated once per chunk and passed to a `Clouds` instanced mesh.
- The current candidate loop samples every integer position across the chunk. It computes a mobile/desktop `density` value but does not use it.
- Placement combines two noise frequencies with a random threshold and stores cloud positions around Y `100`.

### Boats (Dormant)

- When enabled, each chunk attempts to place between zero and three boats.
- Each boat gets at most `20` random placement attempts.
- Accepted terrain height must be between `-10` and `-2`.
- The loaded boat model is cloned, randomly rotated, positioned at Y `0.8`, and given the boat vertex-shader replacement.

Cloud and boat placement still uses `Math.random()`, so re-enabling them would not be reproducible between sessions.

## Resource Lifecycle

`Chunk.dispose()` removes the chunk from its parent, disposes the terrain geometry, clears the scenery, and removes boat clones. Review all owned GPU resources when adding new per-chunk content.

- `Chunk.setScenery()` builds one `InstancedBufferGeometry` per chunk: a 4-vertex quad plus the instance buffer. The chunk owns it, and `clearScenery()` disposes it.
- The impostor material and its atlas textures are shared through `assets.impostorMaterial` and are never disposed by chunks.
- `createCloudsMesh()` disposes an existing cloud mesh before replacing it, but the main `Chunk.dispose()` path does not explicitly dispose that mesh. It also does not dispose shared materials or cloned boat resources.

Record and test ownership before changing disposal; shared resources must not be destroyed while another chunk still uses them.

## Invariants For Changes

- Sample noise in world coordinates so adjacent chunks share edge heights.
- Keep the raw `height` buffer attribute available to terrain shaders.
- Dispose replaced geometries.
- Keep expensive creation and LOD work bounded per frame.
- Test negative world coordinates because chunk indexing uses `Math.floor()`.
- Validate desktop and narrow/mobile paths because density and streaming radius differ.
- Check terrain, scenery, clouds, and boats after changing height bands. Scenery thresholds in `SCENERY_CONFIG` and `isSnow()` mirror `color-fragment.glsl`.
- Keep `getBiomeValue()` in `src/biome.js` identical to the biome formula in `color-fragment.glsl`, including `uBiomeOffset`.
- Treat changes to `params.octaves` as changes to both the height loop and the number of available noise functions.

## Open Questions

- Should a generated terrain seed be persisted or shown to the user when no URL seed is supplied?
- What frame-time budget should govern queue throughput and chunk radius?
- Should chunk resources be pooled rather than recreated after disposal?
- Should clouds have an LOD policy independent of scenery?
- What scenery density and instance scale best match the style references in `public/style-references/`?
- How should visible geometric seams (T-junctions between LODs) be measured?
