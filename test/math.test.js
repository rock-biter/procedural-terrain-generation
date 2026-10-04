import assert from 'node:assert/strict'
import test from 'node:test'
import { clamp01, lerp, smoothstep } from '../src/math.js'
import { cellRandom, hashSeed, pickWeighted } from '../src/random.js'

test('smoothstep clamps to exact ends and is symmetric', () => {
	assert.equal(smoothstep(0, 1, -1), 0)
	assert.equal(smoothstep(0, 1, 2), 1)
	assert.equal(smoothstep(0, 1, 0.5), 0.5)
	assert.equal(smoothstep(-1, -0.3, -1), 0)
	assert.ok(Math.abs(smoothstep(2, 4, 3.5) + smoothstep(2, 4, 2.5) - 1) < 1e-12)
	assert.equal(clamp01(-0.2), 0)
	assert.equal(clamp01(1.2), 1)
	assert.equal(lerp(2, 4, 0.25), 2.5)
})

test('seeded randomness is stable and weighted picks follow the weights', () => {
	assert.equal(hashSeed('a'), hashSeed('a'))
	assert.notEqual(hashSeed('a'), hashSeed('b'))
	const value = cellRandom(hashSeed('s'), 3, -7, 2)
	assert.ok(value >= 0 && value < 1)
	assert.equal(cellRandom(hashSeed('s'), 3, -7, 2), value)
	const table = [
		['a', 1],
		['b', 3],
	]
	assert.equal(pickWeighted(table, 0.2), 'a')
	assert.equal(pickWeighted(table, 0.3), 'b')
	assert.equal(pickWeighted(table, 0.999), 'b')
})
