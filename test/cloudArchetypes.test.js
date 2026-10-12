import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudSources } from '../src/impostors/cloudArchetypes.js'
import { CLOUD_CONFIG } from '../src/cloudPlacement.js'
import { CLOUD_TYPE, CLOUD_TYPE_COUNT } from '../src/impostors/impostorTypes.js'
import { SCENERY_PAINT_BASE } from '../src/sceneryPalettePolicy.js'

const sources = Array.from({ length: CLOUD_TYPE_COUNT }, (_, type) => createCloudSources(type, 2))

test('builds indexed levels with the base on y = 0', () => {
	sources.forEach((levels) => {
		assert.equal(levels.length, 2)
		for (const geometry of levels) {
			assert.ok(geometry.index, 'near meshes need indexed sources')
			for (const name of ['position', 'normal', 'color', 'paint']) {
				assert.ok(geometry.getAttribute(name), name)
			}
			assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-4)
		}
		const [lod0, lod1] = levels
		assert.ok(lod1.index.count < lod0.index.count / 2, 'LOD 1 is much lighter')
		assert.ok(Math.abs(lod0.boundingSphere.center.x) < 1e-4)
		assert.ok(Math.abs(lod0.boundingSphere.center.z) < 1e-4)
	})
})

test('the flat faces look along ±Z', () => {
	sources.forEach(([lod0]) => {
		const normal = lod0.getAttribute('normal')
		let front = 0
		let back = 0
		for (let i = 0; i < normal.count; i++) {
			if (normal.getZ(i) < -0.9999) front++
			if (normal.getZ(i) > 0.9999) back++
		}
		assert.ok(front > 20 && back > 20)
	})
})

test('bakes every cloud in the painted gray, painted whole', () => {
	sources.forEach(([lod0]) => {
		const color = lod0.getAttribute('color')
		const paint = lod0.getAttribute('paint')
		for (let i = 0; i < color.count; i++) {
			assert.equal(paint.getX(i), 1)
			// Neutral gray, at most the painted gray (the palette color is the
			// front face's).
			assert.ok(Math.abs(color.getX(i) - color.getZ(i)) < 1e-6)
			assert.ok(Math.abs(color.getY(i) - color.getZ(i)) < 1e-6)
			assert.ok(color.getX(i) > 0 && color.getX(i) <= SCENERY_PAINT_BASE + 1e-6)
		}
	})
})

test('the tower stacks three slabs, deeper than the others', () => {
	const depth = ([lod0]) => lod0.boundingBox.max.z - lod0.boundingBox.min.z
	const tower = sources[CLOUD_TYPE.TOWER]
	for (const type of [CLOUD_TYPE.BANK, CLOUD_TYPE.HEAP, CLOUD_TYPE.PUFF]) {
		assert.ok(depth(tower) > depth(sources[type]))
		assert.ok(tower[0].boundingBox.max.y > sources[type][0].boundingBox.max.y, 'and taller')
	}
})

test('placement extents bound every source', () => {
	sources.forEach(([lod0], type) => {
		const { min, max } = lod0.boundingBox
		const [halfWidth, height, halfDepth] = CLOUD_CONFIG.extent[type]
		assert.ok(Math.max(-min.x, max.x) <= halfWidth)
		assert.ok(max.y <= height)
		assert.ok(Math.max(-min.z, max.z) <= halfDepth)
	})
})

test('rejects unknown types', () => {
	assert.throws(() => createCloudSources(CLOUD_TYPE_COUNT))
})
