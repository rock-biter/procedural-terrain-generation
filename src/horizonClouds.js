import { Color, SRGBColorSpace, Vector4 } from 'three'
import {
	createHorizonCloudMotion,
	getCoverageThreshold,
	getHorizonCloudBand,
	getHorizonCloudBankRadius,
	getHorizonCloudBillowReach,
	getHorizonCloudCoverage,
	getHorizonCloudOctaves,
	getHorizonCloudRepeats,
	HORIZON_CLOUD_SHADER_DEFINES,
	selectHorizonCloudLight,
	stepHorizonCloudMotion,
} from './horizonCloudsPolicy'

const DEGREE = Math.PI / 180
const TWO_PI = Math.PI * 2

// Tile coordinates the layers start from, so they never share a lattice: the
// bank circle's center sits mid-cell (32 cells per tile), so the circle
// crosses the lattice anywhere, and each billow octave starts elsewhere in
// the tile.
const BANK_CENTER = Object.freeze([0.5 + 0.5 / 32, 0.5 + 0.5 / 32])
const BILLOW_ORIGINS = Object.freeze([
	Object.freeze([0.137, 0.311]),
	Object.freeze([0.583, 0.627]),
	Object.freeze([0.829, 0.054]),
])

// The uniforms of horizon-clouds-pars.glsl and horizon-clouds-shading.glsl,
// spread into the shared object (createSharedUniforms()), which the sky, the
// aurora, and the lens flare's occlusion read. Off (uHorizonCloudFrame.w 0)
// until HorizonClouds writes them.
export function createHorizonCloudUniforms() {
	return {
		uHorizonCloudFrame: { value: new Vector4() },
		uHorizonCloudRepeats: { value: new Vector4(1, 1, 1, 1) },
		uHorizonCloudOffsets: { value: [new Vector4(), new Vector4()] },
		uHorizonCloudMotion: { value: new Vector4() },
		uHorizonCloudMorph: { value: new Vector4(1, 0, 1, 0) },
		uHorizonCloudShape: { value: new Vector4() },
		uHorizonCloudBillow: { value: new Vector4() },
		uHorizonCloudEdge: { value: new Vector4() },
		uHorizonCloudLight: { value: new Vector4(0, 1, 0, 0) },
		uHorizonCloudLightColor: { value: new Color() },
		uHorizonCloudLit: { value: new Color() },
		uHorizonCloudShade: { value: new Color() },
		uHorizonCloudTone: { value: new Vector4() },
		uHorizonCloudFacing: { value: new Vector4() },
		uHorizonCloudRim: { value: new Vector4() },
		uHorizonCloudHaze: { value: new Vector4() },
	}
}

// What getHorizonCloudCoverage() reads (horizon-clouds-pars.glsl), and the
// noise tile it samples.
const COVERAGE_UNIFORMS = Object.freeze([
	'uNoiseTexture',
	'uHorizonCloudFrame',
	'uHorizonCloudRepeats',
	'uHorizonCloudOffsets',
	'uHorizonCloudMotion',
	'uHorizonCloudMorph',
	'uHorizonCloudShape',
	'uHorizonCloudBillow',
	'uHorizonCloudEdge',
])

// The coverage uniforms of the shared object `uniforms`, for a pass outside
// the scene (the lens flare's occlusion); those it lacks are left out.
export function getHorizonCloudCoverageUniforms(uniforms) {
	const picked = {}
	for (const name of COVERAGE_UNIFORMS) {
		if (uniforms[name]) picked[name] = uniforms[name]
	}
	return picked
}

function setSRGB(color, [r, g, b], scale = 1) {
	return color.setRGB(r, g, b, SRGBColorSpace).multiplyScalar(scale)
}

// The horizon clouds: banks of toon cumulus painted on a ring around the eye,
// on the curved world's visible edge (rules in src/horizonCloudsPolicy.js).
// The sky dome draws them (sky.frag.glsl with `defines`), in front of the sun,
// the moon, and the stars; the aurora shows only where they leave the sky
// open, and they hide the lens flare. This object owns no geometry: every
// frame update() turns the wind, morphs the banks, follows the weather, and
// writes the shared uniforms from the live settings (the ?gui=1 panel needs
// no apply call) and from the day/night state: the palette's cloud colors,
// the light (sun or moon), and the horizon dip.
//
// `uniforms` is the shared object (createHorizonCloudUniforms() spread into
// it); `settings` is params.horizonClouds (createHorizonCloudSettings()).
export default class HorizonClouds {
	constructor({ uniforms, settings }) {
		this.uniforms = uniforms
		this.settings = settings
		this.motion = createHorizonCloudMotion()
		// Reused every frame.
		this.light = {}
		this.octaves = {}
		this.coverage = 0
		this.threshold = 0
		this.band = [0, 0]
	}

	// The sky's defines: its program draws the clouds only with them.
	get defines() {
		return { HORIZON_CLOUDS: '', ...HORIZON_CLOUD_SHADER_DEFINES }
	}

	update(deltaSeconds, dayNightState) {
		const { uniforms, settings, motion } = this
		stepHorizonCloudMotion(motion, deltaSeconds, settings)
		const { octaves, lightOctaves } = getHorizonCloudOctaves(settings.quality, this.octaves)

		this.coverage = getHorizonCloudCoverage(motion.time, settings, settings.coverage.fixed)
		this.threshold = getCoverageThreshold(this.coverage)
		getHorizonCloudBand(settings, octaves, this.band)
		const reach = getHorizonCloudBillowReach(settings, octaves)
		uniforms.uHorizonCloudFrame.value.set(
			dayNightState.horizonDip,
			this.band[0],
			this.band[1],
			settings.enabled ? 1 : 0,
		)

		const { bank, billows: tiles } = settings.repeats
		uniforms.uHorizonCloudRepeats.value.set(
			getHorizonCloudBankRadius(bank),
			getHorizonCloudRepeats(tiles[0]),
			getHorizonCloudRepeats(tiles[1]),
			getHorizonCloudRepeats(tiles[2]),
		)
		const { rise } = motion
		const [first, second, third] = BILLOW_ORIGINS
		uniforms.uHorizonCloudOffsets.value[0].set(
			BANK_CENTER[0],
			BANK_CENTER[1],
			first[0],
			first[1] - rise[0],
		)
		uniforms.uHorizonCloudOffsets.value[1].set(
			second[0],
			second[1] - rise[1],
			third[0],
			third[1] - rise[2],
		)
		uniforms.uHorizonCloudMotion.value.set(motion.wind, octaves, lightOctaves, reach)
		uniforms.uHorizonCloudMorph.value.set(
			Math.cos(motion.bankMorph),
			Math.sin(motion.bankMorph),
			Math.cos(motion.billowMorph),
			Math.sin(motion.billowMorph),
		)

		const { shape, billows, edges, light, rim, haze } = settings
		uniforms.uHorizonCloudShape.value.set(
			this.threshold,
			Math.max(shape.rise, 1e-3),
			shape.minTop * DEGREE,
			shape.maxTop * DEGREE,
		)
		uniforms.uHorizonCloudBillow.value.set(
			billows.amplitude * DEGREE,
			billows.gain,
			Math.min(Math.max(billows.topEmphasis, 0), 1),
			shape.baseDepth * DEGREE,
		)
		uniforms.uHorizonCloudEdge.value.set(
			Math.max(edges.softness, 0) * DEGREE,
			Math.max(edges.lostEdges, 0),
			edges.dryBrush * DEGREE,
			Math.max(edges.antialias, 0),
		)

		const selected = selectHorizonCloudLight(dayNightState, this.light)
		const [x, y, z] = selected.direction
		uniforms.uHorizonCloudLight.value.set(x, y, z, selected.contrast)
		setSRGB(
			uniforms.uHorizonCloudLightColor.value,
			selected.light === 'sun' ? dayNightState.sunColor : dayNightState.moonColor,
		)
		setSRGB(uniforms.uHorizonCloudLit.value, dayNightState.cloudLit, settings.brightness)
		setSRGB(uniforms.uHorizonCloudShade.value, dayNightState.cloudShade, settings.brightness)
		uniforms.uHorizonCloudTone.value.set(
			light.bands[0],
			light.bands[1],
			Math.max(light.bandSoftness, 1e-3),
			Math.max(light.offset, 0.01) * DEGREE,
		)
		uniforms.uHorizonCloudFacing.value.set(
			Math.max(light.depth, 0.01) * DEGREE,
			light.frontLift,
			light.backDarken,
			light.topBias,
		)
		uniforms.uHorizonCloudRim.value.set(
			rim.strength,
			Math.max(rim.focus, 1),
			Math.max(rim.width, 0.01) * DEGREE,
			rim.darkening,
		)
		uniforms.uHorizonCloudHaze.value.set(
			Math.max(haze.height, 0.01) * DEGREE,
			haze.base,
			haze.overall,
			haze.wash,
		)
	}

	getStats() {
		return {
			enabled: this.settings.enabled,
			coverage: this.coverage,
			threshold: this.threshold,
			// Degrees above the visible edge.
			band: this.band.map((angle) => angle / DEGREE),
			light: this.light.light ?? null,
			contrast: this.light.contrast ?? 0,
			// Degrees the wind has turned the ring.
			wind: (this.motion.wind / TWO_PI) * 360,
		}
	}
}
