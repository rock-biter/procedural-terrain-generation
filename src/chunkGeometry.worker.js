import { createTerrainNoises, generateChunkGeometryData } from './chunkGeometry'

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

		self.postMessage(
			{
				id: request.id,
				key: request.key,
				revision: request.revision,
				geometry,
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
