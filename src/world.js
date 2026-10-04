import { MathUtils, Timer } from 'three'
import { createBiomeOffset } from './biome'
import { getHeight } from './chunkGeometry'
import ChunkManager from './chunkManager'
import Clouds from './clouds'
import CloudShadows from './cloudShadows'
import DayNight from './dayNight'
import Plane from './plane'
import SceneryImpostors from './sceneryImpostors'
import SceneryShadows from './sceneryShadows'
import TerrainSampleDebug from './terrainSampleDebug'
import { CHUNK_SIZE } from './worldConstants'

// Height above the terrain (or the sea) the airplane starts at, and the floor
// it is lifted to when a new seed raises the ground under it.
const SPAWN_CLEARANCE = 60

// Everything the frame loop updates: the day/night cycle (from construction,
// so the loading screen already has its colors), then, once the startup
// assets have loaded (init()), the airplane, scenery impostors and shadows,
// clouds, terrain chunks, and the debug helpers. It owns the frame loop and
// its update order, the world seed, and the runtime terrain actions the
// ?gui=1 panel calls.
//
// `setup` is the RenderSetup, `params` createAppParams(), `uniforms`
// createSharedUniforms(). `airplaneModel` is the AIRPLANE_MODELS entry,
// `features` WORLD_FEATURES. `terrainSamples` shows the ?debug=1 corridor
// markers; `FlightPauseDebug` is the lazily loaded ?debug=1 pause class.
export default class World {
	plane = null
	chunkManager = null
	sceneryImpostors = null
	sceneryShadows = null
	clouds = null
	cloudShadows = null
	terrainSampleDebug = null
	flightPause = null

	constructor({
		setup,
		params,
		uniforms,
		seed,
		airplaneModel,
		features,
		isMobile = false,
		terrainSamples = false,
		FlightPauseDebug = null,
	}) {
		this.setup = setup
		this.camera = setup.camera
		this.params = params
		this.uniforms = uniforms
		// Replaced at runtime by the ?gui=1 World folder through applyWorldSeed().
		this.seed = seed
		this.airplaneModel = airplaneModel
		this.features = features
		this.isMobile = isMobile
		this.terrainSamples = terrainSamples
		this.FlightPauseDebug = FlightPauseDebug

		this.dayNight = new DayNight({
			renderer: setup.renderer,
			scene: setup.scene,
			camera: setup.camera,
			ambientLight: setup.ambientLight,
			sunLight: setup.sunLight,
			moonLight: setup.moonLight,
			uniforms,
			params,
		})

		this.timer = new Timer()
		this.timer.connect(document)
		// Seconds of loop time (uTime). The timer exists since import, so its first
		// delta spans the whole loading time; the clock starts on the loop's first
		// frame instead, which keeps ?time= exact and runs reproducible.
		this.elapsedTime = 0
		this.isFirstFrame = true
		this.tic = this.tic.bind(this)
	}

	// Builds the world from the loaded assets (src/assetLoader.js) and starts
	// the frame loop.
	init(assets) {
		const { renderer, scene } = this.setup
		const { params, uniforms, isMobile } = this
		this.plane = new Plane(assets.planeModel, params, this.camera, this.airplaneModel)

		if (this.features.scenery) {
			this.sceneryImpostors = new SceneryImpostors({
				renderer,
				uniforms,
				params,
				woodTexture: assets.woodTexture,
				isMobile,
			})
			scene.add(this.sceneryImpostors)
		}

		// Without scenery only the airplane casts shadows.
		this.sceneryShadows = new SceneryShadows({
			renderer,
			uniforms,
			settings: params.shadows,
			impostorMaterial: this.sceneryImpostors?.material,
		})
		this.sceneryShadows.setAirplane(this.plane.model, assets.planeShadowGeometry)

		if (this.features.clouds) {
			this.clouds = new Clouds({
				renderer,
				uniforms,
				settings: params.clouds,
				wireframe: params.sceneryWireframe,
				woodTexture: assets.woodTexture,
				seed: this.seed,
				isMobile,
			})
			scene.add(this.clouds)
			this.cloudShadows = new CloudShadows({
				renderer,
				uniforms,
				settings: params.clouds.shadows,
				shadowSettings: params.shadows,
				clouds: this.clouds,
			})
		}

		// Terrain. Every chunk draws its scenery instances with the impostor
		// materials.
		this.chunkManager = new ChunkManager(
			CHUNK_SIZE,
			this.plane,
			params,
			scene,
			uniforms,
			{
				boatModel: assets.boatModel,
				impostorMaterial: this.sceneryImpostors?.material ?? null,
				impostorWireframeMaterial: this.sceneryImpostors?.wireframeMaterial ?? null,
			},
			this.features,
			this.seed,
			{ isMobile },
		)
		this.plane.setTerrainSampler((x, z) => this.sampleHeight(x, z))

		this.plane.position.y = this.getSpawnAltitude(0, 0)
		scene.add(this.plane)
		// A direct scene child: the ribbon is in world space.
		scene.add(this.plane.trails)
		if (this.terrainSamples) {
			this.terrainSampleDebug = new TerrainSampleDebug(uniforms)
			scene.add(this.terrainSampleDebug)
		}
		if (this.FlightPauseDebug) {
			this.flightPause = new this.FlightPauseDebug({
				plane: this.plane,
				camera: this.camera,
				scene,
				domElement: renderer.domElement,
			})
		}

		requestAnimationFrame(this.tic)
	}

	// After the Play intro (src/intro.js): the chase camera starts reacting to
	// the flight and the ?debug=1 pause becomes available.
	startFlight() {
		this.plane.addEffect()
		if (this.flightPause) this.flightPause.canPause = true
	}

	sampleHeight(x, z) {
		return getHeight(x, z, this.chunkManager.noise, this.params, this.chunkManager.biomeOffset)
	}

	getSpawnAltitude(x, z) {
		return Math.max(this.sampleHeight(x, z), 0) + SPAWN_CLEARANCE
	}

	// Switches the world to a new seed: terrain noise, biomes (CPU and shader),
	// scenery, and clouds regenerate around the airplane. Before init() only the
	// seed and the biome uniform change; ChunkManager and Clouds are then created
	// with the new seed.
	applyWorldSeed(seed) {
		if (seed === this.seed) return
		this.seed = seed
		this.clouds?.setSeed(seed)

		if (!this.chunkManager) {
			this.uniforms.uBiomeOffset.value.fromArray(createBiomeOffset(seed))
			return
		}

		this.chunkManager.setSeed(seed)
		this.liftPlaneAboveTerrain()
	}

	// Regenerates every desired chunk after a ?gui=1 terrain parameter change.
	regenerateTerrain() {
		if (!this.chunkManager) return
		this.chunkManager.onParamsChange()
		this.liftPlaneAboveTerrain()
	}

	// After the terrain changes under the airplane, lifts it above the new ground
	// and resets the smoothed corridor so the jump does not trigger a brake.
	liftPlaneAboveTerrain() {
		const { plane } = this
		const floor = this.getSpawnAltitude(plane.position.x, plane.position.z)
		if (plane.position.y < floor) plane.position.y = floor
		plane.resetTerrainState()
	}

	// Shows or recolors the debug wireframe on the near meshes and impostors.
	applySceneryWireframe() {
		this.sceneryImpostors?.applyWireframe()
		this.clouds?.applyWireframe()
	}

	// Compiles the programs that would otherwise compile on first use in flight:
	// near scenery and cloud meshes stay hidden until something enters their
	// band, and cloud shadows render only while a light is up. Program variants
	// depend on the bound render target, so the scene compiles against the
	// offscreen buffer PostProcessing renders it into. With
	// KHR_parallel_shader_compile the driver links them in the background.
	precompileShaders() {
		const { renderer, scene, postProcessing } = this.setup
		const target = renderer.getRenderTarget()
		renderer.setRenderTarget(postProcessing.composer.inputBuffer)
		const compiles = [renderer.compileAsync(scene, this.camera)]
		if (this.cloudShadows) compiles.push(this.cloudShadows.compileAsync())
		renderer.setRenderTarget(target)
		return Promise.all(compiles)
	}

	tic(timestamp) {
		const { frameStats, postProcessing } = this.setup
		const { plane, uniforms } = this
		frameStats.beginFrame(timestamp)
		this.timer.update(timestamp)

		// Seconds since the previous frame, and since the loop started.
		const deltaTime = this.isFirstFrame ? 0 : this.timer.getDelta()
		this.isFirstFrame = false
		this.elapsedTime += deltaTime

		// The debug pause freezes only the flight; global time keeps advancing.
		const isFlightPaused = this.flightPause?.paused ?? false
		if (isFlightPaused) this.flightPause.update()
		// The timer's first delta after the tab is shown again can be negative.
		else plane.update(MathUtils.clamp(deltaTime, 0, 0.016))
		this.terrainSampleDebug?.update(plane.flightCorridor?.samples)
		frameStats.mark('flight')

		uniforms.uTime.value = this.elapsedTime
		uniforms.uCamera.value.copy(plane.position)

		const dayNightState = this.dayNight.update(deltaTime)
		plane.setDayNight(dayNightState)
		frameStats.mark('dayNight')

		this.chunkManager.updateChunks()
		frameStats.mark('chunks')
		// After this frame's scenery commits, with the camera that renders it.
		this.sceneryImpostors?.update(this.chunkManager.chunks, CHUNK_SIZE, this.camera)
		frameStats.mark('scenery')
		this.clouds?.update(plane.position, this.camera)
		frameStats.mark('clouds')
		// Shadow maps for this frame's scenery and airplane pose, before the main pass.
		this.sceneryShadows.update(this.chunkManager.chunks, CHUNK_SIZE, plane, dayNightState)
		// After SceneryShadows picked the shadowing light.
		this.cloudShadows?.update(this.sceneryShadows.light, plane)
		frameStats.mark('shadows')

		// The GUI speedEffect slider holds post-processing at least at that level,
		// even while the flight is paused.
		postProcessing.setSpeedEffect(
			Math.max(isFlightPaused ? 0 : plane.uniforms.uAcceleration.value, this.params.speedEffect),
		)
		postProcessing.render(deltaTime)
		frameStats.mark('render')
		frameStats.endFrame()
		this.setup.adaptPixelRatio(deltaTime * 1000)

		requestAnimationFrame(this.tic)
	}

	// The read-only stats exposed as window.__INFINITE_WORLD__ (docs/QUALITY.md).
	createStatsApi() {
		return Object.freeze({
			getChunkStats: () => this.chunkManager?.getStats() ?? null,
			getFlightStats: () => this.plane?.getStats() ?? null,
			getPostProcessingStats: () => this.setup.postProcessing.getStats(),
			getDebugStats: () => this.flightPause?.getStats() ?? null,
			getDayNightStats: () => this.dayNight.getStats(),
			getSceneryMeshStats: () => this.sceneryImpostors?.getStats() ?? null,
			getShadowStats: () => this.sceneryShadows?.getStats() ?? null,
			getCloudStats: () => this.clouds?.getStats() ?? null,
			getCloudShadowStats: () => this.cloudShadows?.getStats() ?? null,
			getRenderStats: () => this.setup.getStats(),
		})
	}
}
