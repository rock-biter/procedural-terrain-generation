import { Vector3 } from 'three'
import { createBiomeOffset } from './biome'
import Chunk from './chunk'
import { createChunkGeometry, createTerrainNoises } from './chunkGeometry'
import {
	getChunkKey,
	getChunkLOD,
	getDesiredChunks,
	hasSceneryAtLOD,
	needsSceneryPlacement,
} from './chunkPolicy'
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
		this.biomeOffset = createBiomeOffset(seed)
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
			// A scenery refresh must survive the new revision, whether its job is
			// still queued or in flight (an in-flight result is now stale).
			const sceneryWork = [pending, this.inFlight.get(target.key)].find(
				(job) => job?.type === 'scenery' || job?.refreshScenery,
			)
			const refreshScenery = Boolean(sceneryWork)

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
			} else if (pending?.type === 'regenerate') {
				this.pending.set(target.key, {
					...pending,
					distance: target.distance,
					revision: this.revision,
				})
			} else if (refreshScenery && hasSceneryAtLOD(chunk.LOD)) {
				this.pending.set(target.key, {
					...target,
					type: 'scenery',
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
		return chunk
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
			// Scenery-only jobs are cheap; only terrain work limits near jobs.
			if (job.type !== 'scenery' && job.LOD <= 1 && processed === 1) break
		}
	}

	createWorkerRequest(job) {
		const [i, j] = job.coords
		const wantsScenery =
			this.features.scenery &&
			needsSceneryPlacement(
				job.type,
				job.LOD,
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
						settings: structuredClone(this.params.scenery),
					}
				: null,
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

		let chunk = this.chunks.get(job.key)

		if (job.type === 'scenery') {
			if (!chunk) {
				this.stale++
				return
			}
			if (response.scenery) chunk.setScenery(response.scenery)
			this.generated++
			return
		}

		const geometry = createChunkGeometry(response.geometry)

		if (job.type === 'create') {
			if (chunk) {
				geometry.dispose()
				this.stale++
				return
			}
			chunk = this.createChunk(job, geometry)
		} else if (chunk) {
			chunk.replaceGeometry(geometry, job.LOD)
		} else {
			geometry.dispose()
			this.stale++
			return
		}

		if (response.scenery) chunk.setScenery(response.scenery)
		else if (!hasSceneryAtLOD(job.LOD)) chunk.clearScenery()

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
		if (job.type === 'regenerate' || job.type === 'scenery' || job.forceLOD) {
			return true
		}

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
			} else if (hasSceneryAtLOD(chunk.LOD)) {
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
			inFlight: this.inFlight.size,
			created: this.created,
			disposed: this.disposed,
			generated: this.generated,
			stale: this.stale,
			failed: this.failed,
			workers: this.workerPool.size,
			revision: this.revision,
			seed: this.seed,
			sceneryChunks,
			sceneryInstances,
		}
	}

	getCoordsByCamera() {
		const [x, , z] = this.camera.position
		const i = Math.floor(x / this.chunkSize)
		const j = Math.floor(z / this.chunkSize)

		return [i, j]
	}
}
