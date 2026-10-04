import assert from 'node:assert/strict'
import test from 'node:test'
import { IMPOSTOR_TYPE, IMPOSTOR_TYPE_COUNT } from '../src/impostors/impostorTypes.js'
import {
	SCENERY_PAINT_BASE,
	SCENERY_PAINTED_TYPES,
	SCENERY_PALETTE_KEYS,
	SCENERY_PALETTE_SIZE,
	SCENERY_PALETTE_TYPES,
	createSceneryPaletteSettings,
	getSceneryPaletteLayout,
} from '../src/sceneryPalettePolicy.js'
import { SCENERY_CATEGORIES } from '../src/sceneryPlacement.js'

const HEX = /^#[0-9a-f]{6}$/i
const { ROUND_TREE, CONIFER, CACTUS_ONE_ARM, CACTUS_TWO_ARMS, SEA_ROCK } = IMPOSTOR_TYPE

function layout(settings = createSceneryPaletteSettings()) {
	return getSceneryPaletteLayout(settings, IMPOSTOR_TYPE_COUNT)
}

function slots(values, type) {
	return values.slice(type * SCENERY_PALETTE_SIZE, (type + 1) * SCENERY_PALETTE_SIZE)
}

test('the palettes fit the shader layout', () => {
	// The shader packs one type's weights in a vec4.
	assert.equal(SCENERY_PALETTE_SIZE, 4)
	assert.ok(SCENERY_PAINT_BASE > 0 && SCENERY_PAINT_BASE < 1)
	assert.deepEqual(
		[...SCENERY_PAINTED_TYPES],
		[ROUND_TREE, CONIFER, CACTUS_ONE_ARM, CACTUS_TWO_ARMS, SEA_ROCK],
	)
	assert.deepEqual([...SCENERY_PALETTE_KEYS], ['roundTree', 'conifer', 'cactus', 'seaRock'])
	// Noise groups are scenery categories, and every painted type sits in its own.
	for (const type of SCENERY_PAINTED_TYPES) {
		const { group } = SCENERY_PALETTE_TYPES[type]
		assert.ok(SCENERY_CATEGORIES[group].includes(type), `type ${type} in ${group}`)
	}
	const { colors, weights, trunks, noise } = layout()
	assert.equal(colors.length, IMPOSTOR_TYPE_COUNT * SCENERY_PALETTE_SIZE)
	assert.equal(weights.length, IMPOSTOR_TYPE_COUNT * SCENERY_PALETTE_SIZE)
	assert.equal(trunks.length, IMPOSTOR_TYPE_COUNT)
	assert.equal(noise.length, IMPOSTOR_TYPE_COUNT)
})

test('defaults: four round-tree, three conifer, three cactus, and two sea rock colors, valid hex', () => {
	const settings = createSceneryPaletteSettings()
	const { palettes, noise } = settings
	assert.equal(palettes.roundTree.colors.length, 4)
	assert.equal(palettes.conifer.colors.length, 3)
	assert.equal(palettes.cactus.colors.length, 3)
	assert.equal(palettes.seaRock.colors.length, 2)
	assert.equal(palettes.seaRock.trunk, undefined, 'sea rocks are painted whole')
	assert.equal(palettes.seaRock.byBiome, true, 'one sea rock color per biome')
	assert.deepEqual(
		palettes.seaRock.colors.map(({ label }) => label),
		['Forest', 'Desert'],
	)
	assert.match(palettes.roundTree.trunk, HEX)
	assert.match(palettes.conifer.trunk, HEX)
	assert.equal(palettes.cactus.trunk, undefined, 'cacti are painted whole')
	for (const key of SCENERY_PALETTE_KEYS) {
		for (const { label, color, weight } of palettes[key].colors) {
			assert.ok(label)
			assert.match(color, HEX)
			assert.ok(weight > 0)
		}
	}
	for (const group of ['trees', 'cacti']) {
		assert.ok(noise[group].frequency > 0)
		assert.ok(noise[group].mix >= 0 && noise[group].mix <= 1)
	}
	assert.notEqual(createSceneryPaletteSettings().palettes.cactus, palettes.cactus, 'fresh copies')
})

test('painted types get their palettes, unpainted types stay white with zero weights', () => {
	const { palettes } = createSceneryPaletteSettings()
	const { colors, weights, trunks } = layout()
	const hexes = (key) => palettes[key].colors.map(({ color }) => color)
	assert.deepEqual(slots(colors, ROUND_TREE), hexes('roundTree'))
	assert.deepEqual(slots(colors, CONIFER), [...hexes('conifer'), null])
	assert.deepEqual(slots(weights, CONIFER), [1, 1, 1, 0])
	// Both cactus types share one palette, with no trunk color.
	assert.deepEqual(slots(colors, CACTUS_ONE_ARM), [...hexes('cactus'), null])
	assert.deepEqual(slots(colors, CACTUS_TWO_ARMS), [...hexes('cactus'), null])
	assert.equal(trunks[ROUND_TREE], palettes.roundTree.trunk)
	assert.equal(trunks[CONIFER], palettes.conifer.trunk)
	assert.equal(trunks[CACTUS_ONE_ARM], null)
	assert.deepEqual(slots(colors, SEA_ROCK), [...hexes('seaRock'), null, null])
	assert.deepEqual(slots(weights, SEA_ROCK), [1, 1, 0, 0])
	assert.equal(trunks[SEA_ROCK], null)

	for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
		if (SCENERY_PAINTED_TYPES.includes(type)) continue
		assert.equal(trunks[type], null)
		assert.deepEqual(slots(colors, type), [null, null, null, null])
		assert.deepEqual(slots(weights, type), [0, 0, 0, 0])
	}
})

test('noise follows each group, and shared palettes share their fields', () => {
	const settings = createSceneryPaletteSettings()
	settings.noise.trees = { frequency: 0.01, mix: 0.25 }
	settings.noise.cacti = { frequency: 0.02, mix: 0.75 }
	const { noise } = layout(settings)
	assert.deepEqual(noise[ROUND_TREE], [0.01, 0.25, 0, 0])
	assert.deepEqual(noise[CONIFER], [0.01, 0.25, 1, 0])
	assert.deepEqual(noise[CACTUS_ONE_ARM], [0.02, 0.75, 2, 0])
	assert.deepEqual(noise[CACTUS_TWO_ARMS], noise[CACTUS_ONE_ARM])
	assert.deepEqual(noise[IMPOSTOR_TYPE.BOULDER], [0, 0, 0, 0])
	// The sea rock picks its color by biome, without noise.
	assert.deepEqual(noise[SEA_ROCK], [0, 0, 3, 1])
})

test('weights are clamped, and a painted type always keeps one slot', () => {
	const settings = createSceneryPaletteSettings()
	settings.palettes.roundTree.colors[1].weight = -2
	settings.palettes.roundTree.colors[2].weight = 'x'
	settings.palettes.cactus.colors.forEach((entry) => (entry.weight = 0))
	const { weights } = layout(settings)
	assert.deepEqual(slots(weights, ROUND_TREE), [1, 0, 0, 1])
	assert.deepEqual(slots(weights, CACTUS_ONE_ARM), [1, 0, 0, 0])
	assert.deepEqual(slots(weights, CACTUS_TWO_ARMS), [1, 0, 0, 0])
})

test('missing settings fall back to the defaults and the noise is clamped', () => {
	const defaults = layout()
	const empty = layout({})
	assert.deepEqual(empty.colors, defaults.colors)
	assert.deepEqual(empty.weights, defaults.weights)
	assert.deepEqual(empty.noise, defaults.noise)
	const settings = createSceneryPaletteSettings()
	settings.noise.cacti = { frequency: -1, mix: 3 }
	const clamped = layout(settings)
	assert.deepEqual(clamped.noise[CACTUS_ONE_ARM].slice(0, 2), [0, 1])
})
