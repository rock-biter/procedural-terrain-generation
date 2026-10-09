import assert from 'node:assert/strict'
import test from 'node:test'
import TrailHistory, { getTrailBankFactor, getTrailWidths } from '../src/trailHistory.js'

const forward = { x: 0, y: 0, z: 1 }
const levelWing = { x: 1, y: 0, z: 0 }

test('normalizes the recorded bank from level wings to maximum roll', () => {
	assert.equal(getTrailBankFactor(0), 0)
	assert.equal(getTrailBankFactor(Math.PI / 8), 0.5)
	assert.equal(getTrailBankFactor(-Math.PI / 4), 1)
	assert.equal(getTrailBankFactor(Math.PI / 2), 1)
})

test('shows trails only in sharp turns, caps turn width, and reaches full width at maximum speed', () => {
	const widths = new Float32Array(2)
	getTrailWidths(0.5, 55, 55, widths)
	assert.equal(widths[0], 0)
	assert.equal(widths[1], 0)
	getTrailWidths(0.8, 55, 55, widths)
	assert.ok(widths[1] > widths[0])
	assert.ok(widths[1] < 0.75)
	getTrailWidths(-0.8, 55, 55, widths)
	assert.ok(widths[0] > widths[1])
	getTrailWidths(1, 55, 55, widths)
	assert.equal(widths[1], 0.75)
	assert.ok(widths[0] < 0.75)
	getTrailWidths(0, 110, 55, widths)
	assert.equal(widths[0], widths[1])
	assert.ok(widths[0] > 0)
	getTrailWidths(0, 165, 55, widths)
	assert.equal(widths[0], 1)
	assert.equal(widths[1], 1)
	getTrailWidths(0, 55, 55, widths)
	assert.equal(widths[0], 0)
	assert.equal(widths[1], 0)
})

function center(x, z = 0) {
	return { x, y: 10, z }
}

test('interpolates the moving head and past wing orientation by traveled distance', () => {
	const history = new TrailHistory()
	const row = new Float64Array(13)
	history.push(center(0), forward, levelWing, 0, 0, 0)
	history.push(center(1), forward, levelWing, 1, 0.5, 0)
	history.push(center(2), { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.5, 1, 1)

	history.sample(0, row)
	assert.equal(row[0], 2)
	assert.equal(row[6], 0)
	assert.equal(row[7], 1)
	assert.equal(row[9], 0.5)
	assert.equal(row[10], 1)
	assert.equal(row[11], 1)
	assert.equal(row[12], 2)

	history.sample(0.5, row)
	assert.equal(row[0], 1.5)
	assert.equal(row[3], 0.5)
	assert.equal(row[6], 0.5)
	assert.equal(row[7], 0.5)
	assert.equal(row[9], 0.75)
	assert.equal(row[10], 0.75)
	assert.equal(row[11], 0.5)
	assert.equal(row[12], 1.5)

	history.push(center(2.1), forward, levelWing, 0.25, 0.75, 0)
	history.sample(0, row)
	assert.ok(Math.abs(row[0] - 2.1) < 1e-9)
	assert.equal(row[9], 0.25)
	assert.equal(row[10], 0.75)
	assert.equal(row[11], 0)
})

test('does not grow history while stationary and preserves only the requested trail length', () => {
	const history = new TrailHistory()
	const row = new Float64Array(13)
	history.push(center(0), forward, levelWing, 1, 1, 0, 60)
	for (let i = 0; i < 100; i++) history.push(center(0), forward, levelWing, 0, 0, 0, 60)
	assert.equal(history.count, 1)
	assert.equal(history.availableDistance, 0)

	for (let x = 1; x <= 100; x++)
		history.push(center(x), forward, levelWing, x < 50 ? 1 : 0, 0, 0, 60)
	assert.ok(history.count <= 63)
	assert.ok(history.availableDistance >= 60)
	assert.ok(history.availableDistance < 62)
	history.sample(60, row)
	assert.equal(row[0], 40)
	assert.equal(row[9], 1)
})

test('samples a curved path by distance without skipping the turn', () => {
	const history = new TrailHistory()
	const row = new Float64Array(13)
	history.push(center(0), forward, levelWing, 1, 1, 0)
	history.push(center(10), forward, levelWing, 1, 1, 0)
	history.push(center(10, 10), { x: 1, y: 0, z: 0 }, levelWing, 1, 1, 1)
	history.sample(5, row)
	assert.equal(row[0], 10)
	assert.equal(row[2], 5)
	assert.equal(row[11], 0.5)
	assert.equal(row[12], 15)
	history.sample(15, row)
	assert.equal(row[0], 5)
	assert.equal(row[2], 0)
})

test('starts a new path after clear, without a segment from the old place', () => {
	const history = new TrailHistory()
	const row = new Float64Array(13)
	history.push(center(0), forward, levelWing, 1, 1, 0)
	history.push(center(10), forward, levelWing, 1, 1, 0)
	history.clear()
	assert.equal(history.count, 0)
	assert.equal(history.availableDistance, 0)
	assert.equal(history.sample(0, row), false)

	history.push(center(5000), forward, levelWing, 1, 1, 0)
	history.push(center(5001), forward, levelWing, 1, 1, 0)
	assert.equal(history.availableDistance, 1)
	history.sample(10, row)
	assert.equal(row[0], 5000)
})
