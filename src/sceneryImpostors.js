import { Group, Vector3 } from 'three'
import { bakeImpostorAtlas } from './impostors/impostorBaker'
import {
	createImpostorMaterial,
	createImpostorWireframeMaterial,
	createSceneryPaletteUniforms,
	setImpostorAtlas,
} from './impostors/impostorMaterial'
import {
	IMPOSTOR_FRAMES_DESKTOP,
	IMPOSTOR_FRAMES_MOBILE,
	IMPOSTOR_TYPE_COUNT,
} from './impostors/impostorTypes'
import SceneryMeshes from './impostors/sceneryMeshes'
import { setSceneryWireframe } from './impostors/sceneryWireframe'
import {
	SCENERY_PAINT_BASE,
	SCENERY_PALETTE_SIZE,
	getSceneryPaletteLayout,
} from './sceneryPalettePolicy'
import { SCENERY_TYPE_KEYS } from './sceneryPlacement'

// The scenery's impostors and near meshes, as Clouds owns the cloud field's:
// the atlas bake with the wood detail, the impostor material and its
// wireframe twin (every chunk draws its instances with them, src/chunk.js),
// the near meshes (SceneryMeshes, a child), and the live variation, palette,
// and detail uniforms. `params` is createAppParams(); impostorDetail,
// impostorVariation, sceneryPalette, sceneryMeshes, sceneryWireframe, and
// shadows.taps are read from it.
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
		// Shared with the near meshes: the trees' trunk colors and the tree and
		// cactus palettes.
		this.palette = createSceneryPaletteUniforms(IMPOSTOR_TYPE_COUNT)
		this.applyPalette()
		// The near meshes sample the same wood detail the bake applies, one
		// setting per type.
		this.detail = {
			uDetail: { value: woodTexture },
			uSceneryDetail: { value: Array.from({ length: IMPOSTOR_TYPE_COUNT }, () => new Vector3()) },
		}
		this.applyDetail()

		this.material = createImpostorMaterial(this.bake(), uniforms, {
			singleFrame: isMobile,
			variation: this.variation,
			palette: this.palette,
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
			palette: this.palette,
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
			detail: {
				texture: this.woodTexture,
				types: Array.from(
					{ length: IMPOSTOR_TYPE_COUNT },
					(_, type) => this.params.impostorDetail[SCENERY_TYPE_KEYS[type]],
				),
			},
		})
	}

	// After a wood detail change: the near meshes follow live, the atlas bakes again.
	rebake() {
		this.applyDetail()
		setImpostorAtlas(this.material, this.bake())
	}

	// Copies the per-type wood detail settings into the near meshes' uniforms.
	applyDetail() {
		this.detail.uSceneryDetail.value.forEach((settings, type) => {
			const { scale, color, normalized } = this.params.impostorDetail[SCENERY_TYPE_KEYS[type]]
			settings.set(scale, color, normalized ? 1 : 0)
		})
	}

	// Writes the scenery palettes into the shared uniforms, live: colors become
	// linear (Color.set() converts the sRGB hex) and are divided by the gray
	// the painted types are baked in; unused entries stay white.
	applyPalette() {
		const layout = getSceneryPaletteLayout(this.params.sceneryPalette, IMPOSTOR_TYPE_COUNT)
		const setPaint = (color, hex) => {
			if (hex === null) color.setRGB(1, 1, 1)
			else color.set(hex).multiplyScalar(1 / SCENERY_PAINT_BASE)
		}
		const {
			uSceneryPaletteColors,
			uSceneryPaletteWeights,
			uSceneryTrunkColors,
			uSceneryPaletteNoise,
		} = this.palette
		uSceneryPaletteColors.value.forEach((color, index) => setPaint(color, layout.colors[index]))
		uSceneryTrunkColors.value.forEach((color, type) => setPaint(color, layout.trunks[type]))
		uSceneryPaletteWeights.value.forEach((weights, type) =>
			weights.fromArray(layout.weights, type * SCENERY_PALETTE_SIZE),
		)
		uSceneryPaletteNoise.value.forEach((noise, type) => noise.fromArray(layout.noise[type]))
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
