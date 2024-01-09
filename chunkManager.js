import { Vector3 } from 'three'
import Chunk from './chunk'

export default class ChunkManager {
	chunks = {}
	items = []
	lastChunkVisited = null

	constructor(chunkSize, camera, noise, params, scene) {
		this.params = params
		this.noise = noise
		this.camera = camera
		this.chunkSize = chunkSize
		this.scene = scene

		this.init()
	}

	init() {
		const [i, j] = this.getCoordsByCamera()

		this.lastChunkVisited = `${i}|${j}`

		for (let k = i - 4; k <= i + 4; k++) {
			for (let w = j - 4; w <= j + 4; w++) {
				let LOD = 0
				if (Math.abs(k - i) >= 2 || Math.abs(w - j) >= 2) {
					LOD = 1
				}

				if (Math.abs(k - i) >= 3 || Math.abs(w - j) >= 3) {
					LOD = 2
				}
				if (Math.abs(k - i) >= 4 || Math.abs(w - j) >= 4) {
					LOD = 3
				}

				this.createChunk(k, w, LOD)
			}
		}
	}

	createChunk(i, j, LOD) {
		LOD = LOD || this.params.LOD

		if (!this.chunks[`${i}|${j}`]) {
			const position = new Vector3(i, 0, j)
			position.multiplyScalar(this.chunkSize)
			const chunk = new Chunk(
				this.chunkSize,
				this.noise,
				this.params,
				LOD,
				position
			)
			this.chunks[`${i}|${j}`] = chunk
			this.scene.add(chunk)
		}
	}

	async updateChunks() {
		const [i, j] = this.getCoordsByCamera()

		const chunkKey = `${i}|${j}`
		if (chunkKey === this.lastChunkVisited) return
		else this.lastChunkVisited = chunkKey

		for (let k = i - 4; k <= i + 4; k++) {
			for (let w = j - 4; w <= j + 4; w++) {
				let LOD = 0
				if (Math.abs(k - i) >= 2 || Math.abs(w - j) >= 2) {
					LOD = 1
				}

				if (Math.abs(k - i) >= 3 || Math.abs(w - j) >= 3) {
					LOD = 2
				}
				if (Math.abs(k - i) >= 4 || Math.abs(w - j) >= 4) {
					LOD = 3
				}

				const chunk = this.chunks[`${k}|${w}`]
				if (!chunk) this.createChunk(k, w, LOD)
				else chunk.updateLOD(LOD)
			}
		}
	}

	onParamsChange(LOD) {
		for (const key in this.chunks) {
			const chunk = this.chunks[key]
			if (LOD) {
				chunk.updateLOD(LOD)
			} else {
				chunk.updateGeometry()
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
