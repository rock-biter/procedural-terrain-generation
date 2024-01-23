import { Vector2, Vector3 } from 'three'
import Chunk from './chunk'
import { createNoise2D } from 'simplex-noise'
const _V = new Vector2(0, 0)

export default class ChunkManager {
	chunks = {}
	items = []
	lastChunkVisited = null
	pool = []
	maxDistance = 8

	constructor(chunkSize, camera, params, scene, uniforms) {
		this.params = params
		this.camera = camera
		this.chunkSize = chunkSize
		this.scene = scene
		this.uniforms = uniforms

		this.noise = []
		for (let i = 0; i < params.octaves; i++) {
			this.noise[i] = createNoise2D()
		}

		this.init()
	}

	init() {
		const [i, j] = this.getCoordsByCamera()
		this.updateChunks()
	}

	getLODbyCoords(k, w) {
		const [i, j] = this.getCoordsByCamera()

		return Math.floor(_V.set(k - i, w - j).length() * 0.7)
	}

	isOutOfRange(k, w) {
		const [i, j] = this.getCoordsByCamera()
		const distance = _V.set(k - i, w - j).length()

		return distance > this.maxDistance
	}

	lookForDistantChunks() {
		const [i, j] = this.getCoordsByCamera()
		const keys = []

		for (const key in this.chunks) {
			const chunk = this.chunks[key]
			const [k, w] = chunk.coords

			if (this.isOutOfRange(k, w)) {
				keys.push(key)
			} else {
				const LOD = this.getLODbyCoords(k, w)

				const indexOf = this.pool.findIndex((el) => el.id === key)
				const newEl = {
					id: key,
					LOD: LOD,
					coords: [k, w],
					callback: () => chunk.updateLOD(LOD),
				}
				if (indexOf >= 0) {
					this.pool[indexOf] = newEl
				} else {
					this.pool.push(newEl)
				}
			}
		}

		keys.forEach((key) => {
			const chunk = this.chunks[key]
			chunk.dispose()

			delete this.chunks[key]
		})

		this.pool = this.pool.filter((el) => !keys.includes(el.key))
	}

	createChunk(i, j, LOD) {
		LOD = LOD || this.params.LOD

		if (!this.chunks[`${i}|${j}`]) {
			const position = new Vector3(i + 0.5, 0, j + 0.5)
			position.multiplyScalar(this.chunkSize)
			const chunk = new Chunk(
				this.chunkSize,
				this.noise,
				this.params,
				LOD,
				position,
				this.uniforms
			)
			chunk.coords = [i, j]
			this.chunks[`${i}|${j}`] = chunk
			this.scene.add(chunk)
		}
	}

	async updateChunks() {
		const [i, j] = this.getCoordsByCamera()

		this.pool.sort((a, b) => {
			const aL = Math.sqrt((a.coords[0] - i) ** 2 + (a.coords[1] - j) ** 2)
			const bL = Math.sqrt((b.coords[0] - i) ** 2 + (b.coords[1] - j) ** 2)
			return bL - aL
		})

		let count = 0

		const chunkKey = `${i}|${j}`
		if (chunkKey === this.lastChunkVisited) {
			for (let g = 0; g < 6; g++) {
				const { callback, LOD } = this.pool.pop() || {}
				if (callback) {
					callback()
				}

				count++

				if (LOD <= 1 && count === 2) {
					break
				}
			}

			return
		} else this.lastChunkVisited = chunkKey

		for (let k = i - this.maxDistance; k <= i + this.maxDistance; k++) {
			for (let w = j - this.maxDistance; w <= j + this.maxDistance; w++) {
				const key = `${k}|${w}`
				const chunk = this.chunks[key]

				if (this.isOutOfRange(k, w)) continue

				_V.set(k - i, w - j)
				const LOD = this.getLODbyCoords(k, w)

				const inPool = this.pool.findIndex((el) => el.key === key)
				if (inPool >= 0) {
					this.pool.splice(inPool, 1)
				}

				if (!chunk) {
					// this.createChunk(k, w, LOD)
					this.pool.push({
						key,
						coords: [k, w],
						LOD,
						callback: () => this.createChunk(k, w, LOD),
					})

					// this.createChunk(k, w, LOD)
				}
			}
		}

		this.lookForDistantChunks()
	}

	onParamsChange(LOD) {
		for (const key in this.chunks) {
			const chunk = this.chunks[key]
			if (LOD) {
				// chunk.updateLOD(LOD)
				this.pool.push({
					coords: [0, 0],
					callback: () => chunk.updateLOD(LOD),
				})
			} else {
				this.pool.push({
					coords: [0, 0],
					callback: () => chunk.updateGeometry(),
				})
			}
		}
	}

	getCoordsByCamera() {
		const [x, , z] = this.camera.position
		const i = Math.floor(x / this.chunkSize)
		const j = Math.floor(z / this.chunkSize)

		return [i, j]
	}
}
