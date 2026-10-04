// A worker that fails to start (for example a module that does not load)
// would fail again at once, so restarts are capped: after `max` consecutive
// `error` events the worker gives up, and the n-th restart waits
// `delayMs * 2^(n - 1)`. Any message resets the count.
export const CHUNK_WORKER_RESTARTS = Object.freeze({ max: 3, delayMs: 250 })

// Module workers bundled by Vite (the URL must stay literal); tests pass their
// own factory.
function createChunkWorker() {
	return new Worker(new URL('./chunkGeometry.worker.js', import.meta.url), {
		type: 'module',
	})
}

export default class ChunkWorkerPool {
	workers = []
	nextRequestId = 0

	constructor(size, { createWorker = createChunkWorker, restarts = CHUNK_WORKER_RESTARTS } = {}) {
		this.createWorker = createWorker
		this.restarts = restarts
		for (let index = 0; index < size; index++) {
			this.workers.push(this.createWorkerState())
		}
	}

	createWorkerState() {
		const state = {
			worker: null,
			resolve: null,
			reject: null,
			failures: 0,
			failed: false,
			restartTimer: null,
		}

		this.attachWorker(state)
		return state
	}

	attachWorker(state) {
		state.restartTimer = null
		const worker = this.createWorker()

		worker.addEventListener('message', ({ data }) => {
			const resolve = state.resolve
			const reject = state.reject
			state.resolve = null
			state.reject = null
			state.failures = 0

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
			state.worker = null
			state.failures++
			if (state.failures > this.restarts.max) {
				state.failed = true
				console.error(`Chunk worker failed ${state.failures} times in a row; not restarting it`)
			} else {
				const delay = this.restarts.delayMs * 2 ** (state.failures - 1)
				state.restartTimer = setTimeout(() => this.attachWorker(state), delay)
			}
			reject?.(event.error ?? new Error(event.message))
		})

		state.worker = worker
	}

	get size() {
		return this.workers.length
	}

	// Workers that gave up after repeated start failures.
	get failedCount() {
		return this.workers.filter((state) => state.failed).length
	}

	// Null when no worker is idle (or every worker is restarting or failed).
	run(request) {
		const state = this.workers.find(
			(workerState) => workerState.worker !== null && workerState.resolve === null,
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
			clearTimeout(state.restartTimer)
			state.reject?.(new Error('Chunk worker pool disposed'))
			state.worker?.terminate()
		}
		this.workers = []
	}
}
