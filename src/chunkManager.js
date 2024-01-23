import { Vector2, Vector3 } from 'three'
import Chunk from './chunk'
import { createNoise2D } from 'simplex-noise'
const _V = new Vector2(0, 0)
const isMobile = window.innerWidth < 768

export default class ChunkManager {
	chunks = {}
	chunkKeys = []
	items = []
	lastChunkVisited = null
	pool = []
	maxDistance = isMobile ? 4 : 5

	constructor(chunkSize, camera, params, scene, uniforms, assets) {
		this.params = params
		this.camera = camera
		this.chunkSize = chunkSize
		this.scene = scene
		this.uniforms = uniforms
		this.assets = assets

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

	isOutOfRange(k, w, [i, j]) {
		// const [i, j] = this.getCoordsByCamera()
		const distance = _V.set(k - i, w - j).length()

		return distance > this.maxDistance
	}

	lookForDistantChunks() {
		const [i, j] = this.getCoordsByCamera()
		const keys = []
		const validKeys = []

		for (const key of this.chunkKeys) {
			const chunk = this.chunks[key]
			const [k, w] = chunk.coords

			if (this.isOutOfRange(k, w, [i, j])) {
				keys.push(key)
			} else {
				validKeys.push(key)
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

		this.chunkKeys = validKeys
		// console.log(validKeys)

		// keys.forEach((key) => {
		// 	const chunk = this.chunks[key]
		// 	if (chunk === undefined) return

		// 	this.pool.push({
		// 		id: key,
		// 		LOD: 100,
		// 		coords: [0, 0],
		// 		callback: () => chunk.dispose(),
		// 	})

		// 	// delete this.chunks[key]
		// })

		this.pool = this.pool.filter((el) => !keys.includes(el.key))
	}

	createChunk(i, j, LOD) {
		LOD = LOD || this.params.LOD

		if (this.chunks[`${i}|${j}`] === undefined) {
			const position = new Vector3(i + 0.5, 0, j + 0.5)
			position.multiplyScalar(this.chunkSize)
			const chunk = new Chunk(
				this.chunkSize,
				this.noise,
				this.params,
				LOD,
				position,
				this.uniforms,
				this.assets
			)
			chunk.coords = [i, j]
			this.chunks[`${i}|${j}`] = chunk
			this.chunkKeys.push(`${i}|${j}`)
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

		const currentChunkKey = `${i}|${j}`
		if (currentChunkKey === this.lastChunkVisited) {
			for (let g = 0; g < (isMobile ? 2 : 3); g++) {
				const { callback, LOD } = this.pool.pop() || {}
				if (callback) {
					callback()
				}

				count++

				if (LOD <= 1 && count === 1) {
					break
				}
			}

			return
		} else {
			// console.log('new chunk')
			this.lastChunkVisited = currentChunkKey
		}

		for (let k = i - this.maxDistance + 1; k <= i + this.maxDistance + 1; k++) {
			for (
				let w = j - this.maxDistance + 1;
				w <= j + this.maxDistance + 1;
				w++
			) {
				const key = `${k}|${w}`
				const chunk = this.chunks[key]

				if (this.isOutOfRange(k, w, [i, j])) {
					if (chunk) {
						// console.log('dispose')
						this.disposeChunk(chunk, key)
					}
					continue
				}

				_V.set(k - i, w - j)
				const LOD = this.getLODbyCoords(k, w)

				const indexOf = this.pool.findIndex((el) => el.id === key)
				// const inPool = this.pool.findIndex((el) => el.key === key)
				// if (inPool >= 0) {
				// 	this.pool.splice(inPool, 1)
				// }
				let el

				if (chunk === undefined) {
					// this.createChunk(k, w, LOD)
					el = {
						key,
						coords: [k, w],
						LOD,
						callback: () => this.createChunk(k, w, LOD),
					}

					// this.createChunk(k, w, LOD)
				} else {
					// const indexOf = this.pool.findIndex((el) => el.id === key)
					el = {
						id: key,
						LOD: LOD,
						coords: [k, w],
						callback: () => chunk.updateLOD(LOD),
					}
				}

				if (indexOf >= 0) {
					this.pool[indexOf] = el
				} else {
					this.pool.push(el)
				}
			}
		}

		// this.lookForDistantChunks()
	}

	disposeChunk(chunk, key) {
		chunk.dispose()
		// delete this.chunks[key]
		this.chunks[key] = undefined
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
