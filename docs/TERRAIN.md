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

For every terrain vertex, `generateChunkGeometryData()` stores the raw height in the custom `height` buffer and clamps visible Y to at least `-1`. It also computes normals using the same Three.js plane topology as the former main-thread path. Shaders use the raw attribute for effects and coloring, so do not remove it.

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

The worker pool removes height sampling and normal computation from the rendering thread. Main-thread geometry wrapping, GPU upload, scene insertion, disposal, and dormant scenery generation remain synchronous and require profiling.

## Level Of Detail

LOD is distance-based:

```text
LOD = floor(distanceInChunks * 0.7)
segments = max(floor(size * 0.5 ** LOD), density) / density
```

The density divisor is `2` on desktop and `4` on mobile. An LOD job generates a complete replacement buffer set in a worker. `Chunk.replaceGeometry()` then disposes the previous geometry and installs the result on the main thread.

The manager does not enqueue an LOD job when the target matches the live chunk. Any new LOD rule must preserve this guard and keep neighboring chunk edges compatible enough to avoid obvious cracks.

## Per-Chunk Scenery

`main.js` currently passes `worldFeatures` with `trees`, `clouds`, and `boats` all set to `false`. Workers generate terrain only, and `Chunk.updateScenery()` performs no work. The scenery implementations remain available behind those flags for later isolated work.

### Trees

- When enabled, trees are generated when a chunk has no tree mesh and its LOD is `2` or lower.
- Candidate spacing is `5` units on desktop and `8` on mobile.
- Placement combines terrain height, two noise frequencies, and a random threshold.
- Valid tree heights are greater than `4` and less than `42`.
- Positions are passed to the `Trees` instanced mesh in chunk-local coordinates.

### Clouds

- When enabled, clouds are generated once per chunk and passed to a `Clouds` instanced mesh.
- The current candidate loop samples every integer position across the chunk. It computes a mobile/desktop `density` value but does not use it.
- Placement combines two noise frequencies with a random threshold and stores cloud positions around Y `100`.

### Boats

- When enabled, each chunk attempts to place between zero and three boats.
- Each boat gets at most `20` random placement attempts.
- Accepted terrain height must be between `-10` and `-2`.
- The loaded boat model is cloned, randomly rotated, positioned at Y `0.8`, and given the boat vertex-shader replacement.

Tree, cloud, and boat placement includes `Math.random()`, so re-enabling decoration would not be reproducible between sessions even if terrain noise were later seeded.

## Resource Lifecycle

`Chunk.dispose()` removes the chunk from its parent, disposes terrain geometry and the tree instanced mesh, and removes boat clones. Review all owned GPU resources when adding new per-chunk content.

`createCloudsMesh()` disposes an existing cloud mesh before replacing it, but the main `Chunk.dispose()` path does not explicitly dispose that mesh. It also does not dispose shared materials or cloned boat resources. Record and test ownership before changing disposal; shared resources must not be destroyed while another chunk still uses them.

## Invariants For Changes

- Sample noise in world coordinates so adjacent chunks share edge heights.
- Keep the raw `height` buffer attribute available to terrain shaders.
- Dispose replaced geometries.
- Keep expensive creation and LOD work bounded per frame.
- Test negative world coordinates because chunk indexing uses `Math.floor()`.
- Validate desktop and narrow/mobile paths because density and streaming radius differ.
- Check terrain, trees, clouds, and boats after changing height bands.
- Treat changes to `params.octaves` as changes to both the height loop and the number of available noise functions.

## Open Questions

- Should a generated terrain seed be persisted or shown to the user when no URL seed is supplied?
- What frame-time budget should govern queue throughput and chunk radius?
- Should chunk resources be pooled rather than recreated after disposal?
- Should clouds and decorations have independent LOD policies?
- How should visible seams and normal discontinuities be measured?
