import GUI from 'lil-gui'
import {
	ACESFilmicToneMapping,
	AgXToneMapping,
	CineonToneMapping,
	LinearToneMapping,
	NeutralToneMapping,
	NoToneMapping,
	ReinhardToneMapping,
} from 'three'
import { CLOUD_TYPE_KEYS } from '../cloudPlacement'
import { copyKeyframe, DAY_NIGHT_DEFAULTS } from '../dayNightPolicy'
import { SCENERY_CATEGORIES, SCENERY_CELL_SIZES, SCENERY_TYPE_KEYS } from '../sceneryPlacement'
import { TERRAIN_BANDS } from '../terrainBands'
import { updateTerrainNormalUniforms } from '../terrainNormals'
import { createRandomSeed, normalizeWorldSeed } from '../worldSeed'

// The ?gui=1 tuning panel (lil-gui), loaded only behind that flag so the
// default bundle does not carry it. Every control edits `params`
// (createAppParams()) or a shared uniform, then calls the owner that applies
// the change: `world` (src/world.js) for the seed, terrain, scenery, clouds,
// and shadows, `setup` (src/renderSetup.js) for tone mapping and
// post-processing. It is created before the startup assets load, so a
// world system may not exist yet: its controls then only edit `params`,
// which the system reads when it is created.
export function createDebugGui({ params, uniforms, setup, world }) {
	const gui = new GUI()
	const regenerateTerrain = () => world.regenerateTerrain()
	const applySceneryWireframe = () => world.applySceneryWireframe()
	const updateImpostorVariation = () => world.sceneryImpostors?.applyVariation()

	const worldSettings = {
		seed: world.seed,
		randomSeed() {
			worldSettings.seed = createRandomSeed()
			world.applyWorldSeed(worldSettings.seed)
			seedController.updateDisplay()
		},
	}
	const worldFolder = gui.addFolder('World')
	const seedController = worldFolder
		.add(worldSettings, 'seed')
		.name('Seed')
		.onFinishChange((value) => {
			const seed = normalizeWorldSeed(value)
			// A blank value restores the current seed.
			worldSettings.seed = seed ?? world.seed
			seedController.updateDisplay()
			if (seed) world.applyWorldSeed(seed)
		})
	worldFolder.add(worldSettings, 'randomSeed').name('Random seed')

	const terrainFolder = gui.addFolder('Terrain')
	terrainFolder.addColor(params.colors, 'uGrass').onChange((val) => {
		uniforms.uGrass.value.set(val)
	})

	terrainFolder.addColor(params.colors, 'uLand').onChange((val) => {
		uniforms.uLand.value.set(val)
	})

	terrainFolder.addColor(params.colors, 'uRocks').onChange((val) => {
		uniforms.uRocks.value.set(val)
	})
	// Each change regenerates every desired chunk, so it waits for the release.
	terrainFolder.add(params, 'amplitude', 0, 100, 0.1).onFinishChange(regenerateTerrain)
	terrainFolder.add(params, 'octaves', 1, 10, 1).onFinishChange(regenerateTerrain)
	terrainFolder.add(params, 'persistance', 0, 1, 0.05).onFinishChange(regenerateTerrain)
	terrainFolder.add(params, 'lacunarity', 1, 5, 0.5).onFinishChange(regenerateTerrain)
	terrainFolder.add(params.frequency, 'x', 0.01, 2, 0.01).onFinishChange(regenerateTerrain)
	terrainFolder.add(params.frequency, 'z', 0.01, 2, 0.01).onFinishChange(regenerateTerrain)

	const colorNoiseFolder = terrainFolder.addFolder('Color noise')
	const colorNoiseControls = [
		['frequency', 'Frequency', 0.0005, 0.05, 0.0005, 'uColorNoiseFrequency'],
		['intensity', 'Intensity', 0, 1, 0.01, 'uColorNoiseIntensity'],
		['threshold', 'Threshold', 0, 1, 0.01, 'uColorNoiseThreshold'],
		['softness', 'Softness', 0.01, 0.5, 0.01, 'uColorNoiseSoftness'],
		['speed', 'Speed', 0, 0.3, 0.005, 'uColorNoiseSpeed'],
	]
	for (const [key, label, min, max, step, uniform] of colorNoiseControls) {
		colorNoiseFolder
			.add(params.terrainColorNoise, key, min, max, step)
			.name(label)
			.onChange((value) => {
				uniforms[uniform].value = value
			})
	}

	const desertFolder = terrainFolder.addFolder('Desert topography')
	desertFolder
		.add(params.desert, 'frequency', 0.1, 2, 0.01)
		.name('Detail frequency ×')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'amplitude', 0, 2, 0.01)
		.name('Detail amplitude ×')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'blend', 0.01, 0.4, 0.005)
		.name('Blend width')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'flatten', 0, 1, 0.01)
		.name('Height reduction')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'depth', 0.01, 1.5, 0.01)
		.name('Reduction depth')
		.onFinishChange(regenerateTerrain)

	const updateTerrainNormals = () => updateTerrainNormalUniforms(uniforms, params.terrainNormals)
	const terrainNormalsFolder = terrainFolder.addFolder('Normal maps')
	terrainNormalsFolder
		.add(params.terrainNormals.fade, 'start', 0, 1000, 1)
		.name('Fade start (units)')
		.onChange(updateTerrainNormals)
	terrainNormalsFolder
		.add(params.terrainNormals.fade, 'end', 1, 2000, 1)
		.name('Fade end (units)')
		.onChange(updateTerrainNormals)
	for (const band of TERRAIN_BANDS) {
		const layer = params.terrainNormals[band]
		const folder = terrainNormalsFolder.addFolder(
			`${band[0].toUpperCase()}${band.slice(1)} (${layer.texture})`,
		)
		folder.add(layer, 'scale', 1, 100, 0.1).name('Tile size (units)').onChange(updateTerrainNormals)
		folder.add(layer, 'strength', 0, 5, 0.01).name('Strength').onChange(updateTerrainNormals)
		folder.add(layer, 'rotation', 0, 360, 1).name('Rotation (°)').onChange(updateTerrainNormals)
	}

	const lightsFolder = gui.addFolder('Lights')
	lightsFolder.add(params, 'directionalLight', 0, 10, 0.1)
	lightsFolder.add(params, 'moonLight', 0, 3, 0.05)
	lightsFolder.add(params, 'ambientLight', 0, 10, 0.1)

	const dayNightFolder = gui.addFolder('Day/night')
	dayNightFolder.add(params.dayNight, 'timeOfDay', 0, 0.9999, 0.0001).name('Time of day').listen()
	dayNightFolder.add(params.dayNight, 'cycleDuration', 10, 1200, 1).name('Cycle duration (s)')
	dayNightFolder.add(params.dayNight, 'paused').name('Paused').listen()

	const skyFolder = gui.addFolder('Sky')
	skyFolder.add(params.dayNight, 'skyGradientHeight', 0.02, 1, 0.005).name('Gradient height (rad)')
	skyFolder.add(params.fog, 'near', 0, 2000, 10).name('Fog near')
	skyFolder.add(params.fog, 'far', 100, 3000, 10).name('Fog far')

	// One folder per keyframe; Preview pauses the cycle on that keyframe.
	const paletteFolder = skyFolder.addFolder('Palette')
	const paletteColors = {
		zenith: 'Zenith',
		horizon: 'Horizon / fog',
		atmosphere: 'Atmosphere',
		sunColor: 'Sun',
		moonColor: 'Moon',
		ambientColor: 'Ambient',
		trailTint: 'Trail tint',
	}
	const paletteScalars = {
		sunIntensity: ['Sun intensity', 2],
		moonIntensity: ['Moon intensity', 2],
		ambientIntensity: ['Ambient intensity', 2],
		stars: ['Stars', 1],
	}
	const paletteActions = {
		copy() {
			const json = JSON.stringify(
				params.dayNight.keyframes,
				(key, value) => (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value),
				'\t',
			)
			console.log(json)
			navigator.clipboard?.writeText(json).catch(() => {})
		},
		reset() {
			DAY_NIGHT_DEFAULTS.keyframes.forEach((keyframe, index) =>
				copyKeyframe(keyframe, params.dayNight.keyframes[index]),
			)
			for (const controller of paletteFolder.controllersRecursive()) {
				controller.updateDisplay()
			}
		},
	}
	paletteFolder.add(paletteActions, 'copy').name('Copy palette JSON')
	paletteFolder.add(paletteActions, 'reset').name('Reset palette')
	for (const keyframe of params.dayNight.keyframes) {
		const folder = paletteFolder.addFolder(`${keyframe.name} (${keyframe.t.toFixed(2)})`)
		folder
			.add({ preview: () => world.dayNight.previewKeyframe(keyframe) }, 'preview')
			.name('Preview')
		for (const [field, label] of Object.entries(paletteColors)) {
			folder.addColor(keyframe, field).name(label)
		}
		for (const [field, [label, max]] of Object.entries(paletteScalars)) {
			folder.add(keyframe, field, 0, max, 0.01).name(label)
		}
	}

	const toneMappingFolder = gui.addFolder('Tone mapping')
	toneMappingFolder
		.add(params.toneMapping, 'mode', {
			None: NoToneMapping,
			Linear: LinearToneMapping,
			Reinhard: ReinhardToneMapping,
			Cineon: CineonToneMapping,
			'ACES Filmic': ACESFilmicToneMapping,
			AgX: AgXToneMapping,
			Neutral: NeutralToneMapping,
		})
		.name('Mode')
		.onChange((mode) => setup.setToneMapping(mode))
	// Three.js ignores exposure while the mode is None.
	toneMappingFolder
		.add(params.toneMapping, 'exposure', 0, 4, 0.01)
		.name('Exposure')
		.onChange((exposure) => {
			setup.renderer.toneMappingExposure = exposure
		})

	const grainFolder = gui.addFolder('Film grain')
	grainFolder.add(params.postProcessing.grain, 'intensity', 0, 0.3, 0.005).name('Intensity')

	const updatePost = () => setup.postProcessing.speedEffect.setParams(params.postProcessing)
	const speedFolder = gui.addFolder('Speed effect')
	// Read by tic(): holds the edge effect at least at this speed effect.
	speedFolder.add(params, 'speedEffect', 0, 1, 0.01)
	speedFolder.add(params.postProcessing, 'preview', 0, 1, 0.01)
	speedFolder.add(params.postProcessing, 'idleSpeedEffect', 0, 1, 0.01).name('Idle level')
	speedFolder
		.add(params.postProcessing, 'verticalScale', 0, 1, 0.01)
		.name('Vertical scale')
		.onChange(updatePost)
	const blurFolder = speedFolder.addFolder('Blur')
	blurFolder.add(params.postProcessing.blur, 'strength', 0, 0.15, 0.001).onChange(updatePost)
	blurFolder.add(params.postProcessing.blur, 'start', 0, 1, 0.01).onChange(updatePost)
	blurFolder.add(params.postProcessing.blur, 'end', 0, 1.5, 0.01).onChange(updatePost)
	blurFolder.add(params.postProcessing.blur, 'curve', 0.1, 5, 0.05).onChange(updatePost)
	const aberrationFolder = speedFolder.addFolder('Chromatic aberration')
	aberrationFolder
		.add(params.postProcessing.aberration, 'strength', 0, 0.05, 0.0005)
		.onChange(updatePost)
	aberrationFolder.add(params.postProcessing.aberration, 'start', 0, 1, 0.01).onChange(updatePost)
	aberrationFolder.add(params.postProcessing.aberration, 'end', 0, 1.5, 0.01).onChange(updatePost)
	aberrationFolder.add(params.postProcessing.aberration, 'curve', 0.1, 5, 0.05).onChange(updatePost)

	// Scenery changes re-place instances in the workers when a control is
	// released; terrain is not regenerated.
	const updateScenery = () => world.chunkManager?.onSceneryChange()
	const sceneryFolder = gui.addFolder('Scenery')
	sceneryFolder
		.add(params.scenery, 'cellSize', SCENERY_CELL_SIZES)
		.name('Grid cell (units)')
		.onFinishChange(updateScenery)
	sceneryFolder
		.add(params.scenery, 'maxPerChunk', 0, 4096, 1)
		.name('Max per chunk')
		.onFinishChange(updateScenery)
	const rebakeImpostors = () => world.sceneryImpostors?.rebake()
	const detailFolder = sceneryFolder.addFolder('Wood detail')
	detailFolder
		.add(params.impostorDetail, 'scale', 0.02, 1, 0.01)
		.name('Repeats per unit')
		.onFinishChange(rebakeImpostors)
	detailFolder
		.add(params.impostorDetail, 'color', 0, 1, 0.01)
		.name('Color strength')
		.onFinishChange(rebakeImpostors)
	const wireframeSettings = params.sceneryWireframe
	const wireframeFolder = sceneryFolder.addFolder('Wireframe')
	wireframeFolder
		.add(wireframeSettings, 'enabled')
		.name('Show wireframe')
		.onChange(applySceneryWireframe)
	wireframeSettings.meshColors.forEach((_, lod) =>
		wireframeFolder
			.addColor(wireframeSettings.meshColors, lod)
			.name(`LOD ${lod} mesh`)
			.onChange(applySceneryWireframe),
	)
	wireframeFolder
		.addColor(wireframeSettings, 'impostorColor')
		.name('Impostor')
		.onChange(applySceneryWireframe)
	// Live: only the shader band and the CPU selection radius change.
	const updateSceneryMeshes = () => world.sceneryImpostors?.applyMeshSettings()
	const meshFolder = sceneryFolder.addFolder('Near meshes')
	meshFolder.add(params.sceneryMeshes, 'enabled').name('Enabled').onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'lodStart', 0, 400, 1)
		.name('Full detail until (units)')
		.onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'lodEnd', 1, 500, 1)
		.name('Reduced detail from (units)')
		.onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'start', 0, 600, 1)
		.name('Mesh until (units)')
		.onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'end', 1, 700, 1)
		.name('Impostor from (units)')
		.onChange(updateSceneryMeshes)
	sceneryFolder
		.add(params.impostorVariation, 'frequency', 0.001, 0.1, 0.001)
		.name('Variation frequency')
		.onChange(updateImpostorVariation)
	const sceneryLabels = { trees: 'Trees', cacti: 'Cacti', rocks: 'Rocks' }
	for (const [category, types] of Object.entries(SCENERY_CATEGORIES)) {
		const folder = sceneryFolder.addFolder(sceneryLabels[category])
		folder
			.add(params.scenery.density, category, 0, 4, 0.01)
			.name('Density')
			.onFinishChange(updateScenery)
		for (const type of types) {
			const key = SCENERY_TYPE_KEYS[type]
			folder
				.add(params.scenery.size, key, 0.1, 4, 0.01)
				.name(`${key} size`)
				.onFinishChange(updateScenery)
			folder
				.add(params.impostorVariation.amount, key, 0, 2, 0.01)
				.name(`${key} variation`)
				.onChange(updateImpostorVariation)
		}
	}

	const cloudSettings = params.clouds
	const cloudsFolder = gui.addFolder('Clouds')
	// Placement changes re-place the field when a control is released.
	const updateClouds = () => world.clouds?.applySettings()
	const placement = cloudSettings.placement
	cloudsFolder.add(placement, 'density', 0, 1, 0.01).name('Density').onFinishChange(updateClouds)
	cloudsFolder
		.add(placement, 'coverage', 0, 1, 0.01)
		.name('Sky coverage')
		.onFinishChange(updateClouds)
	cloudsFolder
		.add(placement.altitude, 'min', 110, 300, 1)
		.name('Lowest base (Y)')
		.onFinishChange(updateClouds)
	cloudsFolder
		.add(placement.altitude, 'range', 0, 150, 1)
		.name('Base spread (units)')
		.onFinishChange(updateClouds)
	cloudsFolder
		.add(placement, 'radius', 400, 2000, 10)
		.name('Field radius (units)')
		.onFinishChange(updateClouds)
	for (const key of Object.values(CLOUD_TYPE_KEYS)) {
		cloudsFolder
			.add(placement.size, key, 0.2, 3, 0.01)
			.name(`${key} size`)
			.onFinishChange(updateClouds)
	}
	// Smooth changes of density, coverage, and size across the world; altitude
	// and radius never vary.
	const regionalFolder = cloudsFolder.addFolder('Regional variation')
	regionalFolder
		.add(placement.regional, 'scale', 500, 12000, 50)
		.name('Region size (units)')
		.onFinishChange(updateClouds)
	regionalFolder
		.add(placement.regional, 'density', 0, 1, 0.01)
		.name('Density (±share)')
		.onFinishChange(updateClouds)
	regionalFolder
		.add(placement.regional, 'coverage', 0, 0.6, 0.01)
		.name('Coverage (±)')
		.onFinishChange(updateClouds)
	regionalFolder
		.add(placement.regional, 'size', 0, 1.5, 0.01)
		.name('Size (±stops)')
		.onFinishChange(updateClouds)
	// Live: ambient boost and brightness variation uniforms.
	const updateCloudAppearance = () => world.clouds?.applyAppearance()
	cloudsFolder
		.add(cloudSettings, 'ambient', 0, 4, 0.01)
		.name('Ambient boost')
		.onChange(updateCloudAppearance)
	cloudsFolder
		.add(cloudSettings.variation, 'frequency', 0.0005, 0.05, 0.0005)
		.name('Variation frequency')
		.onChange(updateCloudAppearance)
	for (const key of Object.values(CLOUD_TYPE_KEYS)) {
		cloudsFolder
			.add(cloudSettings.variation.amount, key, 0, 2, 0.01)
			.name(`${key} variation`)
			.onChange(updateCloudAppearance)
	}
	const rebakeClouds = () => world.clouds?.rebake()
	const cloudDetailFolder = cloudsFolder.addFolder('Wood detail')
	cloudDetailFolder
		.add(cloudSettings.detail, 'scale', 0.002, 0.2, 0.001)
		.name('Repeats per unit')
		.onFinishChange(rebakeClouds)
	cloudDetailFolder
		.add(cloudSettings.detail, 'color', 0, 1, 0.01)
		.name('Color strength')
		.onFinishChange(rebakeClouds)
	// Live: only the shader band and the CPU selection radius change.
	const updateCloudMeshes = () => world.clouds?.applyMeshSettings()
	const cloudMeshFolder = cloudsFolder.addFolder('Near meshes')
	cloudMeshFolder.add(cloudSettings.meshes, 'enabled').name('Enabled').onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'lodStart', 0, 800, 1)
		.name('Full detail until (units)')
		.onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'lodEnd', 1, 900, 1)
		.name('Reduced detail from (units)')
		.onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'start', 0, 1400, 1)
		.name('Mesh until (units)')
		.onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'end', 1, 1500, 1)
		.name('Impostor from (units)')
		.onChange(updateCloudMeshes)
	// Strength applies live; the rest renders the map again.
	const updateCloudShadows = () => world.cloudShadows?.applySettings()
	const cloudShadowsFolder = cloudsFolder.addFolder('Shadows')
	cloudShadowsFolder.add(cloudSettings.shadows, 'enabled').name('Enabled')
	cloudShadowsFolder.add(cloudSettings.shadows, 'strength', 0, 1, 0.01).name('Strength')
	cloudShadowsFolder
		.add(cloudSettings.shadows, 'softness', 0, 20, 0.1)
		.name('Softness (units)')
		.onChange(updateCloudShadows)
	cloudShadowsFolder
		.add(cloudSettings.shadows, 'radius', 200, 2000, 10)
		.name('Radius (units)')
		.onChange(updateCloudShadows)

	// Live: uniforms only; cascade radii render every cascade again.
	const updateShadows = () => world.sceneryShadows?.applySettings()
	const shadowsFolder = gui.addFolder('Shadows')
	shadowsFolder.add(params.shadows, 'enabled').name('Enabled')
	shadowsFolder.add(params.shadows, 'strength', 0, 1, 0.01).name('Strength')
	shadowsFolder
		.add(params.shadows.softness, 'near', 0, 4, 0.05)
		.name('Softness near (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows.softness, 'far', 0, 8, 0.05)
		.name('Softness far (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows.fade, 'start', 0, 600, 1)
		.name('Fade start (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows.fade, 'end', 1, 800, 1)
		.name('Fade end (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows, 'bias', 0, 1, 0.01)
		.name('Depth bias (units)')
		.onChange(updateShadows)
	params.shadows.cascades.forEach((cascade, index) => {
		shadowsFolder
			.add(cascade, 'radius', 20, 1000, 1)
			.name(`${index === 0 ? 'Near' : 'Far'} cascade radius`)
			.onChange(updateShadows)
	})

	// Live: the adaptive ratio reads these every frame.
	const performanceFolder = gui.addFolder('Performance')
	performanceFolder.add(params.pixelRatio, 'enabled').name('Adaptive resolution')
	performanceFolder.add(params.pixelRatio, 'min', 0.5, 2, 0.05).name('Minimum pixel ratio')

	const airplaneFolder = gui.addFolder('Airplane')
	airplaneFolder.add(params.propeller, 'speed', 0, 20, 0.1).name('Propeller speed (turns/s)')

	const trailsFolder = gui.addFolder('Trails')
	trailsFolder.add(params.trails, 'ribbonWidth', 7.5, 12, 0.1).name('Ribbon width')
	trailsFolder.add(params.trails, 'lineWidth', 0, 1.5, 0.01).name('Line width')
	trailsFolder.add(params.trails, 'borderWidth', 0, 0.15, 0.005).name('Black border width')
	const outerEdgeFolder = trailsFolder.addFolder('Outer edge')
	outerEdgeFolder.add(params.trails.outerEdge, 'frequency', 0.1, 8, 0.1)
	outerEdgeFolder.add(params.trails.outerEdge, 'amplitude', 0, 0.5, 0.005)
	const innerEdgeFolder = trailsFolder.addFolder('Inner edge')
	innerEdgeFolder.add(params.trails.innerEdge, 'frequency', 0.1, 8, 0.1)
	innerEdgeFolder.add(params.trails.innerEdge, 'amplitude', 0, 0.5, 0.005)
	const oscillationFolder = trailsFolder.addFolder('Oscillation')
	oscillationFolder.add(params.trails.oscillation, 'frequency', 0.01, 0.3, 0.005)
	oscillationFolder.add(params.trails.oscillation, 'amplitude', 0, 0.5, 0.005)

	// Every panel starts closed.
	for (const folder of gui.foldersRecursive()) folder.close()

	return gui
}
