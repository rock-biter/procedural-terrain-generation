import { Vector2 } from 'three'
import { FLIGHT_LIMITS } from './flightPolicy'

// Pointer, touch, and wheel input of the flight. The mouse and touch set the
// turn input (`cursor.x`, -1 to 1) and the pointer's vertical ratio; the wheel
// holds a boost (+1) or brake (-1) request that Plane eases the speed effect
// toward (getNextSpeedEffect()). dispose() removes the listeners.
export default class FlightInput {
	cursor = new Vector2()
	pointerYRatio = (FLIGHT_LIMITS.verticalHoldTop + FLIGHT_LIMITS.verticalHoldBottom) / 2
	enabled = true
	request = 0
	requestTime = 0

	constructor(target = window) {
		this.target = target
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
		target.addEventListener('mousemove', this.onMouseMove)
		target.addEventListener('wheel', this.onWheel)
		target.addEventListener('touchmove', this.onTouchMove)
	}

	setPointer(clientX, clientY, turnScale) {
		if (!this.enabled) return
		this.pointerYRatio = clientY / innerHeight
		this.cursor.set(((clientX / innerWidth) * 2 - 1) * turnScale, 1 - this.pointerYRatio * 2)
	}

	// The wheel request still held after `dt` more seconds, or 0.
	takeRequest(dt) {
		if (this.requestTime <= 0) return 0
		this.requestTime -= dt
		return this.request
	}

	dispose() {
		this.target.removeEventListener('mousemove', this.onMouseMove)
		this.target.removeEventListener('wheel', this.onWheel)
		this.target.removeEventListener('touchmove', this.onTouchMove)
	}
}
