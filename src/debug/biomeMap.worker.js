import { createTerrainNoises } from '../chunkGeometry'
import { rasterizeBiomeMap } from './biomeMapPolicy'

// Rasterizes the ?gui=1 biome map (src/debug/biomeMap.js) off the main
// thread. The seeded noises survive between requests.
const cache = {}

self.addEventListener('message', ({ data: request }) => {
	const noiseKey = `${request.seed}:${request.params.octaves}`
	if (noiseKey !== cache.noiseKey) {
		cache.noiseKey = noiseKey
		cache.noises = createTerrainNoises(request.seed, request.params.octaves)
	}
	const { pixels, counts } = rasterizeBiomeMap({ ...request, noises: cache.noises })
	self.postMessage({ id: request.id, view: request.view, size: request.size, pixels, counts }, [
		pixels.buffer,
	])
})
