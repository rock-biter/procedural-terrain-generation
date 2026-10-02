export default class ChunkWorkerPool {
	workers = []
	nextRequestId = 0

	constructor(size) {
		for (let index = 0; index < size; index++) {
			this.workers.push(this.createWorkerState())
		}
	}

	createWorkerState() {
		const state = {
			worker: null,
			resolve: null,
			reject: null,
		}

		this.attachWorker(state)
		return state
	}

	attachWorker(state) {
		const worker = new Worker(
			new URL('./chunkGeometry.worker.js', import.meta.url),
			{
				type: 'module',
			},
		)

		worker.addEventListener('message', ({ data }) => {
			const resolve = state.resolve
			const reject = state.reject
			state.resolve = null
			state.reject = null

			if (data.error) {
				reject?.(new Error(data.error))
			} else {
				resolve?.(data)
			}
		})

		worker.addEventListener('error', (event) => {
			const reject = state.reject
			state.resolve = null
			state.reject = null
			worker.terminate()
			this.attachWorker(state)
			reject?.(event.error ?? new Error(event.message))
		})

		state.worker = worker
	}

	get size() {
		return this.workers.length
	}

	run(request) {
		const state = this.workers.find(
			(workerState) => workerState.resolve === null,
		)
		if (!state) return null

		const id = ++this.nextRequestId
		return new Promise((resolve, reject) => {
			state.resolve = resolve
			state.reject = reject
			state.worker.postMessage({ id, ...request })
		})
	}

	dispose() {
		for (const state of this.workers) {
			state.reject?.(new Error('Chunk worker pool disposed'))
			state.worker.terminate()
		}
		this.workers = []
	}
}
