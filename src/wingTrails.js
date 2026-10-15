import {
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	DynamicDrawUsage,
	Mesh,
	MeshBasicMaterial,
	Quaternion,
	SRGBColorSpace,
	Vector3,
} from 'three'
import common from './shaders/common.glsl'
import trailParsVertex from './shaders/trail-pars-vertex.glsl'
import trailProjectVertex from './shaders/trail-project-vertex.glsl'
import trailParsFragment from './shaders/trail-pars-fragment.glsl'
import trailColorFragment from './shaders/trail-color-fragment.glsl'
import { replaceChunks } from './shaderChunks.js'
import TrailHistory, { getTrailBankFactor, getTrailWidths } from './trailHistory.js'

// World units of flown path the ribbon covers: TRAIL_LENGTH in flight, and
// while a loop or an Immelmann draws its ring of smoke, all it has flown
// since it started, up to MAX_TRAIL_LENGTH. One row per unit keeps the twist
// of the default barrel roll at full boost to about 25 degrees a segment at
// its fastest, so the stripes stay continuous.
const TRAIL_LENGTH = 60
const MAX_TRAIL_LENGTH = 380
const SEGMENT_LENGTH = 1
const MAX_SEGMENTS = MAX_TRAIL_LENGTH / SEGMENT_LENGTH
// After a maneuver the longer trail holds for TRAIL_HOLD seconds, then its
// tail comes back to TRAIL_LENGTH at TRAIL_SHRINK_SPEED units per second.
const TRAIL_HOLD = 1.2
const TRAIL_SHRINK_SPEED = 90

// The two wing-tip stripes: a ribbon along the last `length` units of the
// flown path (src/trailHistory.js), in world space, so `mesh` is a direct
// scene child. trail-color-fragment.glsl draws the ink stripes inside it;
// `settings` (params.trails) is read on every refresh.
export default class WingTrails {
	length = TRAIL_LENGTH
	holdTime = 0
	// The history's flown distance when the current maneuver started.
	maneuverStart = 0

	constructor(settings) {
		this.settings = settings
		this.history = new TrailHistory()
		this.center = new Vector3()
		this.forward = new Vector3()
		this.wing = new Vector3()
		this.quaternion = new Quaternion()
		this.row = new Float64Array(13)
		this.widths = new Float32Array(2)
		this.uniforms = {
			uTrailRibbonWidth: { value: settings.ribbonWidth },
			uTrailLineWidth: { value: settings.lineWidth },
			uTrailBorderWidth: { value: settings.borderWidth },
			uTrailOuterFrequency: { value: settings.outerEdge.frequency },
			uTrailOuterAmplitude: { value: settings.outerEdge.amplitude },
			uTrailInnerFrequency: { value: settings.innerEdge.frequency },
			uTrailInnerAmplitude: { value: settings.innerEdge.amplitude },
			uTrailOscillationFrequency: { value: settings.oscillation.frequency },
			uTrailOscillationAmplitude: { value: settings.oscillation.amplitude },
			uTrailTint: { value: new Color(1, 1, 1) },
			// The shader's distance behind the airplane is (1 - uv.y) times the
			// maximum length; the stripes taper in over `uTrailTaperLength` from
			// the wings and out over the same before `uTrailLength`, the current
			// end of the ribbon.
			uTrailMaxLength: { value: MAX_TRAIL_LENGTH },
			uTrailTaperLength: { value: TRAIL_LENGTH / 2 },
			uTrailLength: { value: TRAIL_LENGTH },
		}

		// Allocated for the longest trail; rows sit a fixed SEGMENT_LENGTH apart,
		// so `uv` never changes.
		const positions = new Float32Array((MAX_SEGMENTS + 1) * 2 * 3)
		const uv = new Float32Array((MAX_SEGMENTS + 1) * 2 * 2)
		const widths = new Float32Array((MAX_SEGMENTS + 1) * 2 * 2)
		const distances = new Float32Array((MAX_SEGMENTS + 1) * 2)
		const banks = new Float32Array((MAX_SEGMENTS + 1) * 2)
		const indices = new Uint16Array(MAX_SEGMENTS * 6)
		for (let row = 0; row <= MAX_SEGMENTS; row++) {
			const v = 1 - row / MAX_SEGMENTS
			uv[row * 4] = 0
			uv[row * 4 + 1] = v
			uv[row * 4 + 2] = 1
			uv[row * 4 + 3] = v
			if (row === MAX_SEGMENTS) continue
			const i = row * 6
			const vertex = row * 2
			indices.set([vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3], i)
		}
		const geometry = new BufferGeometry()
		const dynamic = (array, size) => new BufferAttribute(array, size).setUsage(DynamicDrawUsage)
		geometry.setAttribute('position', dynamic(positions, 3))
		geometry.setAttribute('uv', new BufferAttribute(uv, 2))
		geometry.setAttribute('trailWidths', dynamic(widths, 2))
		geometry.setAttribute('trailDistance', dynamic(distances, 1))
		geometry.setAttribute('trailBank', dynamic(banks, 1))
		geometry.setIndex(new BufferAttribute(indices, 1))
		geometry.setDrawRange(0, 0)
		const material = new MeshBasicMaterial({
			color: 0xffffff,
			side: DoubleSide,
			transparent: true,
			depthWrite: false,
		})
		material.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, this.uniforms)
			shader.vertexShader = replaceChunks(shader.vertexShader, {
				common: `#include <common>\n${trailParsVertex}`,
				project_vertex: trailProjectVertex,
			})
			shader.fragmentShader = replaceChunks(shader.fragmentShader, {
				common: `${common}\n${trailParsFragment}`,
				color_fragment: trailColorFragment,
			})
		}

		this.mesh = new Mesh(geometry, material)
		this.mesh.frustumCulled = false
	}

	// Sets the day/night tint of the stripe cores (sRGB triplet).
	setTint([r, g, b]) {
		this.uniforms.uTrailTint.value.setRGB(r, g, b, SRGBColorSpace)
	}

	// A loop or an Immelmann starts: the trail keeps what it flies from here.
	startManeuver() {
		this.maneuverStart = this.history.distance
	}

	// The trail's length after `dt` more seconds: while a loop or an Immelmann
	// runs (`maneuver`), all it has flown since it started, plus the tail's
	// fade, so the whole ring shows; it grows with the history, so nothing is
	// cut. Afterwards the longer trail holds, then shrinks back to TRAIL_LENGTH.
	updateLength(dt, maneuver = false) {
		if (maneuver) {
			const flown = this.history.distance - this.maneuverStart + TRAIL_LENGTH / 2
			this.length = Math.min(Math.max(this.length, flown), MAX_TRAIL_LENGTH)
			this.holdTime = TRAIL_HOLD
		} else if (this.holdTime > 0) {
			this.holdTime -= dt
		} else {
			this.length = Math.max(TRAIL_LENGTH, this.length - TRAIL_SHRINK_SPEED * dt)
		}
	}

	// Records the current pose: `body` is the flying Plane (its +Z is the
	// flight direction), `model` the banking and rolling airplane mesh, `anchor`
	// the emission point in model space, `turnInput`, `speed`, and `baseSpeed`
	// set the stripe widths, with `smoke` (0 to 1, a loop's or an Immelmann's)
	// at any speed, and `bank` (the steering bank, without the barrel roll)
	// sets the stripes' sideways oscillation.
	record(body, model, anchor, turnInput, speed, baseSpeed, bank, smoke = 0) {
		body.updateWorldMatrix(true, false)
		// Also refreshes the model's world matrix for localToWorld() below.
		model.getWorldQuaternion(this.quaternion)
		this.forward.set(0, 0, 1).applyQuaternion(body.quaternion)
		this.wing.set(1, 0, 0).applyQuaternion(this.quaternion)
		model.localToWorld(this.center.copy(anchor))

		getTrailWidths(turnInput, speed, baseSpeed, this.widths, smoke)
		this.history.push(
			this.center,
			this.forward,
			this.wing,
			this.widths[0],
			this.widths[1],
			getTrailBankFactor(bank),
			this.length,
		)
	}

	// Drops the recorded path, so no ribbon joins the old place to the new one
	// after the airplane moves without flying, and its longer trail with it.
	clear() {
		this.history.clear()
		this.length = TRAIL_LENGTH
		this.holdTime = 0
		this.refresh()
	}

	// Applies the settings to the uniforms and rebuilds the ribbon from the
	// recorded history without adding a pose, so it is safe while flight is paused.
	refresh() {
		const { settings, uniforms } = this
		uniforms.uTrailRibbonWidth.value = settings.ribbonWidth
		uniforms.uTrailLineWidth.value = settings.lineWidth
		uniforms.uTrailBorderWidth.value = settings.borderWidth
		uniforms.uTrailOuterFrequency.value = settings.outerEdge.frequency
		uniforms.uTrailOuterAmplitude.value = settings.outerEdge.amplitude
		uniforms.uTrailInnerFrequency.value = settings.innerEdge.frequency
		uniforms.uTrailInnerAmplitude.value = settings.innerEdge.amplitude
		uniforms.uTrailOscillationFrequency.value = settings.oscillation.frequency
		uniforms.uTrailOscillationAmplitude.value = settings.oscillation.amplitude

		const geometry = this.mesh.geometry
		const positions = geometry.attributes.position.array
		const widths = geometry.attributes.trailWidths.array
		const distances = geometry.attributes.trailDistance.array
		const banks = geometry.attributes.trailBank.array
		const row = this.row
		// The ribbon ends at the current length, or sooner where the history
		// does (after clear(), or while a longer trail is still growing).
		const length = Math.min(this.length, this.history.availableDistance)
		const segments = Math.min(MAX_SEGMENTS, Math.ceil(length / SEGMENT_LENGTH))
		uniforms.uTrailLength.value = length
		let firstStripeRow = -1
		let lastStripeRow = -1
		let from = this.history.count - 1
		for (let index = 0; index <= segments; index++) {
			from = this.history.sample(index * SEGMENT_LENGTH, row, from)
			const wingLength = Math.hypot(row[6], row[7], row[8])
			const wingScale = wingLength > 0 ? (settings.ribbonWidth * 0.5) / wingLength : 0
			const wingX = row[6] * wingScale
			const wingY = row[7] * wingScale
			const wingZ = row[8] * wingScale
			const i = index * 6
			positions[i] = row[0] - wingX
			positions[i + 1] = row[1] - wingY
			positions[i + 2] = row[2] - wingZ
			positions[i + 3] = row[0] + wingX
			positions[i + 4] = row[1] + wingY
			positions[i + 5] = row[2] + wingZ
			const widthOffset = index * 4
			widths[widthOffset] = row[9]
			widths[widthOffset + 1] = row[10]
			widths[widthOffset + 2] = row[9]
			widths[widthOffset + 3] = row[10]
			banks[index * 2] = row[11]
			banks[index * 2 + 1] = row[11]
			distances[index * 2] = row[12]
			distances[index * 2 + 1] = row[12]
			if (row[9] > 0 || row[10] > 0) {
				if (firstStripeRow < 0) firstStripeRow = index
				lastStripeRow = index
			}
		}
		// Segment s joins rows s and s + 1. The fragment shader discards every
		// pixel without stripe width, so only segments touching a row with a
		// stripe are drawn; in level, cruise-speed flight that is none.
		const firstSegment = Math.max(firstStripeRow - 1, 0)
		const endSegment = firstStripeRow < 0 ? 0 : Math.min(lastStripeRow + 1, segments)
		geometry.setDrawRange(firstSegment * 6, Math.max(endSegment - firstSegment, 0) * 6)
		geometry.attributes.position.needsUpdate = true
		geometry.attributes.trailWidths.needsUpdate = true
		geometry.attributes.trailDistance.needsUpdate = true
		geometry.attributes.trailBank.needsUpdate = true
	}
}
