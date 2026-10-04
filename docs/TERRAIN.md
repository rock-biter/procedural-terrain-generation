# Terrain And World Streaming

## Purpose

This document describes procedural height generation, terrain geometry, chunk streaming, LOD, terrain bands, and per-chunk scenery. The primary sources are [`src/chunk.js`](../src/chunk.js), [`src/chunkManager.js`](../src/chunkManager.js), and [`src/terrainBands.js`](../src/terrainBands.js).

## Coordinate Model

- A chunk is a `256` by `256` unit plane (`CHUNK_SIZE` in [`src/worldConstants.js`](../src/worldConstants.js)); `World` passes this size to `ChunkManager`.
- Chunk keys use the string form `i|j`.
- The current chunk coordinate is `floor(position.x / chunkSize), floor(position.z / chunkSize)`.
- `ChunkManager` currently receives the moving `Plane` as its tracked object even though the field and helper names refer to a camera.
- A chunk at grid coordinate `(i, j)` is centered at `((i + 0.5) * size, 0, (j + 0.5) * size)`.
- Terrain vertices stay local to the chunk mesh. Height sampling adds the chunk's world position before evaluating noise.

Keep CPU sampling, chunk placement, instance placement, and shader world coordinates aligned when changing this model.

## Height Generation

`getHeight(x, z, noises, params, biomeOffset)` in [`src/chunkGeometry.js`](../src/chunkGeometry.js) is the shared CPU height function. `biomeOffset` is the seeded offset from `createBiomeOffset(seed)`; every caller must pass the same one the shader uses as `uBiomeOffset`.

The production parameters are `TERRAIN_DEFAULTS` in the same module (amplitude `32`, frequency `0.5` on both axes, `3` octaves, lacunarity `2`, persistance `0.5`, `DESERT_TERRAIN_DEFAULTS`, and `COAST_TERRAIN_DEFAULTS`); `createAppParams()` spreads a mutable copy (`createTerrainSettings()`) into `params`, and the terrain and scenery tests use the same values.

1. For every configured octave, sample simplex noise using `frequency`, `lacunarity`, and world coordinates.
2. Square each sample and scale it by `amplitude * persistance ** octave`.
3. Add a lower-frequency landmass term blended through Three.js `smoothstep` and `lerp` helpers.
4. Add the [coastal relief](#rocky-coast), then apply the desert flattening.

### Biome Topography

The desert is lower and softer than the temperate biome, while the large-scale shape of the world stays the same:

- Octave `0` and the landmass term are shared by both biomes, so continents and the big hills keep their layout.
- **Detail:** the detail octaves (`1` and above) are summed twice. The temperate sum is unchanged. The desert sum multiplies their frequency by `params.desert.frequency` (`0.5`, broader forms) and their amplitude by `params.desert.amplitude` (`0.45`). `getDesertWeight()` mixes them with `1 - smoothstep(biomeValue, -blend, blend)`, with `blend` from `params.desert.blend` (`0.08`). The weight uses the same `getBiomeValue()` as the color border, so the change in relief follows it.
- **Height reduction:** `getDesertFlattening()` removes a share of the land height that grows with the distance into the desert, measured in biome-noise value: `flatten * smoothstep(-biomeValue, 0, depth)`. It is `0` at the border and reaches `params.desert.flatten` (`0.5`, half the height) once the value is `params.desert.depth` (`0.4`) below it. Only positive heights are scaled, so coastlines and sea depth do not change; the slope bends slightly at the shoreline.
- Heights are mixed rather than frequencies: interpolating the frequency would compress the noise into artificial ripples across the transition. Each detail sum is only evaluated where its weight is non-zero, so away from the border one set of detail octaves is computed.
- Temperate terrain away from the border is unchanged. Desert height bands, and so their colors, become broader because they follow the height.
- Defaults live in `DESERT_TERRAIN_DEFAULTS`; `createAppParams()` copies them into `params.desert`, and `ChunkManager` snapshots them into every worker request. The **Terrain > Desert topography** GUI edits them and regenerates the chunks when a control is released.
- **Cost:** each height sample also evaluates the biome field (three `snoise` calls). In Node, a LOD `0` chunk at density `1` went from about `86` to `130`–`140` ms. The work runs in the workers.

### Rocky Coast

Some stretches of coast are rocky: their relief is a little rougher, their sand a little darker, and the sea rocks gather there (see [Placement](#placement)).

- **Mask:** `getCoastRockMask(x, z, biomeOffset, mask)` in [`src/coast.js`](../src/coast.js) is `1` on rocky coast and `0` elsewhere. It sums two simplex layers at the seeded biome coordinates plus a fixed offset (`COAST_ROCK_OFFSET` in [`src/terrainBands.js`](../src/terrainBands.js)): one at `mask.frequency` (`0.003` per unit, rocky stretches a few hundred units long) and one at `mask.detailFrequency` (`0.011`) weighted by `mask.detailWeight` (`0.35`), which frays their outline. It maps the sum through `smoothstep(threshold - softness, threshold + softness)` (`0.15`, `0.25`): a higher threshold leaves less rocky coast, a larger softness a wider transition. The shader twin is `getCoastRockMask()` in [`terrain-bands-pars.glsl`](../src/shaders/terrain-bands-pars.glsl), with the same summation order; it reads the settings from `uCoastRockNoise` and `uCoastRockEdge`, which `updateCoastMaskUniforms()` ([`src/sharedUniforms.js`](../src/sharedUniforms.js)) writes from the same `params.coast.mask`. The shader uses the mask only to darken the sand ([Rendering](RENDERING.md#terrain)); the relief reaches it through the `height` attribute, and placement gathers the [sea rocks](#placement) with it.
- **Relief:** `getCoastRelief()` adds flat-topped mounds: two octaves of `snoise()` at `params.coast.frequency` (`0.07` per unit, features of about 10 to 15 units), mapped through `smoothstep(0, 0.8)`. They are scaled by `params.coast.amplitude` (`1.6` units), the mask, and a height window. The window is `1` from `-5` to `1` and fades to `0` at `-8` and `4` (`COAST_RELIEF_WINDOW`), measured on the height before the relief. The mounds therefore roughen the beach, the first rise of land, and the shallow sea, where the tallest become small sand islets. Away from the window or the mask no extra noise is evaluated.
- **Order:** the relief is never negative, and it is added before the desert flattening, so the desert scales it with the rest of the land. With amplitude `0` heights are exactly the previous ones.
- **Settings:** `COAST_TERRAIN_DEFAULTS` holds `amplitude`, `frequency`, and the mask (`COAST_MASK_DEFAULTS`), copied into `params.coast` and snapshotted into every worker request, mask included. The **Terrain > Coast** GUI edits the relief, and **Terrain > Coast > Rocky coast mask** the mask (**Patch frequency**, **Detail frequency**, **Detail weight**, **Threshold**, **Softness**). Releasing a control regenerates terrain and scenery; a mask change also writes the shader uniforms at once, so the sand follows before the new relief and rocks arrive.
- **Cost:** in Node, a LOD `0` chunk at density `1` on a rocky coast (`seed=rock288`) went from about `154` to `163` ms; chunks without coast in the window evaluate nothing more.

`ChunkManager` and each worker create one `simplex-noise` function per octave using Alea and the same world seed, and never fewer than two, because the landmass always reads noises `0` and `1` (`createTerrainNoises()`); a single octave therefore keeps the same landmass. Pass `?seed=<value>` for a reproducible world; without it, `main.js` creates a random eight-character base-36 seed (`createRandomSeed()` in [`src/worldSeed.js`](../src/worldSeed.js)). One seed drives topology (`seed:octave` noises), biomes (`seed:biome` offset), scenery placement, and the cloud field. Each worker caches its noise functions until the seed or octave count changes.

With `?gui=1`, the **World** folder shows the current seed and changes it at runtime. Text is trimmed, and a blank value restores the current seed. **Random seed** picks a new one. The address bar is not updated. `ChunkManager.setSeed()` then:
- rebuilds the noises and the biome offset;
- writes `uBiomeOffset` in place;
- regenerates every desired chunk, terrain and scenery, through the same revisioned path as a parameter change, so in-flight results for the old seed are discarded.

`World.applyWorldSeed()` also calls `Clouds.setSeed()`, which re-places the cloud field on the next frame. It then lifts the airplane to the spawn floor (`max(height, 0) + 60`) if the new ground is above it and resets its smoothed terrain corridor. While chunks regenerate, the new biome colors briefly shade the old geometry, because `uBiomeOffset` is global. Entering the original seed again reproduces the original world.

`World` also gives `Plane` a sampler backed by this same seeded `getHeight()` path, with `chunkManager.biomeOffset`. Flight safety therefore reads terrain in world coordinates and agrees with the generated chunks without synchronously creating geometry.

For every terrain vertex, `generateChunkGeometryData()` stores the raw height in the custom `height` buffer and clamps visible Y to at least the sea surface, `SEA_SURFACE_Y` (`-1`). Shaders use the raw attribute for effects and coloring, so do not remove it.

Normals come from the height function, not from mesh triangles. `getSurfaceNormal()` takes central differences of the clamped surface height `max(getHeight(), -1)` at `±NORMAL_EPSILON` (`1` world unit) along X and Z. The step is a fixed world-space constant, independent of LOD and density, so a vertex shared by neighboring chunks gets the same normal even when the chunks have different LODs, and chunk borders show no lighting seams. Each vertex costs up to four extra `getHeight()` calls. Where the grid step is exactly `2 × NORMAL_EPSILON` (desktop LOD 0), the `+ε` sample of one vertex is the `-ε` sample of the next one along X and along Z, so `generateChunkGeometryData()` reuses it (about three calls per vertex instead of five, `-50%` per desktop LOD 0 job). A sample is reused only where both world coordinates are exactly equal, so every normal is bit-identical to sampling each vertex on its own. Keep the epsilon fixed; do not derive it from grid spacing.

`generateChunkGeometryData()` builds the grid directly in typed arrays, in the layout of a `PlaneGeometry` rotated flat (row-major, rows along `+Z`, local coordinates rounded to float32), so `src/chunkGeometry.js` and the worker do not load three.js. The worker transfers only position, normal, and height buffers, plus the segment count and a bounding sphere that encloses the grid. Index and uv depend only on the segment count: [`src/chunkTopology.js`](../src/chunkTopology.js) builds them once per LOD (`createChunkIndex()`, `createChunkUv()`) and every chunk at that LOD shares the two attributes. `createChunkGeometry()` wraps the worker buffers without copying, sets the bounding sphere, and frees each per-chunk array after its GPU upload (`onUpload`), since nothing reads terrain vertices on the CPU afterwards. `disposeChunkGeometry()` detaches the shared index and uv before disposing, because disposing a geometry deletes the GL buffers of every attached attribute. The main thread never resamples heights or recomputes normals.

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
- Jobs carry key, desired-set revision, LOD, scenery range, seed, biome offset, and a snapshot of terrain parameters (including `desert` and `coast`). Workers echo key and the revision the job was dispatched with; mismatched or obsolete responses are discarded before `BufferGeometry` allocation.
- On a reconcile, an in-flight job from the previous revision is adopted when it still produces exactly what the new target asks for: a `create` or `updateLOD` with the same LOD and scenery range, or a `regenerate` or `scenery` job on a chunk whose LOD is unchanged. Its revision moves to the new one and its result is committed. Other in-flight results become stale. Jobs from before a parameter or scenery change are never adopted.
- A `regenerate` job, queued or in flight, is queued again after a reconcile, so a parameter change is not lost when the plane crosses a chunk or turns.
- `dispatchJobs()` sends the most urgent pending jobs to every idle worker, every frame and again whenever a worker finishes, so workers never wait for the next frame. Pending jobs are sorted by `priority`, the LOD distance described below, so chunks ahead run before chunks equally far behind.
- A finished result waits in a `ready` queue and stays in the in-flight `Map`, so a reconcile can still adopt it. `commitReadyResults()` commits the queue nearest first, at least one result per frame, until `CHUNK_STREAMING.commitBytes` of new terrain and scenery buffers (`1.5` MB on desktop, `0.4` MB on mobile, about three LOD 0 chunks; uploaded on the next render) or `commitMs` (`4` or `3` ms) of main-thread time. Stale results are dropped without counting.
- Generation runs on a pool of `getChunkWorkerCount()` workers: one on mobile, and half the logical cores from one to four on desktop. Only one request per chunk key may be in flight. Each worker runs `runChunkJob()` ([`src/chunkWorkerJob.js`](../src/chunkWorkerJob.js)), which returns a failed job as an `{ id, error }` message; the manager retries such a job once. A worker that crashes (an `error` event, for example a module that fails to load) restarts after `250` ms, doubling the wait each time, and gives up after `3` consecutive crashes (`CHUNK_WORKER_RESTARTS`); any message resets the count. `ChunkManager` takes `isMobile` and an optional `createWorker` factory (the tests' fake workers) as its last argument.
- A new `Chunk` is added directly to the scene and registered in the live `Map`.
- After the commits, every frame, `Chunk.updateCurvedBounds()` moves the mesh-level culling spheres (`mesh.boundingSphere`, which three.js prefers to the geometry's) of each terrain mesh and its scenery mesh down to where the curvature draws them; without it, a camera pitched down culled distant chunks it could see. The geometry keeps the worker's flat sphere, which the flat-world shadow casters use. The flat sphere encloses the box of the chunk's footprint and height range, and every point of that box drops by the curvature at its own distance, between the drops at the box's nearest and farthest reach; `getCurvedBoxSphere()` lowers the center by the mean of those two drops and encloses the box made taller by their range (plus `0.5` for the sea waves, and `40` units of margin for the scenery). A first version grew the flat sphere in every direction instead: in the flight view it kept `63` chunks instead of `55`, plus more scenery and shadow casters, which cost frame rate. The tight sphere culls exactly as the flat one in normal flight (same draw counts and image as before).

`ChunkManager.getStats()` additionally reports queued, in-flight, and `ready` work, the last frame's commit (`lastCommit`: results, bytes, ms), generated/stale/failed results, worker count and `failedWorkers` (workers that gave up), the current `headingSector`, and seed. The browser exposes it through `window.__INFINITE_WORLD__.getChunkStats()`.

The worker pool removes height sampling and normal computation from the rendering thread. Scenery placement also runs in the worker. Main-thread geometry wrapping, scene insertion, and disposal stay synchronous but bounded by the commit budget, and the GPU upload of the committed buffers happens on the next render. Measured in headless Chrome on an Apple M1 with `?seed=review`: the desktop set is complete `0.46` s after the manager starts (`1.55` s with the former one-job-per-worker-per-frame scheduler), and a 12-second boosted, turning flight keeps no backlog (the former scheduler ended it with `48` pending jobs) with no frame above `16.8` ms in either case.

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

## Terrain Bands

[`src/terrainBands.js`](../src/terrainBands.js) is the single source of the terrain's elevation bands; the terrain shader receives every constant as a material define (`TERRAIN_SHADER_DEFINES`), and scenery placement calls `getTerrainBand()`.

- The module also holds the rocky coast mask's fixed offset (`COAST_ROCK_OFFSET`, a define); its noise settings are runtime parameters (see [Rocky Coast](#rocky-coast)).
- The layers are `TERRAIN_BANDS`: `sea`, `sand`, `grass`, `land`, `rocks`, `snow`. Their indices are `terrainBand` in `color-fragment.glsl` and the per-layer normal maps ([Rendering](RENDERING.md#terrain)).
- The sea fills everything up to `SAND_LEVEL` (`0.1`); sand begins above it.
- Each higher band begins where the height plus a wave, `sin(x · frequency) · amplitude + cos(z · frequency) · amplitude`, exceeds its `level`, with a black ink line from `line` to `level` below it: grass `0.3`/`0.6`, level `1.7`; land `0.1`/`1.6`, level `14.1`; rocks `0.15`/`2.5`, level `22.2`; snow `0.15`/`5`, level `40.2` (frequency/amplitude). A higher band wins wherever its border is passed, as in the shader.
- `getTerrainBand(x, y, z)` returns the band the shader colors at a world point. Placement evaluates it at the exact `getHeight()`; the shader evaluates it on the interpolated mesh, so on a coarse LOD the two can disagree within a fraction of a unit near a border.

## Per-Chunk Scenery

`WORLD_FEATURES` ([`src/worldConstants.js`](../src/worldConstants.js)) sets `scenery` and `clouds` to `true` and `boats` to `false`. Scenery means trees, cacti, rocks, and the sea rocks of the coast. Each one is drawn as an octahedral impostor, and as its real mesh near the eye; the rendering side is in [Rendering](RENDERING.md#impostor-scenery) and [Near Scenery Meshes](RENDERING.md#near-scenery-meshes). Clouds are not per-chunk content: they form a world-level field (see [Clouds](#clouds)). Boats keep their dormant implementation behind their flag.

### Biome Field

[`src/biome.js`](../src/biome.js) is the CPU twin of the GLSL `getBiomeValue()` in [`terrain-bands-pars.glsl`](../src/shaders/terrain-bands-pars.glsl), which `color-fragment.glsl` uses to select biomes.

- Both sum the same simplex layers, `BIOME_NOISE_LAYERS` in [`src/terrainBands.js`](../src/terrainBands.js) (frequency and weight: `0.000175` × `1`, `0.0035` × `0.22`, `0.012` × `0.06`), in the same order; the shader receives them as defines. [`src/noise.js`](../src/noise.js) ports the GLSL Ashima `snoise` exactly, using a floor-based `mod`.
- `createBiomeOffset(seed)` derives a seeded world offset in `±10000`. `createSharedUniforms()` passes that offset to the shader as `uBiomeOffset`, and `ChunkManager` passes it to workers in both the terrain and the scenery part of each request, so the seed moves biomes and their topography.
- A negative value is desert and a non-negative value is temperate.
- In a headless SwiftShader comparison over 16,384 points, JS and GLSL differed by at most `8e-6`, with no sign mismatch.
- Placement skips land candidates within `BIOME_BORDER_MARGIN` (`0.04`) of the border; sea rocks grow in both biomes and ignore it.

### Placement

[`src/sceneryPlacement.js`](../src/sceneryPlacement.js) runs in the chunk worker.

- **Settings:** each placement request carries a snapshot of `params.scenery`, created by `createScenerySettings()`. The **Scenery** debug folder edits it (see [Scenery Settings](#scenery-settings)). Cells align to chunk borders, so every candidate belongs to exactly one chunk: neighbours never duplicate or miss instances.
- **Grid:** a jittered world-space grid whose cell size is `settings.cellSize`: `8` units on desktop and `16` on mobile by default, and it must divide the chunk size.
- **Randomness:** each cell draws its values from a stateless integer hash of the seed and the cell coordinates (`cellRandom()` in [`src/random.js`](../src/random.js)). The result does not depend on generation order or LOD, and revisiting a coordinate reproduces the same instances.
- **Rejected candidates:** a candidate is skipped when any of these hold:
  - its terrain band at the exact height (`getTerrainBand()`, see [Terrain Bands](#terrain-bands)) is not grass, land, or rocks: snow carries no scenery, wherever the shader draws its wavy border, and the sea and the sand band carry only sea rocks (see **Sea rocks** below);
  - it is within the biome-border margin;
  - it fails the density test;
  - the surface normal's Y is below `0.8` (temperate) or `0.75` (desert).
- **Types:** each candidate first draws its type from a weighted table in `SCENERY_CONFIG`:
  - temperate grass band: round trees, some conifers and boulders;
  - temperate land band: mostly conifers;
  - temperate rocks band: conifers and boulders;
  - desert: one-arm and two-arm cacti, boulders, and layered rocks.
- **Sea rocks:** a candidate on the sea or sand band (`isCoastBand()`) where the sea is at most `settings.seaRocks.maxDepth` (`8.5`) deep (an exact height of at least `-8.5`) can only become a sea rock (`IMPOSTOR_TYPE.SEA_ROCK`), in either biome and up to the biome border. It is accepted with probability `(baseDensity + (maxDensity - baseDensity) × mask) × settings.density.seaRocks`, from `0.03` on plain coast to `0.3` per cell where the [rocky coast](#rocky-coast) mask is `1`, with no slope test. Its scale spans a wide range, `seaRocks.scale.min`–`max` (`0.35`–`2.1`) × the `seaRock` size, drawn as `random ** seaRocks.scale.bias` (`1.6`), so small rocks are common and large ones rare. Its base sits `coast.sink` (`0.2`) × scale below the ground, or below the sea surface (`SEA_SURFACE_Y`) over deeper water, so every rock rises above the sea; the opaque sea hides the part below. Each accepted rock brings up to `seaRocks.satellites.count` (`2`) smaller ones, at `satellites.distance` (`1.1`–`1.8`) × the footprint (`coast.footprint`, `2.5` units) × its scale from it, at `satellites.scale` (`0.4`–`0.7`) of its scale. Each satellite has its own exact height and is dropped where the sea is deeper than `maxDepth`. Satellites use salts from `9` on, so the group is deterministic and belongs to the candidate's chunk even where a satellite crosses its border. The tint is a dark brown in temperate areas and a reddish one in the desert.

  Scale, vertical stretch, yaw, and tint vary per instance. The tint is a brightness for every type; boulders are also grey in temperate areas and sandy in the desert. Trees and cacti take their hue from the scenery palettes in the shaders, from world-space noise at the instance's base, not from placement (see [Rendering](RENDERING.md#scenery-palettes)).
- **Density:** the candidate is then accepted with probability `baseDensity × settings.density[category]`. `baseDensity` follows a low-frequency cluster noise in temperate areas (maximum `0.55` per cell), which produces woods and clearings, and is a flat `0.16` in the desert. Type and acceptance use independent random values, so changing one category's density adds or removes only that category.
- **Size:** `settings.size[typeKey]` multiplies the instance scale drawn from the `SCENERY_CONFIG` range.
- **Height:** the base sits at the exact `getHeight()` value minus `0.35 × scale`, so it does not float where coarse terrain LODs cut below the true surface. Sea rocks use their own rule (above).
- **Cap:** when a chunk has more than `settings.maxPerChunk` instances (default `1000`), it keeps those with the lowest per-cell random priority. The subset is deterministic and spatially uniform.
- **Output:** a transferable `Float32Array` with `IMPOSTOR_INSTANCE_STRIDE = 8` floats per instance: chunk-local `x, y, z`, scale, yaw, type, packed RGB tint, stretch.

With the default settings, placement costs about `1.35` ms per chunk on desktop and `0.32` ms on mobile in Node. Sea rocks add no measurable cost: about `0.9` ms per desktop chunk with and without them along a rocky coast (`seed=rock288`). Instance counts reach about 550 and 120 per land chunk.

### Scenery LOD And Jobs

- Scenery range is radial and does not follow the forward LOD shift: `hasSceneryAtDistance()` keeps scenery on chunks whose radial LOD, `floor(distance * 0.7)`, is at most `SCENERY_MAX_LOD` (`2`). Impostors shrink to nothing by `950` units whatever the heading (`SCENERY_IMPOSTOR_FAR_FADE`), so scenery farther ahead would never be visible. Each desired target carries this result as `scenery`.
- `needsSceneryPlacement()` in `chunkPolicy.js` asks the worker for placement on every `create`, `regenerate`, and `scenery` job within range, and on any job flagged `refreshScenery`. An ordinary `updateLOD` job requests it only when the chunk has none.
- When a live chunk enters the range without a LOD change, the reconcile queues a `scenery` job for it. When it leaves the range without a LOD change, the reconcile clears its scenery directly on the main thread.
- A `scenery` job sends `terrain: false`: the worker skips terrain generation and returns only instances, and the manager replaces the chunk's scenery without touching its geometry. Scenery jobs do not count toward the one-near-job-per-frame limit.
- When a committed job's target is outside the range, the scenery is cleared. It is regenerated identically when the chunk comes back into range.
- `getStats()` reports `sceneryChunks` and `sceneryInstances`.

### Scenery Settings

`params.scenery` holds:

- `cellSize`, one of `SCENERY_CELL_SIZES` (`4`, `8`, `16`, or `32`); the default is `8` on desktop and `16` on mobile;
- `maxPerChunk`, default `1000`;
- density multipliers, with defaults `density.trees = 0.75`, `density.cacti = 0.2`, `density.rocks = 0.65`, and `density.seaRocks = 1`;
- size multipliers, copied from the `SCENERY_DEFAULT_SIZES` configuration object:
  - `roundTree`: `1.35`;
  - `conifer`: `1.7`;
  - `cactusOneArm`: `1.29`;
  - `cactusTwoArms`: `1.68`;
  - `boulder`: `0.6`;
  - `layeredRock`: `0.85`;
  - `seaRock`: `1.15`;
- `seaRocks`, the sea rocks' `maxDepth`, `scale` (`min`, `max`, `bias`), and `satellites` (`count`, `distance` and `scale` ranges), copied from `SEA_ROCK_DEFAULTS` (see **Sea rocks** under [Placement](#placement)). **Scenery > Sea rocks** edits them (**Max depth**, **Min scale**, **Max scale**, **Small rock bias**, and **Satellites > Max count**, **Min/Max distance ×**, **Min/Max size ×**); like every scenery setting, a change re-places scenery without rebuilding terrain.

Edit `SCENERY_DEFAULT_SIZES`, `SEA_ROCK_DEFAULTS`, and `createScenerySettings()` in `src/sceneryPlacement.js` to change the starting values. The GUI changes only the current session.

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
- **Randomness:** every value comes from `cellRandom()` ([`src/random.js`](../src/random.js)) over the seed hash and the cell. A cell's cloud never depends on the field center, so the field can be rebuilt anywhere and every cloud stays where it was.
- **Coverage:** a low-frequency `snoise()` field (wavelength `coverageScale`, `1400` units) splits the sky into cloudy and clear patches with a soft edge. The local coverage is the share of cloudy sky: `0` is clear everywhere, `1` cloudy everywhere. A cell holds a cloud with probability `local density × cloudiness`.
- **Regional variation:** `getCloudRegion()` modulates density, coverage, and size at each candidate's position with three independent low-frequency noise fields (two `snoise()` octaves each, wavelength `settings.regional.scale`, `4000` units by default). Regions therefore hold packed or scattered, large or small clouds, and the sky changes character gradually over a few thousand units of flight. The local density is `density × (1 ± regional.density)` (`0.6`), the local coverage `coverage ± regional.coverage` (`0.3`), both clamped to `[0, 1]`, and the size multiplier `2^(± regional.size)` (`0.5` stops). The fields are continuous, so neighbouring clouds stay alike, and they are sampled at the world position, so the field center never changes them. At amplitude `0` a setting is uniform. Altitude and field radius never vary. Over many `800`-unit windows, the cloud count spans about `3`–`52` (instead of `17`–`40` without the fields) and the mean scale about `0.87`–`1.53` (instead of `1.02`–`1.21`), with the same averages.
- **Seed offsets:** `getCloudFieldOffsets(seed)` gives the coverage field and each regional field its own seeded offset, so every seed has its own sky.
- **Types and size:** each cloud draws a type (`BANK` `0.35`, `HEAP` `0.3`, `PUFF` `0.35`), a scale from its `CLOUD_CONFIG.shape` range times `settings.size[typeKey]` and the regional size multiplier, and a vertical stretch.
- **Altitude:** the base (the cloud's flat bottom) lies in `settings.altitude`, Y `197` to `257` by default. The highest eye is about Y `102`: the `95` flight ceiling plus the follow camera's `7`. Terrain peaks measured over several seeds stay below about `95`.
- **Orientation:** placement stores no heading. The shaders turn every cloud about its vertical axis so its front face looks at the airplane (`getFacingYaw()`, see [Rendering](RENDERING.md#clouds)). The yaw slot of the instance layout holds only a dither seed.
- **Neighbours:** `CLOUD_CONFIG.extent` bounds each source model. Because clouds turn, each one's footprint is the circle of radius `hypot(halfWidth, halfDepth) × scale` around its base. A cloud whose footprint and height range overlap those of a raw neighbouring candidate with a lower priority value is dropped. `getCloudNeighbourRing(settings)` sets how many cells to check in each direction: bases `k` cells apart are at least `(k - span) × cellSize` apart, so the ring reaches as far as two of the largest possible footprints (largest type scale × its size setting × the largest regional size factor), and at least one cell. With the default sizes it is `2` cells. The ring depends only on the settings, so the test stays independent of the field center.
- **Output:** `generateCloudInstances()` returns a `Float32Array` in the `IMPOSTOR_INSTANCE_STRIDE` layout with world-space bases, for clouds whose base lies within `getCloudFieldReach(settings.radius)` (horizontal) of the center: the radius plus half a cell diagonal (`113` units). The airplane can be that far from the field center, so every cloud nearer to it than the far fade's end exists wherever it is in its cell, and none pops in or out at a visible size when the field moves; the extra clouds sit beyond the fade at zero size.
- **Field:** `Clouds.update(planePosition, camera)` regenerates when the airplane enters a new cloud cell, after `setSeed()`, or after `applySettings()`. It centers the field on the cell center and replaces the single impostor geometry, then selects the near meshes. The radius is `1850` units on desktop and `1100` on mobile (`CLOUD_FIELD_RADIUS`); impostors shrink into the fog over `getCloudFarFade(radius)`, inside it, so clouds never pop at the field edge.
- **Seed:** `World.applyWorldSeed()` calls `Clouds.setSeed()`, so a GUI seed change also changes the sky.
- **Cost:** about `0.45` ms per rebuild on desktop (about 140 clouds on average) and `0.17` ms on mobile (about 63) in Node after warm-up, once per `160` units of travel.

### Cloud Settings

`params.clouds.placement` (`createCloudSettings()`) holds `radius`, `density` (`0.55`), `coverage` (`0.6`), `altitude` (`min 197`, `range 60`), `size` (`bank 1.69`, `heap 1.04`, `puff 1.14`), and `regional` (`scale 4000`, `density 0.6`, `coverage 0.3`, `size 0.5`). The **Clouds** GUI folder edits them, the regional ones under **Regional variation**, and re-places the field when a control is released. The same folder sets the near-mesh bands, the wood detail (re-bake), the ambient boost, the brightness variation, and the shadows (see [Rendering](RENDERING.md#clouds)).

## Resource Lifecycle

`Chunk.dispose()` removes the chunk from its parent, disposes the terrain geometry, clears the scenery, and removes boat clones. Review all owned GPU resources when adding new per-chunk content.

- `Chunk.setScenery()` builds one `InstancedBufferGeometry` per chunk: a 4-vertex quad plus the instance buffer. The chunk owns it, and `clearScenery()` disposes it. The scenery mesh has one child, the debug wireframe overlay, which shares that geometry and the impostor wireframe material.
- The impostor material, its wireframe twin, and the atlas textures belong to `SceneryImpostors`, which hands them to `ChunkManager`; chunks never dispose them.
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
- Change band, biome, and rocky coast constants only in `src/terrainBands.js`: placement and the terrain shader both read them. Check terrain, scenery, clouds, and boats after changing them. Keep the `snoise` port in `src/noise.js` identical to the GLSL, and the summation order of `getBiomeValue()` the same on both sides. If the biome field can grow steeper, raise `BIOME_MAX_GRADIENT` in `color-fragment.glsl`, or the separator can be clipped.
- Treat changes to `params.octaves` as changes to both the height loop and the number of available noise functions; `createTerrainNoises()` keeps at least the two the landmass needs.

## Open Questions

- Should a generated terrain seed be persisted when no URL seed is supplied? It is shown in the `?gui=1` **World** folder but not written to the URL.
- What frame-time budget should govern queue throughput and chunk radius?
- Should chunk resources be pooled rather than recreated after disposal?
- What scenery density and instance scale best match the style references in [`docs/style-references/`](style-references/)?
- How should visible geometric seams (T-junctions between LODs) be measured?
