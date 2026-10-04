import assert from 'node:assert/strict'
import test from 'node:test'
import { IMPOSTOR_TYPE, IMPOSTOR_TYPE_COUNT } from '../src/impostors/impostorTypes.js'
import {
	SCENERY_PAINT_BASE,
	SCENERY_PAINTED_TYPES,
	SCENERY_PALETTE_SIZE,
	createTreePaletteSettings,
	getSceneryPaletteLayout,
} from '../src/sceneryPalettePolicy.js'
import { SCENERY_TYPE_KEYS } from '../src/sceneryPlacement.js'

const HEX = /^#[0-9a-f]{6}$/i

function layout(settings = createTreePaletteSettings()) {
	return getSceneryPaletteLayout(settings, SCENERY_TYPE_KEYS, IMPOSTOR_TYPE_COUNT)
}

test('the palette fits the shader layout', () => {
	// The shader packs one type's weights in a vec4.
	assert.equal(SCENERY_PALETTE_SIZE, 4)
	assert.ok(SCENERY_PAINT_BASE > 0 && SCENERY_PAINT_BASE < 1)
	assert.deepEqual([...SCENERY_PAINTED_TYPES], [IMPOSTOR_TYPE.ROUND_TREE, IMPOSTOR_TYPE.CONIFER])
	const { colors, weights, trunks } = layout()
	assert.equal(colors.length, IMPOSTOR_TYPE_COUNT * SCENERY_PALETTE_SIZE)
	assert.equal(weights.length, IMPOSTOR_TYPE_COUNT * SCENERY_PALETTE_SIZE)
	assert.equal(trunks.length, IMPOSTOR_TYPE_COUNT)
})

test('defaults: four round-tree colors, three conifer colors, valid hex', () => {
	const settings = createTreePaletteSettings()
	assert.equal(settings.roundTree.colors.length, 4)
	assert.equal(settings.conifer.colors.length, 3)
	for (const key of ['roundTree', 'conifer']) {
		assert.match(settings[key].trunk, HEX)
		for (const { label, color, weight } of settings[key].colors) {
			assert.ok(label)
			assert.match(color, HEX)
			assert.ok(weight > 0)
		}
	}
	assert.ok(settings.frequency > 0)
	assert.ok(settings.mix >= 0 && settings.mix <= 1)
	assert.notEqual(createTreePaletteSettings().roundTree, settings.roundTree, 'fresh copies')
})

test('painted types get their colors, unpainted types stay white with zero weights', () => {
	const settings = createTreePaletteSettings()
	const { colors, weights, trunks } = layout(settings)
	const round = IMPOSTOR_TYPE.ROUND_TREE * SCENERY_PALETTE_SIZE
	const conifer = IMPOSTOR_TYPE.CONIFER * SCENERY_PALETTE_SIZE
	assert.deepEqual(
		colors.slice(round, round + 4),
		settings.roundTree.colors.map(({ color }) => color),
	)
	assert.deepEqual(colors.slice(conifer, conifer + 4), [
		...settings.conifer.colors.map(({ color }) => color),
		null,
	])
	assert.deepEqual(weights.slice(conifer, conifer + 4), [1, 1, 1, 0])
	assert.equal(trunks[IMPOSTOR_TYPE.ROUND_TREE], settings.roundTree.trunk)
	assert.equal(trunks[IMPOSTOR_TYPE.CONIFER], settings.conifer.trunk)

	for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
		if (SCENERY_PAINTED_TYPES.includes(type)) continue
		assert.equal(trunks[type], null)
		for (let slot = 0; slot < SCENERY_PALETTE_SIZE; slot++) {
			assert.equal(colors[type * SCENERY_PALETTE_SIZE + slot], null)
			assert.equal(weights[type * SCENERY_PALETTE_SIZE + slot], 0)
		}
	}
})

test('weights are clamped, and a painted type always keeps one slot', () => {
	const settings = createTreePaletteSettings()
	settings.roundTree.colors[1].weight = -2
	settings.roundTree.colors[2].weight = 'x'
	settings.conifer.colors.forEach((entry) => (entry.weight = 0))
	const { weights } = layout(settings)
	const round = IMPOSTOR_TYPE.ROUND_TREE * SCENERY_PALETTE_SIZE
	const conifer = IMPOSTOR_TYPE.CONIFER * SCENERY_PALETTE_SIZE
	assert.deepEqual(weights.slice(round, round + 4), [1, 0, 0, 1])
	assert.deepEqual(weights.slice(conifer, conifer + 4), [1, 0, 0, 0])
})

test('missing settings fall back to the defaults and the noise is clamped', () => {
	const defaults = layout()
	const empty = layout({})
	assert.deepEqual(empty.colors, defaults.colors)
	assert.deepEqual(empty.weights, defaults.weights)
	assert.equal(empty.frequency, defaults.frequency)
	const clamped = layout({ ...createTreePaletteSettings(), frequency: -1, mix: 3 })
	assert.equal(clamped.frequency, 0)
	assert.equal(clamped.mix, 1)
})
