import {
	BackSide,
	Color,
	Mesh,
	ShaderMaterial,
	SphereGeometry,
	SRGBColorSpace,
	Vector3,
} from 'three'
import { CURVATURE } from './chunk'
import {
	advanceTimeOfDay,
	createDayNightState,
	DAY_NIGHT_DEFAULTS,
	getDayNightState,
	getHorizonDip,
	getTimeOfDayForPaletteTime,
} from './dayNightPolicy'
import skyVertex from './shaders/sky.vert.glsl'
import skyFragment from './shaders/sky.frag.glsl'

// Inside the camera far plane (10000) so the dome is never clipped; the
// vertex shader moves it to the far plane for the depth test.
const SKY_RADIUS = 5000
// Above every other opaque mesh (the debug wireframe overlays use 1).
const SKY_RENDER_ORDER = 10

function setSRGB(color, [r, g, b]) {
	return color.setRGB(r, g, b, SRGBColorSpace)
}

export default class DayNight {
	state = createDayNightState()
	cameraPosition = new Vector3()

	constructor({
		scene,
		camera,
		ambientLight,
		sunLight,
		moonLight,
		uniforms,
		params,
	}) {
		this.scene = scene
		this.camera = camera
		this.ambientLight = ambientLight
		this.sunLight = sunLight
		this.moonLight = moonLight
		this.uniforms = uniforms
		this.params = params
		const settings = params.dayNight
		// params.dayNight.keyframes is edited live from the GUI.
		this.options = {
			...DAY_NIGHT_DEFAULTS,
			keyframes: settings.keyframes,
		}

		this.skyUniforms = {
			uTime: uniforms.uTime,
			uZenith: { value: new Color() },
			uHorizon: { value: new Color() },
			uSunColor: { value: new Color() },
			uSunDirection: { value: new Vector3() },
			uMoonDirection: { value: new Vector3() },
			uStarVisibility: { value: 0 },
			uHorizonDip: { value: 0 },
			uHorizonDipAngle: { value: 0 },
			uGradientHeight: { value: settings.skyGradientHeight },
		}

		// The only ShaderMaterial in the scene: the sky is unlit and ignores fog.
		// It is drawn after every opaque mesh, on the far plane (sky.vert.glsl)
		// with the depth test on, so only the pixels the scene leaves empty run
		// its shader. Samples that alpha-to-coverage impostors leave uncovered
		// keep the cleared depth, so the sky still fills them.
		this.sky = new Mesh(
			new SphereGeometry(SKY_RADIUS, 32, 16),
			new ShaderMaterial({
				uniforms: this.skyUniforms,
				vertexShader: skyVertex,
				fragmentShader: skyFragment,
				side: BackSide,
				depthWrite: false,
				fog: false,
			}),
		)
		this.sky.renderOrder = SKY_RENDER_ORDER
		this.sky.frustumCulled = false
		scene.add(this.sky)

		this.update(0)
	}

	update(deltaSeconds) {
		const settings = this.params.dayNight
		if (!settings.paused) {
			settings.timeOfDay = advanceTimeOfDay(
				settings.timeOfDay,
				deltaSeconds,
				settings.cycleDuration,
			)
		}

		// The curved world's visible edge drops below the horizontal with height.
		this.camera.getWorldPosition(this.cameraPosition)
		const dip = getHorizonDip(this.cameraPosition.y, CURVATURE)

		const state = getDayNightState(
			settings.timeOfDay,
			this.options,
			this.state,
			dip,
		)

		setSRGB(this.scene.fog.color, state.horizon)
		this.scene.fog.near = this.params.fog.near
		this.scene.fog.far = this.params.fog.far
		setSRGB(this.scene.background, state.horizon)
		setSRGB(this.uniforms.uAtmosphere.value, state.atmosphere)

		// No Three.js shadows: only the light direction matters, targets stay at
		// the origin. SceneryShadows reads the directions from the returned state.
		// Peaks come from params.directionalLight (sun) and params.moonLight.
		this.sunLight.position.fromArray(state.sunDirection)
		setSRGB(this.sunLight.color, state.sunColor)
		this.sunLight.intensity = this.params.directionalLight * state.sunIntensity
		this.moonLight.position.fromArray(state.moonDirection)
		setSRGB(this.moonLight.color, state.moonColor)
		this.moonLight.intensity =
			this.params.moonLight * state.moonIntensity
		setSRGB(this.ambientLight.color, state.ambientColor)
		this.ambientLight.intensity =
			this.params.ambientLight * state.ambientIntensity

		setSRGB(this.skyUniforms.uZenith.value, state.zenith)
		setSRGB(this.skyUniforms.uHorizon.value, state.horizon)
		setSRGB(this.skyUniforms.uSunColor.value, state.sunColor)
		this.skyUniforms.uSunDirection.value.fromArray(state.sunDirection)
		this.skyUniforms.uMoonDirection.value.fromArray(state.moonDirection)
		this.skyUniforms.uStarVisibility.value = state.stars
		this.skyUniforms.uHorizonDip.value = Math.sin(dip)
		this.skyUniforms.uHorizonDipAngle.value = dip
		this.skyUniforms.uGradientHeight.value = Math.max(
			settings.skyGradientHeight,
			0.001,
		)

		this.sky.position.copy(this.cameraPosition)

		return state
	}

	// Pauses the cycle where the keyframe's colors apply unblended at the
	// current camera height.
	previewKeyframe(keyframe) {
		const settings = this.params.dayNight
		settings.paused = true
		settings.timeOfDay = getTimeOfDayForPaletteTime(
			keyframe.t,
			this.state.horizonDip,
			this.options.orbitTilt,
		)
	}

	getStats() {
		return {
			timeOfDay: this.state.timeOfDay,
			paused: this.params.dayNight.paused,
			cycleDuration: this.params.dayNight.cycleDuration,
			paletteTime: this.state.paletteTime,
			horizonDip: this.state.horizonDip,
			night: this.state.night,
			sunElevation: this.state.sunElevation,
			moonElevation: this.state.moonElevation,
			sunIntensity: this.state.sunIntensity,
			moonIntensity: this.state.moonIntensity,
		}
	}
}
