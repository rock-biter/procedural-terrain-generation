import assert from 'node:assert/strict'
import test from 'node:test'
import { createScenerySources } from '../src/impostors/impostorArchetypes.js'
import { IMPOSTOR_TYPE } from '../src/impostors/impostorTypes.js'

const types = Object.values(IMPOSTOR_TYPE)
const sources = types.map((type) => createScenerySources(type, 2))

test('every scenery type builds indexed, vertex-colored levels', () => {
	sources.forEach((levels, index) => {
		assert.equal(levels.length, 2, `type ${types[index]}`)
		for (const geometry of levels) {
			assert.ok(geometry.index, 'near meshes need indexed sources')
			for (const name of ['position', 'normal', 'color']) {
				assert.ok(geometry.getAttribute(name), name)
			}
		}
		const [lod0, lod1] = levels
		assert.ok(lod1.index.count < lod0.index.count, `type ${types[index]}: LOD 1 is lighter`)
	})
})

test('levels share one frame: base at y = 0, sphere centered on the y axis', () => {
	sources.forEach(([lod0, lod1]) => {
		lod0.computeBoundingBox()
		lod1.computeBoundingBox()
		// Cacti and rocks sink their base slightly so slopes never show a gap.
		assert.ok(lod0.boundingBox.min.y <= 1e-4 && lod0.boundingBox.min.y > -0.3, 'base at the ground')
		assert.ok(lod0.boundingBox.max.y > 0)
		assert.ok(Math.abs(lod0.boundingSphere.center.x) < 1e-4)
		assert.ok(Math.abs(lod0.boundingSphere.center.z) < 1e-4)
		// LOD 1 stays inside LOD 0's bounding sphere, which culls both.
		const { center, radius } = lod0.boundingSphere
		assert.ok(
			lod1.boundingSphere.center.distanceTo(center) + lod1.boundingSphere.radius < radius * 1.05,
		)
	})
})
