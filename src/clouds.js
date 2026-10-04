import { Group, Vector2 } from 'three'
import { bakeImpostorAtlas } from './impostors/impostorBaker'
import { CLOUD_IMPOSTORS } from './impostors/impostorCatalogs'
import {
	createImpostorMaterial,
	createImpostorMesh,
	createImpostorWireframeMaterial,
	setImpostorAtlas,
} from './impostors/impostorMaterial'
import { createFrontalViews } from './impostors/octahedral'
import {
	CLOUD_IMPOSTOR_VIEWS,
	CLOUD_IMPOSTOR_FRAME_SIZE_DESKTOP,
	CLOUD_IMPOSTOR_FRAME_SIZE_MOBILE,
	CLOUD_TYPE_COUNT,
} from './impostors/impostorTypes'
import SceneryMeshes from './impostors/sceneryMeshes'
import { setSceneryWireframe } from './impostors/sceneryWireframe'
import { SCENERY_MESH_DISABLED_RANGE } from './sceneryMeshPolicy'
import {
	CLOUD_CONFIG,
	CLOUD_TYPE_KEYS,
	generateCloudInstances,
	getCloudCell,
	getCloudFarFade,
} from './cloudPlacement'

// World-level cloud field around the airplane, independent of terrain chunks.
// Clouds are placed on a deterministic grid (src/cloudPlacement.js) whenever
// the airplane enters a new cloud cell, the seed, or the placement settings
// change, and drawn like the scenery: one octahedral impostor quad per cloud
// (frontal-band atlas, a single draw call) handed over near the eye to the
// real meshes in two levels of detail (SceneryMeshes with CLOUD_IMPOSTORS).
// Clouds receive no shadows; src/cloudShadows.js makes them cast theirs.
//
// Ownership: this object owns the cloud atlas, impostor material and mesh,
// near meshes, and its own uniforms. `uniforms` is the shared object (src/sharedUniforms.js)
// (uCamera, uCurvature, uAtmosphere, uTime, and the shadow uniforms the shared
// shader chunks declare); a copy carries the clouds' own uSceneryMeshRange.
// `settings` is params.clouds ({ placement, meshes, detail, ambient,
// variation }), `wireframe` the shared scenery wireframe settings, and
// `woodTexture` the shared wood color map.
export default class Clouds extends Group {
	constructor({ renderer, uniforms, settings, wireframe, woodTexture, seed, isMobile = false }) {
		super()
		this.name = 'clouds'
		this.renderer = renderer
		this.settings = settings
		this.wireframe = wireframe
		this.seed = seed
		this.isMobile = isMobile
		this.woodTexture = woodTexture
		this.instances = new Float32Array(0)
		// Bumped on every regeneration; cloud shadows re-render on a change.
		this.revision = 0
		this.cell = null
		this.dirty = true
		this.impostors = null
		this.lastRegenerateMs = 0

		this.farFade = { value: new Vector2() }
		this.ambient = { value: settings.ambient }
		this.variation = {
			amount: { value: new Array(CLOUD_TYPE_COUNT).fill(0) },
			frequency: { value: settings.variation.frequency },
		}
		this.detail = {
			uDetail: { value: woodTexture },
			uDetailScale: { value: settings.detail.scale },
			uDetailColor: { value: settings.detail.color },
		}
		// The near meshes write this range; the impostor reads it.
		this.uniforms = {
			...uniforms,
			uSceneryMeshRange: { value: new Vector2(...SCENERY_MESH_DISABLED_RANGE) },
		}
		this.applyAppearance()

		this.material = createImpostorMaterial(this.bake(), this.uniforms, {
			singleFrame: isMobile,
			variation: this.variation,
			receiveShadows: false,
			farFade: this.farFade,
			ambientScale: this.ambient,
		})
		this.wireframeMaterial = createImpostorWireframeMaterial(this.material, wireframe.impostorColor)
		this.meshes = new SceneryMeshes({
			uniforms: this.uniforms,
			variation: this.variation,
			detail: this.detail,
			settings: settings.meshes,
			wireframe,
			catalog: CLOUD_IMPOSTORS,
			receiveShadows: false,
			ambientScale: this.ambient,
		})
		this.add(this.meshes)
		this.applyWireframe()
	}

	bake() {
		return bakeImpostorAtlas(this.renderer, {
			catalog: CLOUD_IMPOSTORS,
			// Clouds face the airplane, so only frontal views are baked.
			views: createFrontalViews(CLOUD_IMPOSTOR_VIEWS),
			frameSize: this.isMobile
				? CLOUD_IMPOSTOR_FRAME_SIZE_MOBILE
				: CLOUD_IMPOSTOR_FRAME_SIZE_DESKTOP,
			detail: { texture: this.woodTexture, ...this.settings.detail },
		})
	}

	// Re-bakes the atlas after a wood detail change.
	rebake() {
		this.detail.uDetailScale.value = this.settings.detail.scale
		this.detail.uDetailColor.value = this.settings.detail.color
		setImpostorAtlas(this.material, this.bake())
	}

	// Re-places the clouds on the next update (placement settings changed).
	applySettings() {
		this.dirty = true
	}

	// Re-reads the near-mesh distance bands.
	applyMeshSettings() {
		this.meshes.applySettings()
	}

	// Re-reads the ambient boost and the brightness variation.
	applyAppearance() {
		this.ambient.value = this.settings.ambient
		const { amount, frequency } = this.settings.variation
		for (const [type, key] of Object.entries(CLOUD_TYPE_KEYS)) {
			this.variation.amount.value[type] = amount[key]
		}
		this.variation.frequency.value = frequency
	}

	// Shows or recolors the debug wireframe on the near meshes and impostors.
	applyWireframe() {
		this.meshes.applyWireframe()
		const { enabled, impostorColor } = this.wireframe
		setSceneryWireframe(this.wireframeMaterial, enabled, impostorColor)
	}

	setSeed(seed) {
		if (seed === this.seed) return
		this.seed = seed
		this.dirty = true
	}

	// Runs every frame before rendering, with the airplane position and the
	// camera that will render.
	update(position, camera) {
		const { cellSize } = CLOUD_CONFIG
		const [cellX, cellZ] = getCloudCell(position.x, position.z, cellSize)
		if (this.dirty || !this.cell || this.cell[0] !== cellX || this.cell[1] !== cellZ) {
			this.cell = [cellX, cellZ]
			this.regenerate((cellX + 0.5) * cellSize, (cellZ + 0.5) * cellSize)
		}

		if (this.meshes.beginUpdate(camera)) this.meshes.appendInstances(this.instances, 0, 0, 0)
		this.meshes.endUpdate()
	}

	regenerate(centerX, centerZ) {
		const startTime = performance.now()
		this.dirty = false
		const { placement } = this.settings
		this.instances = generateCloudInstances({
			seed: this.seed,
			centerX,
			centerZ,
			settings: placement,
		})
		this.farFade.value.fromArray(getCloudFarFade(placement.radius))

		this.clearImpostors()
		if (this.instances.length > 0) {
			// Bases are in world space, so the mesh stays at the origin. The
			// field always surrounds the eye, so it is never frustum-culled.
			this.impostors = createImpostorMesh(
				this.instances,
				this.material,
				placement.radius,
				this.wireframeMaterial,
			)
			this.impostors.name = 'cloud-impostors'
			this.impostors.frustumCulled = false
			for (const child of this.impostors.children) {
				child.name = 'cloud-impostors-wireframe'
				child.frustumCulled = false
			}
			this.add(this.impostors)
		}
		this.revision++
		this.lastRegenerateMs = performance.now() - startTime
	}

	clearImpostors() {
		if (!this.impostors) return
		this.remove(this.impostors)
		this.impostors.geometry.dispose()
		this.impostors = null
	}

	getStats() {
		const { atlas } = this.material.userData
		return {
			instances: this.impostors?.geometry.instanceCount ?? 0,
			cell: this.cell,
			revision: this.revision,
			regenerateMs: this.lastRegenerateMs,
			atlas: {
				views: [atlas.views.framesX, atlas.views.framesY],
				frameSize: atlas.frameSize,
				width: atlas.target.width,
				height: atlas.target.height,
			},
			meshes: this.meshes.getStats(),
		}
	}

	dispose() {
		this.removeFromParent()
		this.clearImpostors()
		this.meshes.dispose()
		this.material.userData.atlas.dispose()
		this.material.dispose()
		this.wireframeMaterial.dispose()
	}
}
