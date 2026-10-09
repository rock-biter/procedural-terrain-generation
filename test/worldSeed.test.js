import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createRandomSeed,
	CURATED_SEEDS,
	normalizeWorldSeed,
	parseWorldSeed,
	pickCuratedSeed,
} from '../src/worldSeed.js'

test('parses the seed query parameter', () => {
	assert.equal(parseWorldSeed(new URLSearchParams('?seed=s762')), 's762')
	assert.equal(parseWorldSeed(new URLSearchParams('?seed=%20g7%20')), 'g7')
	assert.equal(parseWorldSeed(new URLSearchParams('?seed=')), null)
	assert.equal(parseWorldSeed(new URLSearchParams('?seed=%20%20')), null)
	assert.equal(parseWorldSeed(new URLSearchParams('?gui=1')), null)
})

test('normalizes GUI seed values', () => {
	assert.equal(normalizeWorldSeed('abc'), 'abc')
	assert.equal(normalizeWorldSeed('  abc  '), 'abc')
	assert.equal(normalizeWorldSeed(42), '42')
	assert.equal(normalizeWorldSeed(''), null)
	assert.equal(normalizeWorldSeed('   '), null)
	assert.equal(normalizeWorldSeed(null), null)
	assert.equal(normalizeWorldSeed(undefined), null)
})

test('creates short base-36 random seeds', () => {
	assert.match(createRandomSeed(), /^[0-9a-z]{8}$/)
	assert.equal(
		createRandomSeed(() => 0),
		'00000000',
	)
	assert.equal(
		createRandomSeed(() => 0.999999),
		'zzzzzzzz',
	)

	const values = [0.1, 0.5, 0.9]
	let call = 0
	const random = () => values[call++ % values.length]
	assert.equal(createRandomSeed(random), '3iw3iw3i')
})

test('picks the starting seed from the curated list', () => {
	assert.equal(CURATED_SEEDS.length, new Set(CURATED_SEEDS).size)
	for (const seed of CURATED_SEEDS) assert.equal(normalizeWorldSeed(seed), seed)
	assert.equal(
		pickCuratedSeed(() => 0),
		CURATED_SEEDS[0],
	)
	assert.equal(
		pickCuratedSeed(() => 0.999999),
		CURATED_SEEDS.at(-1),
	)
	assert.equal(
		pickCuratedSeed(() => 1),
		CURATED_SEEDS.at(-1),
	)
	assert.equal(
		pickCuratedSeed(() => 0.5),
		CURATED_SEEDS[Math.floor(CURATED_SEEDS.length / 2)],
	)
})
