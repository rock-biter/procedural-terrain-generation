import assert from 'node:assert/strict'
import test from 'node:test'
import {
	ADAPTIVE_PIXEL_RATIO_DEFAULTS,
	AdaptivePixelRatio,
	PIXEL_RATIO_CAP,
	createAdaptivePixelRatioSettings,
	getMaxPixelRatio,
	parsePixelRatio,
} from '../src/adaptivePixelRatio.js'

const { windowFrames, settleFrames, holdWindows, confirmWindows } = ADAPTIVE_PIXEL_RATIO_DEFAULTS

// Feeds whole windows of one interval and returns every ratio change.
function feed(adaptive, intervalMs, windows) {
	const changes = []
	for (let window = 0; window < windows; window++) {
		// A window after a change also waits out the settle frames.
		const frames = windowFrames + (adaptive.settle > 0 ? adaptive.settle : 0)
		for (let frame = 0; frame < frames; frame++) {
			const ratio = adaptive.update(intervalMs)
			if (ratio !== null) changes.push(ratio)
		}
	}
	return changes
}

test('the maximum is the display ratio, capped', () => {
	assert.equal(getMaxPixelRatio(3), PIXEL_RATIO_CAP)
	assert.equal(getMaxPixelRatio(1.5), 1.5)
	assert.equal(getMaxPixelRatio(0), 1)
	assert.equal(getMaxPixelRatio(undefined), 1)
})

test('?dpr= pins a clamped ratio and ignores invalid values', () => {
	const parse = (query) => parsePixelRatio(new URLSearchParams(query))
	assert.equal(parse('dpr=1.5'), 1.5)
	assert.equal(parse('dpr=4'), PIXEL_RATIO_CAP)
	assert.equal(parse('dpr=0.1'), 0.5)
	assert.equal(parse(''), null)
	assert.equal(parse('dpr='), null)
	assert.equal(parse('dpr=abc'), null)
	assert.equal(parse('dpr=-1'), null)
})

test('slow windows step the ratio down to the minimum', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	assert.deepEqual(feed(adaptive, 25, 5), [1.75, 1.5, 1.25])
	assert.equal(adaptive.ratio, 1.25)
})

test('a 60 fps window keeps the ratio, jitter included', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	assert.deepEqual(feed(adaptive, 1000 / 60, 10), [])
	// A few missed vsyncs in a window stay under the limit.
	for (let frame = 0; frame < windowFrames; frame++) {
		adaptive.update(frame % 30 === 0 ? 33.3 : 16.67)
	}
	assert.equal(adaptive.ratio, 2)
})

test('the ratio climbs back after windows within budget', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	feed(adaptive, 25, 2)
	assert.equal(adaptive.ratio, 1.5)
	assert.deepEqual(feed(adaptive, 10, holdWindows), [1.75])
	assert.deepEqual(feed(adaptive, 10, holdWindows), [2])
	assert.deepEqual(feed(adaptive, 10, 10), [])
})

test('a step up that fails is undone and doubles the wait', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	feed(adaptive, 25, 1)
	assert.equal(adaptive.ratio, 1.75)
	feed(adaptive, 16, holdWindows)
	assert.equal(adaptive.ratio, 2)
	feed(adaptive, 25, 1)
	assert.equal(adaptive.ratio, 1.75)
	assert.equal(adaptive.hold, holdWindows * 2)
	// The longer wait: no step up before it ends.
	assert.deepEqual(feed(adaptive, 16, holdWindows * 2 - 1), [])
	assert.deepEqual(feed(adaptive, 16, 1), [2])
	// Confirmed after enough windows within budget: the wait returns to its base.
	feed(adaptive, 16, confirmWindows)
	assert.equal(adaptive.hold, holdWindows)
})

test('a step up undone before confirmation counts as failed', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	feed(adaptive, 25, 1)
	feed(adaptive, 16, holdWindows)
	assert.equal(adaptive.ratio, 2)
	// One window within budget, then a slow one: still the same try.
	feed(adaptive, 16, confirmWindows - 1)
	feed(adaptive, 25, 1)
	assert.equal(adaptive.ratio, 1.75)
	assert.equal(adaptive.hold, holdWindows * 2)
})

test('right after a step up, a borderline window undoes it', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	feed(adaptive, 25, 1)
	feed(adaptive, 16, holdWindows)
	assert.equal(adaptive.ratio, 2)
	// One missed frame at 60 Hz: fine at a settled ratio, not for a try.
	assert.deepEqual(feed(adaptive, 16.94, 1), [1.75])
	assert.equal(adaptive.hold, holdWindows * 2)
})

test('windows between the two limits neither lower nor raise the ratio', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	feed(adaptive, 25, 1)
	assert.deepEqual(feed(adaptive, 17.2, 20), [])
	assert.equal(adaptive.ratio, 1.75)
	// A borderline window breaks a run of good ones.
	feed(adaptive, 16, holdWindows - 1)
	feed(adaptive, 17.2, 1)
	assert.deepEqual(feed(adaptive, 16, holdWindows - 1), [])
	assert.deepEqual(feed(adaptive, 16, 1), [2])
})

test('hitches and hidden-tab intervals are skipped', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	for (let frame = 0; frame < windowFrames * 3; frame++) {
		assert.equal(adaptive.update(frame % 2 ? 0 : 400), null)
	}
	assert.equal(adaptive.count, 0)
	assert.equal(adaptive.ratio, 2)
})

test('frames right after a change are not measured', () => {
	const adaptive = new AdaptivePixelRatio(createAdaptivePixelRatioSettings(), 2)
	feed(adaptive, 25, 1)
	assert.equal(adaptive.settle, settleFrames)
	for (let frame = 0; frame < settleFrames; frame++) adaptive.update(40)
	assert.equal(adaptive.count, 0)
})

test('settings apply live and the maximum follows the display', () => {
	const settings = createAdaptivePixelRatioSettings()
	const adaptive = new AdaptivePixelRatio(settings, 2)
	feed(adaptive, 25, 3)
	assert.equal(adaptive.ratio, 1.25)
	settings.min = 1.5
	assert.equal(adaptive.update(16), 1.5)
	settings.enabled = false
	assert.equal(adaptive.update(25), 2)
	assert.equal(adaptive.update(25), null)
	settings.enabled = true
	assert.equal(adaptive.setMax(1), 1)
	// A minimum above the maximum is clamped to it.
	assert.deepEqual(feed(adaptive, 25, 3), [])
	assert.equal(adaptive.getStats().min, 1)
})
