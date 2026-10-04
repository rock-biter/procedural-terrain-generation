import { runChunkJob } from './chunkWorkerJob'

// The seeded noises survive between this worker's requests.
const cache = {}

self.addEventListener('message', ({ data: request }) => {
	const { response, transfer } = runChunkJob(request, cache)
	self.postMessage(response, transfer)
})
