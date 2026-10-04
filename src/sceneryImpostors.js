import { Group } from 'three'
import { bakeImpostorAtlas } from './impostors/impostorBaker'
import {
	createImpostorMaterial,
	createImpostorWireframeMaterial,
	setImpostorAtlas,
} from './impostors/impostorMaterial'
import { IMPOSTOR_FRAMES_DESKTOP, IMPOSTOR_FRAMES_MOBILE } from './impostors/impostorTypes'
import SceneryMeshes from './impostors/sceneryMeshes'
import { setSceneryWireframe } from './impostors/sceneryWireframe'
import { SCENERY_TYPE_KEYS } from './sceneryPlacement'

// The scenery's impostors and near meshes, as Clouds owns the cloud field's:
// the atlas bake with the wood detail, the impostor material and its
// wireframe twin (every chunk draws its instances with them, src/chunk.js),
// the near meshes (SceneryMeshes, a child), and the live variation and detail
// uniforms. `params` is createAppParams(); impostorDetail, impostorVariation,
// sceneryMeshes, sceneryWireframe, and shadows.taps are read from it.
export default class SceneryImpostors extends Group {
	constructor({ renderer, uniforms, params, woodTexture, isMobile = false }) {
		super()
		this.name = 'scenery-impostors'
		this.renderer = renderer
		this.params = params
		this.woodTexture = woodTexture
		this.isMobile = isMobile
		// Shared with the near meshes; amount is indexed by type.
		this.variation = {
			amount: { value: new Array(Object.keys(SCENERY_TYPE_KEYS).length).fill(0) },
			frequency: { value: params.impostorVariation.frequency },
		}
		this.applyVariation()
		// The near meshes sample the same wood detail the bake applies.
		this.detail = {
			uDetail: { value: woodTexture },
			uDetailScale: { value: params.impostorDetail.scale },
			uDetailColor: { value: params.impostorDetail.color },
		}

		this.material = createImpostorMaterial(this.bake(), uniforms, {
			singleFrame: isMobile,
			variation: this.variation,
			shadowTaps: params.shadows.taps.impostor,
		})
		this.wireframeMaterial = createImpostorWireframeMaterial(
			this.material,
			params.sceneryWireframe.impostorColor,
		)
		this.meshes = new SceneryMeshes({
			uniforms,
			variation: this.variation,
			detail: this.detail,
			settings: params.sceneryMeshes,
			wireframe: params.sceneryWireframe,
			shadowTaps: params.shadows.taps.mesh,
		})
		this.add(this.meshes)
		this.applyWireframe()
	}

	// Every scenery type in the impostor atlas, with the wood detail.
	bake() {
		return bakeImpostorAtlas(this.renderer, {
			frames: this.isMobile ? IMPOSTOR_FRAMES_MOBILE : IMPOSTOR_FRAMES_DESKTOP,
			frameSize: 64,
			detail: { texture: this.woodTexture, ...this.params.impostorDetail },
		})
	}

	// After a wood detail change: the near meshes follow live, the atlas bakes again.
	rebake() {
		this.detail.uDetailScale.value = this.params.impostorDetail.scale
		this.detail.uDetailColor.value = this.params.impostorDetail.color
		setImpostorAtlas(this.material, this.bake())
	}

	applyVariation() {
		const { amount, frequency } = this.params.impostorVariation
		for (const [type, key] of Object.entries(SCENERY_TYPE_KEYS)) {
			this.variation.amount.value[type] = amount[key]
		}
		this.variation.frequency.value = frequency
	}

	applyMeshSettings() {
		this.meshes.applySettings()
	}

	// Shows or recolors the debug wireframe on the near meshes and impostors.
	applyWireframe() {
		this.meshes.applyWireframe()
		const { enabled, impostorColor } = this.params.sceneryWireframe
		setSceneryWireframe(this.wireframeMaterial, enabled, impostorColor)
	}

	// After this frame's scenery commits, with the camera that renders it.
	update(chunks, chunkSize, camera) {
		this.meshes.update(chunks, chunkSize, camera)
	}

	getStats() {
		return this.meshes.getStats()
	}
}
