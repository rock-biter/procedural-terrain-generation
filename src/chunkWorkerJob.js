import { createTerrainNoises, generateChunkGeometryData } from './chunkGeometry.js'
import { generateSceneryInstances } from './sceneryPlacement.js'

// Runs one chunk request (ChunkManager.createWorkerRequest()) and returns the
// response with the buffers to transfer. `cache` keeps the seeded noises
// between requests of one worker. Errors become `{ id, error }` responses, so
// a failing job never takes the worker down. Used by
// src/chunkGeometry.worker.js and by the tests' fake workers.
export function runChunkJob(request, cache) {
	try {
		const noiseKey = `${request.geometry.seed}:${request.geometry.params.octaves}`
		if (noiseKey !== cache.noiseKey) {
			cache.noiseKey = noiseKey
			cache.noises = createTerrainNoises(request.geometry.seed, request.geometry.params.octaves)
		}

		// Scenery-only requests reuse the chunk's world data without rebuilding
		// its terrain.
		let geometry = null
		const transfer = []
		if (request.terrain !== false) {
			geometry = generateChunkGeometryData({
				...request.geometry,
				noises: cache.noises,
			})
			// Index and uv are shared per LOD on the main thread.
			transfer.push(geometry.position.buffer, geometry.normal.buffer, geometry.height.buffer)
		}

		// Placement depends only on world coordinates, never on terrain LOD.
		let scenery = null
		if (request.scenery) {
			scenery = generateSceneryInstances({
				size: request.geometry.size,
				worldX: request.geometry.worldX,
				worldZ: request.geometry.worldZ,
				seed: request.geometry.seed,
				params: request.geometry.params,
				noises: cache.noises,
				biomeOffset: request.scenery.biomeOffset,
				settings: request.scenery.settings,
			})
			transfer.push(scenery.buffer)
		}

		return {
			response: {
				id: request.id,
				key: request.key,
				revision: request.revision,
				geometry,
				scenery,
			},
			transfer,
		}
	} catch (error) {
		return {
			response: { id: request.id, error: error instanceof Error ? error.message : String(error) },
			transfer: [],
		}
	}
}
