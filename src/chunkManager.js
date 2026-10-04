import { Vector3 } from 'three'
import { createBiomeOffset } from './biome'
import Chunk from './chunk'
import { createTerrainNoises } from './chunkGeometry'
import {
	CHUNK_STREAMING,
	getChunkKey,
	getChunkWorkerCount,
	getDesiredChunks,
	getHeadingSector,
	getSectorDirection,
	needsSceneryPlacement,
} from './chunkPolicy'
import { createChunkGeometry } from './chunkTopology'
import ChunkWorkerPool from './chunkWorkerPool'

// New buffers a worker result adds, uploaded on the next render.
function getResponseBytes({ geometry, scenery }) {
	let bytes = scenery?.byteLength ?? 0
	if (geometry) {
		bytes += geometry.position.byteLength + geometry.normal.byteLength + geometry.height.byteLength
	}
	return bytes
}

// Work already running for a target stays valid across a reconcile when it
// produces exactly what the new target asks for.
function canAdoptJob(job, target, chunk) {
	if (job.scenery !== target.scenery || job.LOD !== target.LOD) return false
	if (!chunk) return job.type === 'create'
	if (job.type === 'updateLOD') return true
	return (job.type === 'regenerate' || job.type === 'scenery') && chunk.LOD === target.LOD
}

export default class ChunkManager {
	chunks = new Map()
	desired = new Map()
	pending = new Map()
	// Jobs sent to a worker, including finished ones waiting in `ready`: they
	// stay here until committed, so a reconcile can still adopt them.
	inFlight = new Map()
	ready = []
	lastChunkVisited = null
	headingSector = null
	forward = new Vector3()
	revision = 0
	created = 0
	disposed = 0
	generated = 0
	stale = 0
	failed = 0
	lastCommit = { results: 0, bytes: 0, ms: 0 }

	// `isMobile` picks the mobile streaming budget, grid density, and worker
	// count; `createWorker` replaces the bundled module worker (tests).
	constructor(
		chunkSize,
		camera,
		params,
		scene,
		uniforms,
		assets,
		features,
		seed,
		{ isMobile = false, createWorker } = {},
	) {
		this.streaming = isMobile ? CHUNK_STREAMING.mobile : CHUNK_STREAMING.desktop
		this.maxDistance = this.streaming.maxDistance
		this.density = isMobile ? 4 : 2
		this.params = params
		this.camera = camera
		this.chunkSize = chunkSize
		this.scene = scene
		this.uniforms = uniforms
		this.assets = assets
		this.features = features
		this.seed = seed
		this.noise = createTerrainNoises(seed, params.octaves)
		this.biomeOffset = createBiomeOffset(seed)
		this.workerPool = new ChunkWorkerPool(
			getChunkWorkerCount({
				isMobile,
				hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? 2,
			}),
			{ createWorker },
		)

		this.init()
	}

	init() {
		this.updateChunks()
	}

	reconcileChunks(i, j) {
		const previousRevision = this.revision
		this.revision++
		this.desired = getDesiredChunks(i, j, this.maxDistance, {
			heading: getSectorDirection(this.headingSector),
			lookAhead: this.streaming.lookAhead,
			rearDistance: this.streaming.rearDistance,
		})

		for (const key of this.chunks.keys()) {
			if (!this.desired.has(key)) this.disposeChunk(key)
		}

		for (const key of this.pending.keys()) {
			if (!this.desired.has(key)) this.pending.delete(key)
		}

		for (const target of this.desired.values()) {
			const chunk = this.chunks.get(target.key)
			const pending = this.pending.get(target.key)
			const inFlight = this.inFlight.get(target.key)

			// Heading changes reconcile often; keep a current in-flight result
			// instead of discarding it and generating the same data again.
			if (
				!pending &&
				inFlight?.revision === previousRevision &&
				canAdoptJob(inFlight, target, chunk)
			) {
				inFlight.revision = this.revision
				inFlight.distance = target.distance
				inFlight.priority = target.priority
				continue
			}

			// Scenery refreshes and parameter regenerations must survive the new
			// revision, whether queued or in flight (an in-flight result is now
			// stale).
			const sceneryWork = [pending, inFlight].find(
				(job) => job?.type === 'scenery' || job?.refreshScenery,
			)
			const refreshScenery = Boolean(sceneryWork)
			const regenerate = [pending, inFlight].some((job) => job?.type === 'regenerate')

			if (!chunk) {
				this.pending.set(target.key, {
					...target,
					type: 'create',
					revision: this.revision,
				})
			} else if (chunk.LOD !== target.LOD) {
				this.pending.set(target.key, {
					...target,
					type: 'updateLOD',
					revision: this.revision,
					refreshScenery,
				})
			} else if (regenerate) {
				this.pending.set(target.key, {
					...target,
					type: 'regenerate',
					revision: this.revision,
					refreshScenery,
				})
			} else if (this.features.scenery && target.scenery && (refreshScenery || !chunk.hasScenery)) {
				this.pending.set(target.key, {
					...target,
					type: 'scenery',
					revision: this.revision,
				})
			} else {
				this.pending.delete(target.key)
				// Scenery range is radial and can end without a LOD change.
				if (!target.scenery) chunk.clearScenery()
			}
		}
	}

	createChunk(job, geometry) {
		const [i, j] = job.coords
		const position = new Vector3(i + 0.5, 0, j + 0.5)
		position.multiplyScalar(this.chunkSize)
		const chunk = new Chunk(
			this.chunkSize,
			this.noise,
			this.params,
			job.LOD,
			position,
			this.uniforms,
			this.assets,
			this.features,
			geometry,
		)
		chunk.coords = [i, j]
		this.chunks.set(job.key, chunk)
		this.created++
		this.scene.add(chunk)
		return chunk
	}

	// Sends the most urgent queued jobs to every idle worker. Runs every frame
	// and whenever a worker finishes, so no worker waits for the next frame.
	dispatchJobs() {
		if (this.pending.size === 0) return
		const jobs = [...this.pending.values()].sort((a, b) => a.priority - b.priority)

		for (const job of jobs) {
			if (this.pending.get(job.key) !== job) continue
			if (this.inFlight.has(job.key)) continue
			if (!this.isJobCurrent(job)) {
				this.pending.delete(job.key)
				continue
			}

			const generation = this.workerPool.run(this.createWorkerRequest(job))
			if (!generation) break

			this.pending.delete(job.key)
			// An adopted job gets a newer revision; the response echoes this one.
			job.requestRevision = job.revision
			this.inFlight.set(job.key, job)
			generation.then(
				(response) => {
					job.response = response
					this.ready.push(job)
					this.dispatchJobs()
				},
				(error) => {
					this.handleWorkerError(job, error)
					this.dispatchJobs()
				},
			)
		}
	}

	// Commits finished results, nearest first, within the frame budget of
	// CHUNK_STREAMING (bytes to upload and main-thread time). Stale results are
	// dropped without counting.
	commitReadyResults() {
		if (this.ready.length === 0) return
		this.ready.sort((a, b) => a.priority - b.priority)
		const { commitBytes, commitMs } = this.streaming
		const start = performance.now()
		let results = 0
		let bytes = 0

		while (this.ready.length > 0) {
			const job = this.ready[0]
			const jobBytes = getResponseBytes(job.response)
			if (results > 0 && (bytes + jobBytes > commitBytes || performance.now() - start > commitMs)) {
				break
			}
			this.ready.shift()
			const response = job.response
			job.response = null
			if (this.commitWorkerResult(job, response)) {
				results++
				bytes += jobBytes
			}
		}

		this.lastCommit.results = results
		this.lastCommit.bytes = bytes
		this.lastCommit.ms = performance.now() - start
	}

	createWorkerRequest(job) {
		const [i, j] = job.coords
		const wantsScenery =
			this.features.scenery &&
			needsSceneryPlacement(
				job.type,
				job.scenery,
				this.chunks.get(job.key)?.hasScenery ?? false,
				job.refreshScenery,
			)
		return {
			key: job.key,
			revision: job.revision,
			terrain: job.type !== 'scenery',
			scenery: wantsScenery
				? {
						biomeOffset: this.biomeOffset,
						// postMessage() clones it for the worker.
						settings: this.params.scenery,
					}
				: null,
			geometry: {
				size: this.chunkSize,
				LOD: job.LOD,
				density: this.density,
				worldX: (i + 0.5) * this.chunkSize,
				worldZ: (j + 0.5) * this.chunkSize,
				seed: this.seed,
				biomeOffset: this.biomeOffset,
				params: {
					amplitude: this.params.amplitude,
					frequency: {
						x: this.params.frequency.x,
						z: this.params.frequency.z,
					},
					octaves: this.params.octaves,
					lacunarity: this.params.lacunarity,
					persistance: this.params.persistance,
					desert: { ...this.params.desert },
				},
			},
		}
	}

	// Applies a worker result; returns false for a stale one.
	commitWorkerResult(job, response) {
		if (this.inFlight.get(job.key) !== job) return false
		this.inFlight.delete(job.key)

		if (
			response.key !== job.key ||
			response.revision !== job.requestRevision ||
			!this.isJobCurrent(job)
		) {
			this.stale++
			return false
		}

		let chunk = this.chunks.get(job.key)

		if (job.type === 'scenery') {
			if (!chunk) {
				this.stale++
				return false
			}
			if (response.scenery) chunk.setScenery(response.scenery)
			this.generated++
			return true
		}

		if (job.type === 'create' ? chunk : !chunk) {
			this.stale++
			return false
		}
		const geometry = createChunkGeometry(response.geometry)
		if (job.type === 'create') chunk = this.createChunk(job, geometry)
		else chunk.replaceGeometry(geometry, job.LOD)

		if (response.scenery) chunk.setScenery(response.scenery)
		else if (!job.scenery) chunk.clearScenery()

		this.generated++
		return true
	}

	handleWorkerError(job, error) {
		if (this.inFlight.get(job.key) !== job) return
		this.inFlight.delete(job.key)
		this.failed++
		console.error(`Chunk generation failed for ${job.key}`, error)

		if (this.isJobCurrent(job) && (job.attempts ?? 0) < 1) {
			this.pending.set(job.key, {
				...job,
				attempts: (job.attempts ?? 0) + 1,
			})
		}
	}

	isJobCurrent(job) {
		if (job.revision !== this.revision) return false

		const target = this.desired.get(job.key)
		if (!target) return false
		if (job.type === 'create') {
			return !this.chunks.has(job.key) && target.LOD === job.LOD
		}
		if (!this.chunks.has(job.key)) return false
		if (job.type === 'regenerate' || job.type === 'scenery') {
			return true
		}

		return target.LOD === job.LOD
	}

	updateChunks() {
		const [i, j] = this.getCoordsByCamera()
		const currentChunkKey = getChunkKey(i, j)
		const headingSector = this.getHeadingSector()

		if (currentChunkKey !== this.lastChunkVisited || headingSector !== this.headingSector) {
			this.lastChunkVisited = currentChunkKey
			this.headingSector = headingSector
			this.reconcileChunks(i, j)
		}

		this.dispatchJobs()
		this.commitReadyResults()

		// After the commits, so new chunks are culled where they are drawn.
		const curvature = this.uniforms.uCurvature?.value
		if (curvature) {
			for (const chunk of this.chunks.values()) {
				chunk.updateCurvedBounds(this.camera.position, curvature)
			}
		}
	}

	disposeChunk(key) {
		const chunk = this.chunks.get(key)
		if (!chunk) return

		this.pending.delete(key)
		chunk.dispose()
		this.chunks.delete(key)
		this.disposed++
	}

	// Replaces the world seed: terrain noise, biome offset (CPU and the shared
	// uBiomeOffset uniform), and scenery placement all follow it. Every desired
	// chunk is regenerated; in-flight results for the old seed become stale.
	setSeed(seed) {
		if (seed === this.seed) return

		this.seed = seed
		this.biomeOffset = createBiomeOffset(seed)
		this.uniforms.uBiomeOffset.value.fromArray(this.biomeOffset)
		this.onParamsChange()
	}

	onParamsChange() {
		this.revision++
		this.noise = createTerrainNoises(this.seed, this.params.octaves)
		this.pending.clear()

		for (const [key, target] of this.desired) {
			const chunk = this.chunks.get(key)
			if (!chunk) {
				this.pending.set(key, {
					...target,
					type: 'create',
					revision: this.revision,
				})
				continue
			}

			this.pending.set(key, {
				...target,
				type: 'regenerate',
				LOD: chunk.LOD,
				revision: this.revision,
			})
		}
	}

	// Re-places scenery after a change to params.scenery. Queued and in-flight
	// jobs are queued again (in-flight results become stale) and also refresh
	// scenery; other live chunks in scenery range get a scenery-only job.
	onSceneryChange() {
		if (!this.features.scenery) return

		this.revision++
		const previous = this.pending
		this.pending = new Map()

		for (const [key, target] of this.desired) {
			const chunk = this.chunks.get(key)
			const queued = previous.get(key) ?? this.inFlight.get(key)

			if (queued) {
				this.pending.set(key, {
					...queued,
					revision: this.revision,
					refreshScenery: true,
				})
			} else if (!chunk) {
				this.pending.set(key, {
					...target,
					type: 'create',
					revision: this.revision,
				})
			} else if (target.scenery) {
				this.pending.set(key, {
					...target,
					LOD: chunk.LOD,
					type: 'scenery',
					revision: this.revision,
				})
			}
		}
	}

	getStats() {
		let sceneryChunks = 0
		let sceneryInstances = 0
		for (const chunk of this.chunks.values()) {
			if (!chunk.scenery) continue
			sceneryChunks++
			sceneryInstances += chunk.scenery.geometry.instanceCount
		}

		return {
			desired: this.desired.size,
			live: this.chunks.size,
			pending: this.pending.size + this.inFlight.size,
			queued: this.pending.size,
			inFlight: this.inFlight.size - this.ready.length,
			ready: this.ready.length,
			lastCommit: { ...this.lastCommit },
			created: this.created,
			disposed: this.disposed,
			generated: this.generated,
			stale: this.stale,
			failed: this.failed,
			workers: this.workerPool.size,
			failedWorkers: this.workerPool.failedCount,
			revision: this.revision,
			headingSector: this.headingSector,
			seed: this.seed,
			sceneryChunks,
			sceneryInstances,
		}
	}

	// The tracked object is the Plane, whose local +Z is its flight direction.
	getHeadingSector() {
		this.camera.getWorldDirection(this.forward)
		return getHeadingSector(this.forward.x, this.forward.z, this.headingSector)
	}

	getCoordsByCamera() {
		const [x, , z] = this.camera.position
		const i = Math.floor(x / this.chunkSize)
		const j = Math.floor(z / this.chunkSize)

		return [i, j]
	}
}
