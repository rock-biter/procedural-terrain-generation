import {
	Camera,
	GLSL3,
	HalfFloatType,
	LinearFilter,
	MathUtils,
	Mesh,
	NoBlending,
	PlaneGeometry,
	RGBAFormat,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	Vector4,
	WebGLRenderTarget,
} from 'three'
import fullscreenVertexShader from './shaders/fullscreen-vertex.glsl'
import simFragmentShader from './shaders/sea-wake-sim-fragment.glsl'
import { MANEUVER, wrapAngle } from './maneuverPolicy'
import { clamp01 } from './math'
import {
	addSeaWakeStamp,
	advanceSeaWakeOccupancy,
	clearSeaWakeOccupancy,
	createSeaWakeOccupancy,
	getSeaWakeAltitude,
	getSeaWakeDecay,
	getSeaWakeFadeRange,
	getSeaWakeFoamSpread,
	getSeaWakeLineWavenumber,
	getSeaWakeOccupiedRect,
	getSeaWakePulsePhase,
	getSeaWakeRollBoost,
	getSeaWakeSettleTime,
	getSeaWakeStampGains,
	getSeaWakeSteps,
	getSeaWakeStrength,
	getSeaWakeTexel,
	getSeaWakeTexelPoint,
	getSeaWakeWaveSpeed,
	getSeaWakeWindow,
	isSeaWakeStepDue,
} from './seaWakePolicy'

// A jump of the airplane longer than this share of the map's half-size
// (a teleport) starts the wake over instead of stamping across it.
const JUMP_SHARE = 0.5
// The smallest radius, in texels, of the kick and of the foam, so neither
// aliases as it slides across the texels: the kick's keeps the ripples
// smooth, the foam's, smaller, lets the trail stay thin, which its lace and
// the readers' bilinear lookup keep from beading.
const MIN_KICK_TEXELS = 1.5
const MIN_FOAM_TEXELS = 1
// Response (per second) of the measured speed the waves follow.
const SPEED_RESPONSE = 8

// Receiver uniforms, shared with the terrain and scenery materials through the
// shared uniform object (src/shaders/sea-wake-pars.glsl and
// sea-ripple-pars-fragment.glsl).
export function createSeaWakeUniforms() {
	return {
		uSeaWakeMap: { value: null },
		uSeaWakeWindow: { value: new Vector4(0, 0, 1, 1) },
		// Empty (min above max) while the wake is idle.
		uSeaWakeBounds: { value: new Vector4(1, 1, -1, -1) },
		uSeaWakeShape: { value: new Vector4() },
		uSeaWakeFade: { value: new Vector4(0.6, 0.95, 1, 0) },
		uSeaWakeBoat: { value: new Vector2() },
		uSeaWakeFoam: { value: new Vector4() },
		uSeaWakeLines: { value: new Vector4() },
	}
}

// True when the renderer can draw into half-float targets.
function canRenderHalfFloat(renderer) {
	if (!renderer) return true
	const { extensions } = renderer
	return extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float')
}

// The airplane's wake on the sea (rules in src/seaWakePolicy.js). While the
// airplane flies low over the water, a half-float map centered on it runs a
// damped wave equation, one fullscreen pass per step (sea-wake-sim-fragment.glsl)
// that scrolls the previous state by whole texels, absorbs it toward the
// edge, and stamps the airplane's track: the kicks raise the ripples of a
// speedboat's V, the track lays foam. The pass writes the state and, beside
// it, the readers' map (slopes, height, foam), which the sea's vertices,
// normals, and foam and the boats read in one lookup each. Away from the sea,
// or high up, the wake runs until its waves and foam settle, then idles: no
// pass and no lookup.
//
// Ownership: this object owns the two ping-pong targets and the step
// material. `uniforms` is the shared uniform object, which must hold
// createSeaWakeUniforms(); `settings` is params.seaWake
// (createSeaWakeSettings()); `sampleHeight(x, z)` returns the raw terrain
// height, read only while the airplane is low enough to stamp.
export default class SeaWake {
	constructor({ renderer, uniforms, settings, sampleHeight }) {
		this.renderer = renderer
		this.uniforms = uniforms
		this.settings = settings
		this.sampleHeight = sampleHeight
		this.supported = canRenderHalfFloat(renderer)

		this.active = false
		this.needsReset = true
		this.window = null
		this.spareWindow = {}
		// Boxes for the settle time and more (getSeaWakeSettleTime()).
		this.occupancy = createSeaWakeOccupancy(96)
		this.rect = { empty: true }
		this.fade = {}
		this.stepPlan = {}
		this.waves = { speed: 0, courant: 0, clamped: false }
		this.texelA = {}
		this.texelB = {}
		// The airplane now, and where the last step stamped.
		this.point = new Vector3()
		this.stamp = new Vector3()
		// Distance flown within the current pulse (world units).
		this.pulseDistance = 0
		// Flight time gathered for the next advance (isSeaWakeStepDue()).
		this.pendingTime = 0
		this.speed = 0
		this.strength = 0
		// The aileron roll's boost of the stamp (getSeaWakeRollBoost()), from
		// the roll angle of the last frame, and the stamp's gains.
		this.rollBoost = 0
		this.lastRoll = 0
		this.gains = { width: 1, foam: 1, kick: 1 }
		this.totalSteps = 0
		this.lastSteps = 0
		this.resets = 0
		this.lastUpdateMs = 0

		this.material = new ShaderMaterial({
			glslVersion: GLSL3,
			vertexShader: fullscreenVertexShader,
			fragmentShader: simFragmentShader,
			uniforms: {
				uState: { value: null },
				uShift: { value: new Vector2() },
				uReset: { value: 1 },
				uWave: { value: new Vector4() },
				uSponge: { value: new Vector4(0.7, 1, 0, 1) },
				uFade: { value: new Vector2(0.6, 0.95) },
				uStampSegment: { value: new Vector4() },
				uStamp: { value: new Vector4() },
				uStampPulse: { value: new Vector3() },
			},
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		})
		this.quad = new Mesh(new PlaneGeometry(2, 2), this.material)
		this.quad.frustumCulled = false
		this.scene = new Scene()
		this.scene.name = 'sea-wake-step'
		this.scene.add(this.quad)
		// The fullscreen vertex shader writes clip coordinates itself.
		this.camera = new Camera()

		this.targets = []
		this.current = 0
		this.createTargets()
		this.applySettings()
	}

	// Two ping-pong targets, each with the state (height, rate, foam) and the
	// readers' map (slopes, height, foam). Half float: the waves' heights and
	// slopes are small signed values. The steps read the state with
	// texelFetch(), the readers sample the map bilinearly.
	createTargets() {
		for (const target of this.targets) target.dispose()
		const { mapSize } = this.settings
		this.mapSize = mapSize
		this.targets = [0, 1].map((index) => {
			const target = new WebGLRenderTarget(mapSize, mapSize, {
				count: 2,
				format: RGBAFormat,
				type: HalfFloatType,
				depthBuffer: false,
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				generateMipmaps: false,
			})
			target.textures[0].name = `sea-wake-state-${index}`
			target.textures[1].name = `sea-wake-map-${index}`
			return target
		})
		this.current = 0
		this.needsReset = true
		this.uniforms.uSeaWakeMap.value = this.targets[0].textures[1]
	}

	// Compiles the step program before the airplane first flies low
	// (World.precompileShaders()).
	compileAsync() {
		return this.renderer.compileAsync(this.scene, this.camera)
	}

	// Re-reads the live settings.
	applySettings() {
		const { settings, uniforms } = this
		if (settings.mapSize !== this.mapSize) this.createTargets()
		if (settings.radius !== this.radius) {
			this.radius = settings.radius
			this.needsReset = true
		}
		const { shading, foam, lines } = settings
		const fade = getSeaWakeFadeRange(settings, this.fade)
		const margin = settings.occupancy.marginTexels * getSeaWakeTexel(settings)
		this.material.uniforms.uFade.value.set(fade.start, fade.end)
		uniforms.uSeaWakeShape.value.set(
			Math.max(shading.vertexAmplitude, 0),
			shading.normalStrength,
			1 / Math.max(settings.shoreDepth, 1e-3),
			this.active ? 1 : 0,
		)
		uniforms.uSeaWakeFade.value.set(fade.start, fade.end, 1 / Math.max(margin, 1e-3), 0)
		uniforms.uSeaWakeBoat.value.set(shading.boatHeave, shading.boatTilt)
		uniforms.uSeaWakeFoam.value.set(
			foam.intensity,
			foam.laceScale,
			foam.fray,
			getSeaWakeLineWavenumber(settings),
		)
		uniforms.uSeaWakeLines.value.set(
			lines.threshold,
			Math.max(lines.softness, 1e-3),
			lines.halfWidth,
			lines.intensity,
		)
		if (!settings.enabled || !this.supported) this.idle()
	}

	// Forgets the wake at once (World.teleportPlane()).
	reset() {
		this.idle()
	}

	// No pass and no lookup until the airplane stamps again, which starts from
	// calm water.
	idle() {
		this.active = false
		this.window = null
		this.needsReset = true
		this.strength = 0
		this.pendingTime = 0
		clearSeaWakeOccupancy(this.occupancy)
		this.rect.empty = true
		this.uniforms.uSeaWakeShape.value.w = 0
		this.uniforms.uSeaWakeBounds.value.set(1, 1, -1, -1)
	}

	// Runs after the flight, before the main pass. `deltaTime` is the flight's
	// own step (the time the airplane moved by); the debug pause (`paused`)
	// freezes the wake with the flight.
	update(plane, deltaTime, paused = false) {
		const { settings } = this
		this.lastSteps = 0
		if (!this.supported || !settings.enabled || paused) return
		const startTime = performance.now()

		const { point, stamp } = this
		// An aileron roll's speed, from the model's roll angle (the steering
		// bank kept apart); a barrel roll never boosts the stamp.
		const frameTime = Math.max(deltaTime, 0)
		const roll = plane.roll ?? 0
		const rolling = plane.maneuver?.type === MANEUVER.AILERON_ROLL && frameTime > 0
		const rollRate = rolling ? wrapAngle(roll - this.lastRoll) / frameTime : 0
		this.lastRoll = roll
		this.rollBoost = getSeaWakeRollBoost(this.rollBoost, rollRate, frameTime, settings)

		// The airplane itself, off the rig during the maneuvers.
		plane.model.getWorldPosition(point)
		const altitude = getSeaWakeAltitude(point.y)
		let strength = getSeaWakeStrength(altitude, Infinity, settings)
		if (strength > 0) {
			strength = getSeaWakeStrength(altitude, -this.sampleHeight(point.x, point.z), settings)
		}
		this.strength = strength

		if (!this.active) {
			if (strength <= 0) return
			this.active = true
			this.needsReset = true
			this.window = null
			stamp.copy(point)
			this.speed = Math.abs(plane.speed ?? 0)
		}
		if (Math.hypot(point.x - stamp.x, point.z - stamp.z) > settings.radius * JUMP_SHARE) {
			this.needsReset = true
			this.window = null
			clearSeaWakeOccupancy(this.occupancy)
			stamp.copy(point)
		}

		// The flight time since the last advance, which waits for the step rate.
		this.pendingTime += Math.max(deltaTime, 0)
		if (!isSeaWakeStepDue(this.pendingTime, settings)) return
		const time = this.pendingTime
		this.pendingTime = 0
		const moved = Math.hypot(point.x - stamp.x, point.z - stamp.z)
		this.speed = MathUtils.damp(this.speed, moved / time, SPEED_RESPONSE, time)
		// The waves' speed without a cap picks how many steps keep them stable.
		const texel = getSeaWakeTexel(settings)
		const { speed: waveSpeed } = getSeaWakeWaveSpeed(this.speed, texel, 0, settings, this.waves)
		const plan = getSeaWakeSteps(time, settings, this.stepPlan, waveSpeed, texel)
		if (plan.count === 0) return

		const { renderer } = this
		const previousTarget = renderer.getRenderTarget()
		const previousAutoClear = renderer.autoClear
		renderer.autoClear = false
		let ax = stamp.x
		let az = stamp.z
		for (let index = 1; index <= plan.count; index++) {
			const share = index / plan.count
			const bx = stamp.x + (point.x - stamp.x) * share
			const bz = stamp.z + (point.z - stamp.z) * share
			this.step(ax, az, bx, bz, strength, plan.stepTime)
			ax = bx
			az = bz
		}
		renderer.setRenderTarget(previousTarget)
		renderer.autoClear = previousAutoClear
		stamp.copy(point)
		this.lastSteps = plan.count
		this.publish()
		if (this.rect.empty && strength <= 0) this.idle()
		this.lastUpdateMs = performance.now() - startTime
	}

	// One step: the state scrolls to the window around (bx, bz) and the
	// airplane stamps the segment from (ax, az).
	step(ax, az, bx, bz, strength, stepTime) {
		const { settings, renderer } = this
		const { trail, waves: waveSettings, foam } = settings
		const window = getSeaWakeWindow(bx, bz, settings, this.window, this.spareWindow)
		this.spareWindow = this.window ?? {}
		this.window = window
		const reset = this.needsReset || window.reset
		this.needsReset = false
		if (reset) {
			this.resets++
			// The old track is gone with the state.
			clearSeaWakeOccupancy(this.occupancy)
		}

		const { texel } = window
		const waves = getSeaWakeWaveSpeed(this.speed, texel, stepTime, settings, this.waves)
		const uniforms = this.material.uniforms
		uniforms.uState.value = this.targets[this.current].textures[0]
		uniforms.uShift.value.set(window.shiftX, window.shiftZ)
		uniforms.uReset.value = reset ? 1 : 0
		uniforms.uWave.value.set(
			(waves.speed * waves.speed * stepTime) / (texel * texel),
			stepTime,
			getSeaWakeDecay(waveSettings.halfLife, stepTime),
			getSeaWakeDecay(foam.halfLife, stepTime),
		)
		uniforms.uSponge.value.set(
			1 - clamp01(waveSettings.spongeWidth),
			Math.exp(-Math.max(waveSettings.spongeRate, 0) * stepTime),
			getSeaWakeFoamSpread(foam.spread, stepTime, texel),
			texel,
		)

		const a = getSeaWakeTexelPoint(ax, az, window, this.texelA)
		const b = getSeaWakeTexelPoint(bx, bz, window, this.texelB)
		uniforms.uStampSegment.value.set(a.x, a.y, b.x, b.y)
		const length = Math.hypot(bx - ax, bz - az)
		// Wider with the speed, and wider, foamier, and harder in an aileron roll.
		const gains = getSeaWakeStampGains(this.rollBoost, this.speed, settings, this.gains)
		const radius = Math.max(trail.radius * gains.width, MIN_KICK_TEXELS * texel)
		const foamRadius = Math.max(trail.foamRadius * gains.width, MIN_FOAM_TEXELS * texel)
		// Scaled by the step's length, so the kicks a point gets as the track
		// passes add up the same at any frame rate and speed.
		const kick = trail.impulse * gains.kick * strength * Math.min(length / radius, 2)
		uniforms.uStamp.value.set(
			radius / texel,
			kick,
			foamRadius / texel,
			clamp01(trail.foam) * gains.foam * strength,
		)
		const phase = getSeaWakePulsePhase(this.pulseDistance, settings)
		uniforms.uStampPulse.value.set(
			phase,
			phase + getSeaWakePulsePhase(length, settings),
			clamp01(trail.pulseMix),
		)
		// Kept within one pulse, so the phase stays precise in float32.
		this.pulseDistance = (this.pulseDistance + length) % Math.max(trail.pulseSpacing, 1e-3)

		const next = 1 - this.current
		renderer.setRenderTarget(this.targets[next])
		renderer.render(this.scene, this.camera)
		this.current = next
		this.totalSteps++

		const { occupancy } = this
		advanceSeaWakeOccupancy(occupancy, stepTime, waves.speed, getSeaWakeSettleTime(settings))
		if (strength > 0) {
			addSeaWakeStamp(
				occupancy,
				ax,
				az,
				bx,
				bz,
				Math.max(radius, foamRadius),
				settings.occupancy.interval,
			)
		}
	}

	// Hands the readers this step's map, window, and occupied rectangle.
	publish() {
		const { window, uniforms, settings } = this
		uniforms.uSeaWakeMap.value = this.targets[this.current].textures[1]
		uniforms.uSeaWakeWindow.value.set(
			window.x,
			window.z,
			1 / (2 * window.halfSize),
			1 / window.halfSize,
		)
		const margin = settings.occupancy.marginTexels * window.texel
		const rect = getSeaWakeOccupiedRect(this.occupancy, window, margin, this.rect)
		if (rect.empty) uniforms.uSeaWakeBounds.value.set(1, 1, -1, -1)
		else uniforms.uSeaWakeBounds.value.set(rect.minX, rect.minZ, rect.maxX, rect.maxZ)
		uniforms.uSeaWakeShape.value.w = rect.empty ? 0 : 1
	}

	getStats() {
		const { rect, window } = this
		return {
			enabled: this.settings.enabled,
			supported: this.supported,
			active: this.active,
			strength: this.strength,
			radius: this.settings.radius,
			mapSize: this.mapSize,
			texel: window?.texel ?? getSeaWakeTexel(this.settings),
			center: window ? [window.x, window.z] : null,
			speed: this.speed,
			rollBoost: this.rollBoost,
			width: this.gains.width,
			waveSpeed: this.waves.speed,
			courant: this.waves.courant,
			clamped: this.waves.clamped,
			steps: this.lastSteps,
			totalSteps: this.totalSteps,
			resets: this.resets,
			boxes: this.occupancy.boxes.length,
			bounds: rect.empty ? null : [rect.minX, rect.minZ, rect.maxX, rect.maxZ],
			updateMs: this.lastUpdateMs,
		}
	}

	dispose() {
		for (const target of this.targets) target.dispose()
		this.targets.length = 0
		this.material.dispose()
		this.quad.geometry.dispose()
		this.scene.clear()
	}
}
