import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createRandomSeed,
	normalizeWorldSeed,
	parseWorldSeed,
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
	assert.equal(createRandomSeed(() => 0), '00000000')
	assert.equal(createRandomSeed(() => 0.999999), 'zzzzzzzz')

	const values = [0.1, 0.5, 0.9]
	let call = 0
	const random = () => values[call++ % values.length]
	assert.equal(createRandomSeed(random), '3iw3iw3i')
})
