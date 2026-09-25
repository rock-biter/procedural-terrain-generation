import { Vector3 } from 'three'
import Chunk from './chunk'
import { createChunkGeometry, createTerrainNoises } from './chunkGeometry'
import { getChunkKey, getChunkLOD, getDesiredChunks } from './chunkPolicy'
import ChunkWorkerPool from './chunkWorkerPool'

const isMobile = window.innerWidth < 768

export default class ChunkManager {
	chunks = new Map()
	desired = new Map()
	pending = new Map()
	inFlight = new Map()
	lastChunkVisited = null
	revision = 0
	created = 0
	disposed = 0
	generated = 0
	stale = 0
	failed = 0
	maxDistance = isMobile ? 4 : 5
	jobsPerFrame = isMobile ? 2 : 3
	density = isMobile ? 4 : 2

	constructor(
		chunkSize,
		camera,
		params,
		scene,
		uniforms,
		assets,
		features,
		seed,
	) {
		this.params = params
		this.camera = camera
		this.chunkSize = chunkSize
		this.scene = scene
		this.uniforms = uniforms
		this.assets = assets
		this.features = features
		this.seed = seed
		this.noise = createTerrainNoises(seed, params.octaves)
		const availableThreads = Math.max(
			1,
			(navigator.hardwareConcurrency ?? 2) - 1,
		)
		const workerCount = isMobile ? 1 : Math.min(2, availableThreads)
		this.workerPool = new ChunkWorkerPool(workerCount)

		this.init()
	}

	init() {
		this.updateChunks()
	}

	getLODbyCoords(k, w) {
		const [i, j] = this.getCoordsByCamera()

		return getChunkLOD(Math.hypot(k - i, w - j))
	}

	reconcileChunks(i, j) {
		this.revision++
		this.desired = getDesiredChunks(i, j, this.maxDistance)

		for (const key of this.chunks.keys()) {
			if (!this.desired.has(key)) this.disposeChunk(key)
		}

		for (const key of this.pending.keys()) {
			if (!this.desired.has(key)) this.pending.delete(key)
		}

		for (const target of this.desired.values()) {
			const chunk = this.chunks.get(target.key)
			const pending = this.pending.get(target.key)

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
				})
			} else if (pending?.type === 'regenerate') {
				this.pending.set(target.key, {
					...pending,
					distance: target.distance,
					revision: this.revision,
				})
			} else {
				this.pending.delete(target.key)
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
	}

	processPendingJobs() {
		const jobs = [...this.pending.values()].sort(
			(a, b) => a.distance - b.distance,
		)
		let processed = 0

		for (const job of jobs) {
			if (processed >= this.jobsPerFrame) break
			if (this.pending.get(job.key) !== job) continue
			if (this.inFlight.has(job.key)) continue
			if (!this.isJobCurrent(job)) {
				this.pending.delete(job.key)
				continue
			}

			const generation = this.workerPool.run(this.createWorkerRequest(job))
			if (!generation) break

			this.pending.delete(job.key)
			this.inFlight.set(job.key, job)
			generation.then(
				(data) => this.commitWorkerResult(job, data),
				(error) => this.handleWorkerError(job, error),
			)
			processed++
			if (job.LOD <= 1 && processed === 1) break
		}
	}

	createWorkerRequest(job) {
		const [i, j] = job.coords
		return {
			key: job.key,
			revision: job.revision,
			geometry: {
				size: this.chunkSize,
				LOD: job.LOD,
				density: this.density,
				worldX: (i + 0.5) * this.chunkSize,
				worldZ: (j + 0.5) * this.chunkSize,
				seed: this.seed,
				params: {
					amplitude: this.params.amplitude,
					frequency: {
						x: this.params.frequency.x,
						z: this.params.frequency.z,
					},
					octaves: this.params.octaves,
					lacunarity: this.params.lacunarity,
					persistance: this.params.persistance,
				},
			},
		}
	}

	commitWorkerResult(job, response) {
		if (this.inFlight.get(job.key) !== job) return
		this.inFlight.delete(job.key)

		if (
			response.key !== job.key ||
			response.revision !== job.revision ||
			!this.isJobCurrent(job)
		) {
			this.stale++
			return
		}

		const geometry = createChunkGeometry(response.geometry)
		const chunk = this.chunks.get(job.key)

		if (job.type === 'create') {
			if (chunk) {
				geometry.dispose()
				this.stale++
				return
			}
			this.createChunk(job, geometry)
		} else if (chunk) {
			chunk.replaceGeometry(geometry, job.LOD)
		} else {
			geometry.dispose()
			this.stale++
			return
		}

		this.generated++
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
		if (job.type === 'regenerate' || job.forceLOD) return true

		return target.LOD === job.LOD
	}

	updateChunks() {
		const [i, j] = this.getCoordsByCamera()
		const currentChunkKey = getChunkKey(i, j)

		if (currentChunkKey !== this.lastChunkVisited) {
			this.lastChunkVisited = currentChunkKey
			this.reconcileChunks(i, j)
			return
		}

		this.processPendingJobs()
	}

	disposeChunk(key) {
		const chunk = this.chunks.get(key)
		if (!chunk) return

		this.pending.delete(key)
		chunk.dispose()
		this.chunks.delete(key)
		this.disposed++
	}

	onParamsChange(LOD) {
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

			const forceLOD = LOD !== undefined
			this.pending.set(key, {
				...target,
				type: forceLOD ? 'updateLOD' : 'regenerate',
				LOD: forceLOD ? LOD : chunk.LOD,
				forceLOD,
				revision: this.revision,
			})
		}
	}

	getStats() {
		return {
			desired: this.desired.size,
			live: this.chunks.size,
			pending: this.pending.size + this.inFlight.size,
			queued: this.pending.size,
			inFlight: this.inFlight.size,
			created: this.created,
			disposed: this.disposed,
			generated: this.generated,
			stale: this.stale,
			failed: this.failed,
			workers: this.workerPool.size,
			revision: this.revision,
			seed: this.seed,
		}
	}

	getCoordsByCamera() {
		const [x, , z] = this.camera.position
		const i = Math.floor(x / this.chunkSize)
		const j = Math.floor(z / this.chunkSize)

		return [i, j]
	}
}
