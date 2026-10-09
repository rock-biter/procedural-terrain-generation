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

// World units of flown path the ribbon covers, and its segment count.
const TRAIL_LENGTH = 60
const TRAIL_SEGMENTS = 30

// The two wing-tip stripes: a ribbon along the last TRAIL_LENGTH units of the
// flown path (src/trailHistory.js), in world space, so `mesh` is a direct
// scene child. trail-color-fragment.glsl draws the ink stripes inside it;
// `settings` (params.trails) is read on every refresh.
export default class WingTrails {
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
		}

		const positions = new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 3)
		const uv = new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 2)
		const widths = new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 2)
		const distances = new Float32Array((TRAIL_SEGMENTS + 1) * 2)
		const banks = new Float32Array((TRAIL_SEGMENTS + 1) * 2)
		const indices = new Uint16Array(TRAIL_SEGMENTS * 6)
		for (let row = 0; row <= TRAIL_SEGMENTS; row++) {
			const v = 1 - row / TRAIL_SEGMENTS
			uv[row * 4] = 0
			uv[row * 4 + 1] = v
			uv[row * 4 + 2] = 1
			uv[row * 4 + 3] = v
			if (row === TRAIL_SEGMENTS) continue
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

	// Records the current pose: `body` is the flying Plane (its +Z is the
	// flight direction), `model` the banking airplane mesh, `anchor` the
	// emission point in model space, and `turnInput`, `speed`, and `baseSpeed`
	// set the stripe widths.
	record(body, model, anchor, turnInput, speed, baseSpeed) {
		body.updateWorldMatrix(true, false)
		// Also refreshes the model's world matrix for localToWorld() below.
		model.getWorldQuaternion(this.quaternion)
		this.forward.set(0, 0, 1).applyQuaternion(body.quaternion)
		this.wing.set(1, 0, 0).applyQuaternion(this.quaternion)
		model.localToWorld(this.center.copy(anchor))

		getTrailWidths(turnInput, speed, baseSpeed, this.widths)
		this.history.push(
			this.center,
			this.forward,
			this.wing,
			this.widths[0],
			this.widths[1],
			getTrailBankFactor(model.rotation.z),
			TRAIL_LENGTH,
		)
	}

	// Drops the recorded path, so no ribbon joins the old place to the new one
	// after the airplane moves without flying.
	clear() {
		this.history.clear()
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
		let firstStripeRow = -1
		let lastStripeRow = -1
		for (let index = 0; index <= TRAIL_SEGMENTS; index++) {
			this.history.sample((index * TRAIL_LENGTH) / TRAIL_SEGMENTS, row)
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
		const segments = Math.min(TRAIL_SEGMENTS, Math.ceil(this.history.availableDistance / 2))
		const firstSegment = Math.max(firstStripeRow - 1, 0)
		const endSegment = firstStripeRow < 0 ? 0 : Math.min(lastStripeRow + 1, segments)
		geometry.setDrawRange(firstSegment * 6, Math.max(endSegment - firstSegment, 0) * 6)
		geometry.attributes.position.needsUpdate = true
		geometry.attributes.trailWidths.needsUpdate = true
		geometry.attributes.trailDistance.needsUpdate = true
		geometry.attributes.trailBank.needsUpdate = true
	}
}
