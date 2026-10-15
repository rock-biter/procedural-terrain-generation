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

test('a click on the click target requests one maneuver at its place', () => {
	const target = new EventTarget()
	const canvas = new EventTarget()
	const input = new FlightInput(target, canvas)
	assert.equal(input.takeClickRequest(), null)
	// Page controls bubble their clicks to window, not to the canvas.
	target.dispatchEvent(pointer('click', { clientY: 100 }))
	assert.equal(input.takeClickRequest(), null)
	canvas.dispatchEvent(pointer('click', { clientX: 500, clientY: 400 }))
	canvas.dispatchEvent(pointer('click', { clientX: 150, clientY: 50 }))
	// The latest, -1 to 1 across the screen like the turn input.
	assert.deepEqual(input.takeClickRequest(), { x: -0.7, yRatio: 0.1 })
	// Spent once taken, however many clicks came in.
	assert.equal(input.takeClickRequest(), null)
	input.enabled = false
	canvas.dispatchEvent(pointer('click', { clientY: 50 }))
	assert.equal(input.takeClickRequest(), null)
	input.enabled = true
	// The wheel counts on the canvas too: scrolling a page control (the
	// lil-gui panel) neither brakes nor turns around.
	target.dispatchEvent(pointer('wheel', { deltaY: -10 }))
	assert.equal(input.takeTurnRequest(), false)
	assert.equal(input.takeRequest(0.01), 0)
	canvas.dispatchEvent(pointer('wheel', { deltaY: -10 }))
	assert.equal(input.takeTurnRequest(), true)
	assert.equal(input.takeRequest(0.01), -1)
})

test('a wheel gesture back asks once to turn around, and a consumed one neither brakes nor asks', () => {
	const target = new EventTarget()
	const input = new FlightInput(target)
	const hold = FLIGHT_LIMITS.wheelHold
	target.dispatchEvent(pointer('wheel', { deltaY: -10 }))
	target.dispatchEvent(pointer('wheel', { deltaY: -10 }))
	assert.equal(input.takeTurnRequest(), true)
	assert.equal(input.takeTurnRequest(), false)
	// Not consumed (too fast to turn around): the gesture brakes.
	assert.equal(input.takeRequest(hold / 2), -1)
	// A gesture forward never asks.
	target.dispatchEvent(pointer('wheel', { deltaY: 10 }))
	assert.equal(input.takeTurnRequest(), false)
	assert.equal(input.takeRequest(hold / 2), 1)

	// After a pause, a new gesture back asks again; consumed, its momentum
	// neither brakes nor asks.
	input.takeRequest(hold)
	target.dispatchEvent(pointer('wheel', { deltaY: -10 }))
	assert.equal(input.takeTurnRequest(), true)
	input.consumeWheelGesture()
	for (let i = 0; i < 5; i++) {
		target.dispatchEvent(pointer('wheel', { deltaY: -10 }))
		assert.equal(input.takeRequest(hold / 4), 0)
		assert.equal(input.takeTurnRequest(), false)
	}
	input.takeRequest(hold)
	target.dispatchEvent(pointer('wheel', { deltaY: -10 }))
	assert.equal(input.takeTurnRequest(), true)
	assert.equal(input.takeRequest(hold / 2), -1)

	// A faint nudge or a sideways swipe back brakes without asking.
	input.takeRequest(hold)
	target.dispatchEvent(pointer('wheel', { deltaY: -2 }))
	assert.equal(input.takeTurnRequest(), false)
	assert.equal(input.takeRequest(hold / 2), -1)
	input.takeRequest(hold)
	target.dispatchEvent(pointer('wheel', { deltaY: -10, deltaX: 30 }))
	assert.equal(input.takeTurnRequest(), false)

	input.clearRequests()
	assert.equal(input.takeRequest(0.01), 0)
	input.enabled = false
	target.dispatchEvent(pointer('wheel', { deltaY: -10 }))
	assert.equal(input.takeTurnRequest(), false)
})

test('dispose removes the listeners', () => {
	const target = new EventTarget()
	const canvas = new EventTarget()
	const input = new FlightInput(target, canvas)
	input.dispose()
	target.dispatchEvent(pointer('wheel', { deltaY: 3 }))
	target.dispatchEvent(pointer('mousemove', { clientX: 900, clientY: 10 }))
	canvas.dispatchEvent(pointer('click', { clientY: 50 }))
	assert.equal(input.takeRequest(0.01), 0)
	assert.equal(input.cursor.x, 0)
	assert.equal(input.takeClickRequest(), null)
})
