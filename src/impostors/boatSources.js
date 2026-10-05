import { BufferAttribute, BufferGeometry, SRGBColorSpace } from 'three'
import { SCENERY_CONFIG } from '../sceneryPlacement.js'

// The boat's source levels from its model (public/boat-toy/boat.glb, made by
// scripts/encode-assets.mjs from assets-src/): one mesh per near-mesh level,
// named as below, LOD 0 first, sharing one material whose color map the
// sources keep. World.init() hands them to setCatalogSources() before the
// atlas bake, so the boat is baked and drawn like the built scenery.
export const BOAT_LEVEL_NAMES = Object.freeze(['boat-lod0', 'boat-lod1'])

// A float copy of `attribute`: quantized and normalized values decoded, so
// transforms keep their precision.
function toFloatAttribute(attribute) {
	const { count, itemSize } = attribute
	const array = new Float32Array(count * itemSize)
	for (let index = 0; index < count; index++) {
		for (let component = 0; component < itemSize; component++) {
			array[index * itemSize + component] = attribute.getComponent(index, component)
		}
	}
	return new BufferAttribute(array, itemSize)
}

// [LOD 0, LOD 1] from the loaded glTF scene `model`, in the scenery source
// contract (impostorArchetypes.js): indexed, in one local frame, the keel on
// y = 0 and the bounding sphere centered on the y axis, scaled to
// SCENERY_CONFIG.boat.length along its bow axis (+Z). Each level keeps its uv
// and its `userData.map` (the model's base color), with a white `color` and no
// `paint`: the boat keeps the model's colors.
export function createBoatSources(model) {
	model.updateMatrixWorld(true)
	const levels = BOAT_LEVEL_NAMES.map((name) => {
		const mesh = model.getObjectByName(name)
		if (!mesh?.isMesh) throw new Error(`Boat model without the ${name} mesh`)
		const source = mesh.geometry
		const geometry = new BufferGeometry()
		geometry.setIndex(source.index.clone())
		for (const attribute of ['position', 'normal', 'uv']) {
			geometry.setAttribute(attribute, toFloatAttribute(source.getAttribute(attribute)))
		}
		geometry.applyMatrix4(mesh.matrixWorld)

		const count = geometry.getAttribute('position').count
		geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(1), 3))
		geometry.setAttribute('paint', new BufferAttribute(new Float32Array(count), 1))
		const map = mesh.material.map
		if (map) map.colorSpace = SRGBColorSpace
		geometry.userData.map = map ?? null
		return geometry
	})

	const [lod0] = levels
	lod0.computeBoundingBox()
	// Copied: every transform below recomputes LOD 0's box in place.
	const { min, max } = lod0.boundingBox
	const keelY = min.y
	const scale = SCENERY_CONFIG.boat.length / (max.z - min.z)
	for (const geometry of levels) {
		geometry.translate(0, -keelY, 0)
		geometry.scale(scale, scale, scale)
	}
	lod0.computeBoundingSphere()
	const { x, z } = lod0.boundingSphere.center
	for (const geometry of levels) {
		geometry.translate(-x, 0, -z)
		geometry.computeBoundingBox()
		geometry.computeBoundingSphere()
	}
	return levels
}
