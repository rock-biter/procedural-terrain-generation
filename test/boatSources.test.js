import assert from 'node:assert/strict'
import test from 'node:test'
import {
	BoxGeometry,
	BufferAttribute,
	Group,
	Mesh,
	MeshStandardMaterial,
	SRGBColorSpace,
	Texture,
} from 'three'
import { BOAT_LEVEL_NAMES, createBoatSources } from '../src/impostors/boatSources.js'
import { getCatalogSources, setCatalogSources } from '../src/impostors/impostorCatalogs.js'
import { SCENERY_MESH_LOD_COUNT } from '../src/sceneryMeshPolicy.js'
import { SCENERY_CONFIG } from '../src/sceneryPlacement.js'

// A stand-in for the loaded boat: LOD 0 moved by its node, LOD 1 with
// quantized positions (normalized int16, as gltfpack writes them), both a
// model-sized box centered on the origin like the real one.
function createModel() {
	const map = new Texture()
	const material = new MeshStandardMaterial({ map })
	const lod0 = new Mesh(new BoxGeometry(0.6, 0.45, 1, 4, 4, 4), material)
	lod0.name = BOAT_LEVEL_NAMES[0]
	lod0.position.set(5, 3, -2)

	const box = new BoxGeometry(0.6, 0.45, 1)
	const position = box.getAttribute('position')
	const quantized = new Int16Array(position.array.length)
	position.array.forEach((value, index) => (quantized[index] = Math.round(value * 32767)))
	box.setAttribute('position', new BufferAttribute(quantized, 3, true))
	const lod1 = new Mesh(box, material)
	lod1.name = BOAT_LEVEL_NAMES[1]
	lod1.position.copy(lod0.position)

	const model = new Group()
	model.add(lod0, lod1)
	return { model, map }
}

test('turns the boat model into scenery source levels', () => {
	const { model, map } = createModel()
	const levels = createBoatSources(model)
	assert.equal(levels.length, SCENERY_MESH_LOD_COUNT)
	const { length } = SCENERY_CONFIG.boat
	for (const geometry of levels) {
		assert.ok(geometry.index)
		for (const name of ['position', 'normal', 'uv', 'color', 'paint']) {
			assert.ok(geometry.getAttribute(name), name)
		}
		assert.ok(geometry.getAttribute('position').array instanceof Float32Array)
		// The keel on y = 0, the length along the bow axis, centered.
		const { min, max } = geometry.boundingBox
		assert.ok(Math.abs(min.y) < 1e-3, `keel at ${min.y}`)
		assert.ok(Math.abs(max.z - min.z - length) < 1e-2, `length ${max.z - min.z}`)
		assert.ok(Math.abs(geometry.boundingSphere.center.x) < 1e-3)
		assert.ok(Math.abs(geometry.boundingSphere.center.z) < 1e-3)
		// The model's colors: a white vertex color and no palette paint.
		assert.ok(geometry.getAttribute('color').array.every((value) => value === 1))
		assert.ok(geometry.getAttribute('paint').array.every((value) => value === 0))
		assert.equal(geometry.userData.map, map)
	}
	assert.equal(map.colorSpace, SRGBColorSpace)
	assert.ok(levels[1].index.count < levels[0].index.count)
})

test('rejects a boat model without its levels', () => {
	const { model } = createModel()
	model.remove(model.getObjectByName(BOAT_LEVEL_NAMES[1]))
	assert.throws(() => createBoatSources(model), /boat-lod1/)
})

test('model sources replace a catalog type only before it is built', () => {
	const built = new BoxGeometry()
	const catalog = {
		name: 'model-test',
		createSources: () => [built, built],
	}
	const { model } = createModel()
	assert.throws(() => setCatalogSources(catalog, 0, [built]), /needs 2 levels/)
	const levels = createBoatSources(model)
	setCatalogSources(catalog, 0, levels)
	assert.equal(getCatalogSources(catalog, 0), levels)
	assert.throws(() => setCatalogSources(catalog, 0, createBoatSources(model)), /already built/)
})
