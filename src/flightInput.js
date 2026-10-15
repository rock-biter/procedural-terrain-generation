import { Vector2 } from 'three'
import { FLIGHT_LIMITS } from './flightPolicy'

// Pointer, touch, wheel, and click input of the flight. The mouse and touch
// set the turn input (`cursor.x`, -1 to 1) and the pointer's vertical ratio;
// the wheel holds a boost (+1) or brake (-1) request that Plane eases the
// speed effect toward (getNextSpeedEffect()); a click or tap on `clickTarget`
// (the canvas, so page controls never trigger it) requests a barrel roll that
// Plane takes with takeRollRequest(). dispose() removes the listeners.
export default class FlightInput {
	cursor = new Vector2()
	pointerYRatio = (FLIGHT_LIMITS.verticalHoldTop + FLIGHT_LIMITS.verticalHoldBottom) / 2
	enabled = true
	request = 0
	requestTime = 0
	rollRequest = false

	constructor(target = window, clickTarget = target) {
		this.target = target
		this.clickTarget = clickTarget
		this.onMouseMove = (event) => this.setPointer(event.clientX, event.clientY, 1)
		// Touch turns are gentler for the same finger travel.
		this.onTouchMove = (event) => {
			const touch = event.touches[0]
			this.setPointer(touch.clientX, touch.clientY, 1 / 1.5)
		}
		this.onWheel = (event) => {
			if (!this.enabled || event.deltaY === 0) return
			this.request = event.deltaY > 0 ? 1 : -1
			this.requestTime = FLIGHT_LIMITS.wheelHold
		}
		// A steering drag ends without a click, so only a click or tap rolls.
		this.onClick = () => {
			if (this.enabled) this.rollRequest = true
		}
		target.addEventListener('mousemove', this.onMouseMove)
		target.addEventListener('wheel', this.onWheel)
		target.addEventListener('touchmove', this.onTouchMove)
		clickTarget.addEventListener('click', this.onClick)
	}

	setPointer(clientX, clientY, turnScale) {
		if (!this.enabled) return
		this.pointerYRatio = clientY / innerHeight
		this.cursor.set(((clientX / innerWidth) * 2 - 1) * turnScale, 1 - this.pointerYRatio * 2)
	}

	// Back to the neutral input of a fresh start: no turn, the pointer in the
	// middle of the vertical hold band. The ?gui=1 biome map centers the input
	// while the pointer is over it, so the flight holds its course.
	center() {
		this.cursor.set(0, 0)
		this.pointerYRatio = (FLIGHT_LIMITS.verticalHoldTop + FLIGHT_LIMITS.verticalHoldBottom) / 2
	}

	// The wheel request still held after `dt` more seconds, or 0.
	takeRequest(dt) {
		if (this.requestTime <= 0) return 0
		this.requestTime -= dt
		return this.request
	}

	// Whether a roll was requested since the last call; the request is spent
	// either way, so a click during a roll is dropped rather than queued.
	takeRollRequest() {
		const requested = this.rollRequest
		this.rollRequest = false
		return requested
	}

	dispose() {
		this.target.removeEventListener('mousemove', this.onMouseMove)
		this.target.removeEventListener('wheel', this.onWheel)
		this.target.removeEventListener('touchmove', this.onTouchMove)
		this.clickTarget.removeEventListener('click', this.onClick)
	}
}
