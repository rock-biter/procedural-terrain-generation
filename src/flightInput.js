import { Vector2 } from 'three'
import { FLIGHT_LIMITS } from './flightPolicy'

// Pointer, touch, wheel, and click input of the flight. The mouse and touch
// (on `target`, the window) set the turn input (`cursor.x`, -1 to 1) and the
// pointer's vertical ratio. The wheel and clicks count on `clickTarget` (the
// canvas, so page controls such as the lil-gui panel never trigger them): the
// wheel holds a boost (+1) or brake (-1) request that Plane eases the speed
// effect toward (getNextSpeedEffect()), and the first event of a deliberate
// wheel gesture back also requests a turnaround, which Plane takes with
// takeTurnRequest() (an Immelmann at cruise speed); a click or tap requests a
// maneuver at its place on the screen, which Plane takes with
// takeClickRequest(). dispose() removes the listeners.
export default class FlightInput {
	cursor = new Vector2()
	pointerYRatio = (FLIGHT_LIMITS.verticalHoldTop + FLIGHT_LIMITS.verticalHoldBottom) / 2
	enabled = true
	request = 0
	requestTime = 0
	// Whether a click waits, and its place: `x` from -1 (left edge) to 1
	// (right edge) like the turn input, `yRatio` from the top.
	clicked = false
	click = { x: 0, yRatio: 0 }
	turnRequest = false
	// Set by consumeWheelGesture(): the rest of the gesture neither boosts nor
	// brakes.
	gestureConsumed = false

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
			const request = event.deltaY > 0 ? 1 : -1
			// A gesture is a run of events in one direction, each within
			// `wheelHold` of the last (a trackpad's momentum included).
			if (this.requestTime <= 0 || request !== this.request) {
				this.gestureConsumed = false
				// Not a sideways swipe, nor the faint tail of a trackpad's momentum.
				this.turnRequest =
					request < 0 &&
					Math.abs(event.deltaY) >= Math.abs(event.deltaX ?? 0) &&
					Math.abs(event.deltaY) >= FLIGHT_LIMITS.turnaroundWheelDelta
			}
			this.request = request
			this.requestTime = FLIGHT_LIMITS.wheelHold
		}
		// A steering drag ends without a click, so only a click or tap counts.
		this.onClick = (event) => {
			if (!this.enabled) return
			this.clicked = true
			this.click.x = (event.clientX / innerWidth) * 2 - 1
			this.click.yRatio = event.clientY / innerHeight
		}
		target.addEventListener('mousemove', this.onMouseMove)
		target.addEventListener('touchmove', this.onTouchMove)
		clickTarget.addEventListener('wheel', this.onWheel)
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

	// The wheel request still held after `dt` more seconds, or 0 (also for the
	// rest of a consumed gesture).
	takeRequest(dt) {
		if (this.requestTime <= 0) return 0
		this.requestTime -= dt
		return this.gestureConsumed ? 0 : this.request
	}

	// Whether a wheel gesture back started since the last call; spent either
	// way, so the gesture asks once.
	takeTurnRequest() {
		const requested = this.turnRequest
		this.turnRequest = false
		return requested
	}

	// The current wheel gesture started a maneuver: the rest of it neither
	// brakes nor asks again, until a pause longer than `wheelHold`.
	consumeWheelGesture() {
		this.gestureConsumed = true
	}

	// The place of the latest click since the last call ({ x, yRatio }, read
	// before the next click), or null; spent either way, so a click during a
	// maneuver is dropped rather than queued.
	takeClickRequest() {
		if (!this.clicked) return null
		this.clicked = false
		return this.click
	}

	// Drops every held request, so none applies once input is back.
	clearRequests() {
		this.requestTime = 0
		this.clicked = false
		this.turnRequest = false
	}

	dispose() {
		this.target.removeEventListener('mousemove', this.onMouseMove)
		this.target.removeEventListener('touchmove', this.onTouchMove)
		this.clickTarget.removeEventListener('wheel', this.onWheel)
		this.clickTarget.removeEventListener('click', this.onClick)
	}
}
