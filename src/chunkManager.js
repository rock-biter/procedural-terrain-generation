import { Vector3 } from 'three'
import Chunk from './chunk'
import { createNoise2D } from 'simplex-noise'
import { getChunkKey, getChunkLOD, getDesiredChunks } from './chunkPolicy'

const isMobile = window.innerWidth < 768

export default class ChunkManager {
	chunks = new Map()
	desired = new Map()
	pending = new Map()
	lastChunkVisited = null
	revision = 0
	created = 0
	disposed = 0
	maxDistance = isMobile ? 4 : 5
	jobsPerFrame = isMobile ? 2 : 3

	constructor(chunkSize, camera, params, scene, uniforms, assets, features) {
		this.params = params
		this.camera = camera
		this.chunkSize = chunkSize
		this.scene = scene
		this.uniforms = uniforms
		this.assets = assets
		this.features = features

		this.noise = []
		for (let i = 0; i < params.octaves; i++) {
			this.noise[i] = createNoise2D()
		}

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

	createChunk(i, j, LOD) {
		const key = getChunkKey(i, j)
		const target = this.desired.get(key)
		const selectedLOD = LOD ?? this.params.LOD

		if (target?.LOD === selectedLOD && !this.chunks.has(key)) {
			const position = new Vector3(i + 0.5, 0, j + 0.5)
			position.multiplyScalar(this.chunkSize)
			const chunk = new Chunk(
				this.chunkSize,
				this.noise,
				this.params,
				selectedLOD,
				position,
				this.uniforms,
				this.assets,
				this.features,
			)
			chunk.coords = [i, j]
			this.chunks.set(key, chunk)
			this.created++
			this.scene.add(chunk)
		}
	}

	processPendingJobs() {
		const jobs = [...this.pending.values()].sort(
			(a, b) => a.distance - b.distance,
		)
		let processed = 0

		for (const job of jobs) {
			if (processed >= this.jobsPerFrame) break
			if (this.pending.get(job.key) !== job) continue

			this.pending.delete(job.key)
			if (!this.isJobCurrent(job)) continue

			const chunk = this.chunks.get(job.key)
			if (job.type === 'create') {
				this.createChunk(job.coords[0], job.coords[1], job.LOD)
			} else if (job.type === 'updateLOD') {
				chunk?.updateLOD(job.LOD)
			} else if (job.type === 'regenerate') {
				chunk?.updateGeometry()
			}

			processed++
			if (job.LOD <= 1 && processed === 1) break
		}
	}

	isJobCurrent(job) {
		if (job.revision !== this.revision) return false

		const target = this.desired.get(job.key)
		if (!target) return false
		if (job.type === 'regenerate' || job.forceLOD) {
			return this.chunks.has(job.key)
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
		for (const [key, chunk] of this.chunks) {
			const target = this.desired.get(key)
			if (!target) continue

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
			pending: this.pending.size,
			created: this.created,
			disposed: this.disposed,
			revision: this.revision,
		}
	}

	getCoordsByCamera() {
		const [x, , z] = this.camera.position
		const i = Math.floor(x / this.chunkSize)
		const j = Math.floor(z / this.chunkSize)

		return [i, j]
	}
}
