import { createTerrainNoises, generateChunkGeometryData } from './chunkGeometry'
import { generateSceneryInstances } from './sceneryPlacement'

let cachedNoiseKey = null
let cachedNoises = null

self.addEventListener('message', ({ data: request }) => {
	try {
		const noiseKey = `${request.geometry.seed}:${request.geometry.params.octaves}`
		if (noiseKey !== cachedNoiseKey) {
			cachedNoiseKey = noiseKey
			cachedNoises = createTerrainNoises(
				request.geometry.seed,
				request.geometry.params.octaves,
			)
		}

		const geometry = generateChunkGeometryData({
			...request.geometry,
			noises: cachedNoises,
		})
		const transfer = [
			geometry.position.buffer,
			geometry.normal.buffer,
			geometry.uv.buffer,
			geometry.height.buffer,
			geometry.index.buffer,
		]

		// Placement depends only on world coordinates, never on terrain LOD.
		let scenery = null
		if (request.scenery) {
			scenery = generateSceneryInstances({
				size: request.geometry.size,
				worldX: request.geometry.worldX,
				worldZ: request.geometry.worldZ,
				seed: request.geometry.seed,
				params: request.geometry.params,
				noises: cachedNoises,
				cellSize: request.scenery.cellSize,
				biomeOffset: request.scenery.biomeOffset,
			})
			transfer.push(scenery.buffer)
		}

		self.postMessage(
			{
				id: request.id,
				key: request.key,
				revision: request.revision,
				geometry,
				scenery,
			},
			transfer,
		)
	} catch (error) {
		self.postMessage({
			id: request.id,
			error: error instanceof Error ? error.message : String(error),
		})
	}
})
