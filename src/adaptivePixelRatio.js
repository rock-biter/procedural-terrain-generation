// Pure rules for the renderer pixel ratio (applied by src/renderSetup.js): the cap, the
// `?dpr=` override, and the adaptive ratio that lowers the resolution when the
// frame rate drops below 60 fps and raises it again when there is room.

// Highest pixel ratio the renderer uses, whatever the display reports.
export const PIXEL_RATIO_CAP = 2

// - `enabled`: adapt the ratio; otherwise it stays at the maximum.
// - `min`: lowest adaptive ratio (clamped to the maximum).
// - `step`: ratio change per adjustment.
// - `maxFrameMs`: mean frame interval of a window above which the ratio steps
//   down. 60 fps is 16.7 ms; at 60 Hz, 17.5 ms means about 5% missed frames.
// - `stableFrameMs`: a window counts as within budget only below this mean; at
//   60 Hz a single missed frame in a window already averages 16.94 ms. At a
//   settled ratio, windows between the two limits neither lower it nor count
//   toward raising it, so an occasional hitch the resolution cannot fix keeps
//   it. Right after a step up, such a window undoes the step.
// - `windowFrames`: frames per measurement window (one second at 60 Hz).
// - `settleFrames`: frames skipped after a change, while the buffers are
//   reallocated and the GPU catches up.
// - `ignoreFrameMs`: longer intervals (shader compiles, a hidden tab) say
//   nothing about the resolution and are skipped.
// - `holdWindows`: consecutive windows within budget before trying a higher
//   ratio. A step up is confirmed after `confirmWindows` such windows; one
//   undone before that doubles the wait, up to `maxHoldWindows` (about two
//   minutes, since every failed try costs a second below 60 fps); a confirmed
//   one resets it.
export const ADAPTIVE_PIXEL_RATIO_DEFAULTS = Object.freeze({
	enabled: true,
	min: 1.25,
	step: 0.25,
	maxFrameMs: 17.5,
	stableFrameMs: 16.9,
	windowFrames: 60,
	settleFrames: 10,
	ignoreFrameMs: 250,
	holdWindows: 3,
	confirmWindows: 2,
	maxHoldWindows: 120,
})

export function createAdaptivePixelRatioSettings(overrides = {}) {
	return { ...ADAPTIVE_PIXEL_RATIO_DEFAULTS, ...overrides }
}

// The display's ratio, capped.
export function getMaxPixelRatio(devicePixelRatio) {
	return Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, PIXEL_RATIO_CAP)
}

// `?dpr=<number>` pins the pixel ratio (clamped to 0.5 through the cap), for
// screenshots and benchmarks; null when absent or invalid.
export function parsePixelRatio(urlParams) {
	const value = urlParams.get('dpr')
	if (value === null || value.trim() === '') return null
	const ratio = Number(value)
	if (!Number.isFinite(ratio) || ratio <= 0) return null
	return Math.min(Math.max(ratio, 0.5), PIXEL_RATIO_CAP)
}

// Feed it every frame interval with update(); it reads `settings` live, so
// GUI changes apply on the next frame.
export class AdaptivePixelRatio {
	constructor(settings, maxRatio) {
		this.settings = settings
		this.max = maxRatio
		this.ratio = maxRatio
		this.hold = settings.holdWindows
		this.stableWindows = 0
		this.probing = false
		this.settle = 0
		this.sum = 0
		this.count = 0
		this.lastMeanMs = null
		this.changes = 0
	}

	// New maximum after a resize or a move to another display.
	setMax(maxRatio) {
		this.max = maxRatio
		if (this.ratio > maxRatio || !this.settings.enabled) this.set(maxRatio)
		return this.ratio
	}

	// Returns the new ratio when it changes, otherwise null.
	update(intervalMs) {
		const settings = this.settings
		if (!settings.enabled) return this.set(this.max)
		const min = Math.min(Math.max(settings.min, 0.5), this.max)
		if (this.ratio < min) return this.set(min)
		if (!(intervalMs > 0) || intervalMs > settings.ignoreFrameMs) return null
		if (this.settle > 0) {
			this.settle--
			return null
		}

		this.sum += intervalMs
		this.count++
		if (this.count < settings.windowFrames) return null
		const meanMs = this.sum / this.count
		this.sum = 0
		this.count = 0
		this.lastMeanMs = meanMs

		if (meanMs > settings.maxFrameMs || (this.probing && meanMs >= settings.stableFrameMs)) {
			this.stableWindows = 0
			if (this.probing) this.hold = Math.min(this.hold * 2, settings.maxHoldWindows)
			this.probing = false
			return this.set(Math.max(min, this.ratio - settings.step))
		}
		if (meanMs >= settings.stableFrameMs) {
			this.stableWindows = 0
			return null
		}
		this.stableWindows++
		if (this.probing && this.stableWindows >= settings.confirmWindows) {
			this.probing = false
			this.hold = settings.holdWindows
		}
		if (!this.probing && this.ratio < this.max && this.stableWindows >= this.hold) {
			this.stableWindows = 0
			this.probing = true
			return this.set(Math.min(this.max, this.ratio + settings.step))
		}
		return null
	}

	set(ratio) {
		if (ratio === this.ratio) return null
		this.ratio = ratio
		this.settle = this.settings.settleFrames
		this.sum = 0
		this.count = 0
		this.changes++
		return ratio
	}

	getStats() {
		return {
			enabled: this.settings.enabled,
			ratio: this.ratio,
			min: Math.min(this.settings.min, this.max),
			max: this.max,
			lastMeanMs: this.lastMeanMs === null ? null : Math.round(this.lastMeanMs * 100) / 100,
			holdWindows: this.hold,
			changes: this.changes,
		}
	}
}
