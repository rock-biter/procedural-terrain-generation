import { smoothstep } from './math.js'

// The wing trails' recorded path (three-free, tested in Node). A ring buffer
// of airplane poses (center, forward, wing axis, left and right ribbon
// widths, bank) kept only as far back as the ribbon reaches; sample() reads
// the pose any distance behind the airplane, interpolated by flown distance.
// src/wingTrails.js builds the ribbon from it every frame.

// Values per pose: the distance flown up to it, then center, forward, and
// wing (3 each), the left and right widths, and the bank.
const STRIDE = 13
const MIN_SAMPLE_DISTANCE = 0.25

// Ribbon widths for the left and right wing, from 0 to 1: the outer wing of a
// sharp turn shows a trail, and both do at boost speed.
export function getTrailWidths(turnInput, speed, baseSpeed, out) {
	const curvature = speed > 0 ? (Math.abs(turnInput) * baseSpeed) / speed : 0
	const turnWidth = 0.75 * smoothstep(0.65, 1, curvature)
	const speedWidth = smoothstep(0.1, 1, (speed - baseSpeed) / (baseSpeed * 2))
	const outerWidth = Math.max(turnWidth, speedWidth)
	const innerWidth = outerWidth * (1 - 0.45 * turnWidth)
	out[0] = turnInput < 0 ? outerWidth : innerWidth
	out[1] = turnInput > 0 ? outerWidth : innerWidth
	return out
}

// The airplane roll as a 0-1 share of the maximum bank.
export function getTrailBankFactor(roll) {
	return Math.max(0, Math.min(1, Math.abs(roll) / (Math.PI * 0.25)))
}

export default class TrailHistory {
	constructor(capacity = 512) {
		this.capacity = capacity
		this.values = new Float64Array(capacity * STRIDE)
		this.start = 0
		this.count = 0
		this.distance = 0
		this.lastCommittedDistance = 0
		this.previousX = 0
		this.previousY = 0
		this.previousZ = 0
	}

	index(offset) {
		return ((this.start + offset) % this.capacity) * STRIDE
	}

	write(offset, center, forward, wing, leftWidth, rightWidth, bank) {
		const i = this.index(offset)
		const values = this.values
		values[i] = this.distance
		values[i + 1] = center.x
		values[i + 2] = center.y
		values[i + 3] = center.z
		values[i + 4] = forward.x
		values[i + 5] = forward.y
		values[i + 6] = forward.z
		values[i + 7] = wing.x
		values[i + 8] = wing.y
		values[i + 9] = wing.z
		values[i + 10] = leftWidth
		values[i + 11] = rightWidth
		values[i + 12] = bank
	}

	push(center, forward, wing, leftWidth, rightWidth, bank, length = 60) {
		if (this.count) {
			this.distance += Math.hypot(
				center.x - this.previousX,
				center.y - this.previousY,
				center.z - this.previousZ,
			)
		}
		this.previousX = center.x
		this.previousY = center.y
		this.previousZ = center.z

		if (!this.count) {
			this.count = 1
			this.write(0, center, forward, wing, leftWidth, rightWidth, bank)
			return
		}

		if (
			this.distance > this.lastCommittedDistance &&
			(this.count === 1 || this.distance - this.lastCommittedDistance >= MIN_SAMPLE_DISTANCE)
		) {
			if (this.count === this.capacity) {
				this.start = (this.start + 1) % this.capacity
				this.count--
			}
			this.count++
			this.lastCommittedDistance = this.distance
		}
		this.write(this.count - 1, center, forward, wing, leftWidth, rightWidth, bank)

		while (this.count > 2 && this.values[this.index(1)] <= this.distance - length) {
			this.start = (this.start + 1) % this.capacity
			this.count--
		}
	}

	// Forgets every pose: the next push() starts a new path.
	clear() {
		this.start = 0
		this.count = 0
		this.distance = 0
		this.lastCommittedDistance = 0
	}

	get availableDistance() {
		return this.count ? this.distance - this.values[this.index(0)] : 0
	}

	sample(distanceBehind, out) {
		if (!this.count) return false

		const target = this.distance - distanceBehind
		let older = this.count - 1
		while (older > 0 && this.values[this.index(older)] > target) older--
		const newer = Math.min(older + 1, this.count - 1)
		const a = this.index(older)
		const b = this.index(newer)
		const span = this.values[b] - this.values[a]
		const t = span > 0 ? Math.max(0, Math.min(1, (target - this.values[a]) / span)) : 0
		for (let field = 1; field < STRIDE; field++) {
			out[field - 1] =
				this.values[a + field] + (this.values[b + field] - this.values[a + field]) * t
		}
		out[STRIDE - 1] = this.values[a] + (this.values[b] - this.values[a]) * t
		return true
	}
}
