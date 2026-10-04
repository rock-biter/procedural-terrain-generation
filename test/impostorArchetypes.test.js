import assert from 'node:assert/strict'
import test from 'node:test'
import { createScenerySources } from '../src/impostors/impostorArchetypes.js'
import { IMPOSTOR_TYPE } from '../src/impostors/impostorTypes.js'
import { SCENERY_PAINT_BASE, SCENERY_PAINTED_TYPES } from '../src/sceneryPalettePolicy.js'

const types = Object.values(IMPOSTOR_TYPE)
const sources = types.map((type) => createScenerySources(type, 2))

test('every scenery type builds indexed, vertex-colored levels', () => {
	sources.forEach((levels, index) => {
		assert.equal(levels.length, 2, `type ${types[index]}`)
		for (const geometry of levels) {
			assert.ok(geometry.index, 'near meshes need indexed sources')
			for (const name of ['position', 'normal', 'color', 'paint']) {
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

test('trees mark their crowns and bake a neutral gray; other types keep their colors', () => {
	sources.forEach((levels, index) => {
		const type = types[index]
		const painted = SCENERY_PAINTED_TYPES.includes(type)
		for (const geometry of levels) {
			const paint = geometry.getAttribute('paint')
			const color = geometry.getAttribute('color')
			const position = geometry.getAttribute('position')
			const values = new Set()
			let trunkTop = -Infinity
			let crownBottom = Infinity
			for (let i = 0; i < paint.count; i++) {
				const value = paint.getX(i)
				assert.ok(value === 0 || value === 1, `type ${type}: paint is a 0/1 mask`)
				values.add(value)
				if (value === 0) trunkTop = Math.max(trunkTop, position.getY(i))
				else crownBottom = Math.min(crownBottom, position.getY(i))
				if (painted) {
					const r = color.getX(i)
					assert.ok(Math.abs(r - color.getY(i)) < 1e-6 && Math.abs(r - color.getZ(i)) < 1e-6)
					assert.ok(r > 0 && r <= SCENERY_PAINT_BASE + 1e-6, 'gray at most the paint base')
				}
			}
			if (painted) {
				assert.deepEqual([...values].sort(), [0, 1], `type ${type}: trunk and crown`)
				// The unpainted part is the trunk, under the crown's top.
				assert.ok(trunkTop < geometry.boundingSphere.center.y + geometry.boundingSphere.radius)
				assert.ok(crownBottom < trunkTop, 'the crown sits on the trunk')
			} else {
				assert.deepEqual([...values], [0], `type ${type}: unpainted`)
			}
		}
	})
})
