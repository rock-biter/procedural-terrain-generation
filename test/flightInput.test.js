import assert from 'node:assert/strict'
import test from 'node:test'
import FlightInput from '../src/flightInput.js'
import { FLIGHT_LIMITS } from '../src/flightPolicy.js'

globalThis.innerWidth = 1000
globalThis.innerHeight = 500

const pointer = (type, fields) => Object.assign(new Event(type), fields)

test('the pointer sets the turn input and the vertical ratio', () => {
	const target = new EventTarget()
	const input = new FlightInput(target)
	target.dispatchEvent(pointer('mousemove', { clientX: 750, clientY: 100 }))
	assert.equal(input.cursor.x, 0.5)
	assert.equal(input.pointerYRatio, 0.2)
	// Touch turns are gentler for the same travel.
	target.dispatchEvent(pointer('touchmove', { touches: [{ clientX: 1000, clientY: 250 }] }))
	assert.ok(Math.abs(input.cursor.x - 1 / 1.5) < 1e-12)
	input.enabled = false
	target.dispatchEvent(pointer('mousemove', { clientX: 0, clientY: 0 }))
	assert.equal(input.pointerYRatio, 0.5)
})

test('a wheel event holds its request for a short time', () => {
	const target = new EventTarget()
	const input = new FlightInput(target)
	assert.equal(input.takeRequest(0.1), 0)
	target.dispatchEvent(pointer('wheel', { deltaY: -3 }))
	assert.equal(input.takeRequest(FLIGHT_LIMITS.wheelHold / 2), -1)
	assert.equal(input.takeRequest(FLIGHT_LIMITS.wheelHold / 2), -1)
	assert.equal(input.takeRequest(0.01), 0)
})

test('a click on the click target requests one barrel roll', () => {
	const target = new EventTarget()
	const canvas = new EventTarget()
	const input = new FlightInput(target, canvas)
	assert.equal(input.takeRollRequest(), false)
	// Page controls bubble their clicks to window, not to the canvas.
	target.dispatchEvent(new Event('click'))
	assert.equal(input.takeRollRequest(), false)
	canvas.dispatchEvent(new Event('click'))
	canvas.dispatchEvent(new Event('click'))
	assert.equal(input.takeRollRequest(), true)
	// Spent once taken, however many clicks came in.
	assert.equal(input.takeRollRequest(), false)
	input.enabled = false
	canvas.dispatchEvent(new Event('click'))
	assert.equal(input.takeRollRequest(), false)
})

test('dispose removes the listeners', () => {
	const target = new EventTarget()
	const canvas = new EventTarget()
	const input = new FlightInput(target, canvas)
	input.dispose()
	target.dispatchEvent(pointer('wheel', { deltaY: 3 }))
	target.dispatchEvent(pointer('mousemove', { clientX: 900, clientY: 10 }))
	canvas.dispatchEvent(new Event('click'))
	assert.equal(input.takeRequest(0.01), 0)
	assert.equal(input.cursor.x, 0)
	assert.equal(input.takeRollRequest(), false)
})
