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
import { SCENERY_BIOME_SLOTS, SCENERY_PALETTE_TYPES } from '../sceneryPalettePolicy'
import { SCENERY_CATEGORIES, SCENERY_CELL_SIZES, SCENERY_TYPE_KEYS } from '../sceneryPlacement'
import { BIOME, TERRAIN_BANDS } from '../terrainBands'
import { updateTerrainNormalUniforms } from '../terrainNormals'
import { TERRAIN_PALETTE_BANDS, TERRAIN_SEA_COLORS } from '../terrainPalettePolicy'
import {
	updateBiomeUniforms,
	updateCoastMaskUniforms,
	updateSeaIceUniforms,
	updateTerrainPaletteUniforms,
} from '../sharedUniforms'
import { createRandomSeed, CURATED_SEEDS, normalizeWorldSeed } from '../worldSeed'
import BiomeMap from './biomeMap'

// The ?gui=1 tuning panel (lil-gui), loaded only behind that flag so the
// default bundle does not carry it. Every control edits `params`
// (createAppParams()) or a shared uniform, then calls the owner that applies
// the change: `world` (src/world.js) for the seed, terrain, scenery, clouds,
// and shadows, `setup` (src/renderSetup.js) for tone mapping and
// post-processing. It is created before the startup assets load, so a
// world system may not exist yet: its controls then only edit `params`,
// which the system reads when it is created. It also owns the biome map
// (src/debug/biomeMap.js) and renders it again after every change it shows.
export function createDebugGui({ params, uniforms, setup, world }) {
	const gui = new GUI()
	const biomeMap = new BiomeMap({ params, world })
	const regenerateTerrain = () => {
		world.regenerateTerrain()
		biomeMap.invalidate()
	}
	const applySceneryWireframe = () => world.applySceneryWireframe()
	const updateImpostorVariation = () => world.sceneryImpostors?.applyVariation()
	const updatePalette = () => world.sceneryImpostors?.applyPalette()
	const updateTerrainPalette = () => updateTerrainPaletteUniforms(uniforms, params.terrainPalette)

	// The text field and the list both show worldSettings.seed.
	const applySeed = (seed) => {
		worldSettings.seed = seed
		world.applyWorldSeed(seed)
		biomeMap.invalidate()
		seedController.updateDisplay()
		seedListController.updateDisplay()
	}
	const worldSettings = {
		seed: world.seed,
		randomSeed: () => applySeed(createRandomSeed()),
	}
	const worldFolder = gui.addFolder('World')
	const seedController = worldFolder
		.add(worldSettings, 'seed')
		.name('Seed')
		.onFinishChange((value) => {
			// A blank value restores the current seed.
			applySeed(normalizeWorldSeed(value) ?? world.seed)
		})
	const seedListController = worldFolder
		.add(worldSettings, 'seed', CURATED_SEEDS)
		.name('Seed list')
		.onChange(applySeed)
	worldFolder.add(worldSettings, 'randomSeed').name('Random seed')

	addBiomeControls()

	const terrainFolder = gui.addFolder('Terrain')
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

	const coastFolder = terrainFolder.addFolder('Coast')
	coastFolder
		.add(params.coast, 'amplitude', 0, 6, 0.05)
		.name('Relief height')
		.onFinishChange(regenerateTerrain)
	coastFolder
		.add(params.coast, 'frequency', 0.01, 0.3, 0.005)
		.name('Relief frequency')
		.onFinishChange(regenerateTerrain)
	coastFolder
		.add(params.coastSand, 'shade', 0, 1, 0.01)
		.name('Sand shade')
		.onChange((value) => {
			uniforms.uCoastSandShade.value = value
		})
	// The mask places the relief, the darker sand, and the sea rocks: the
	// shader reads it at once, and the release regenerates terrain and scenery.
	const updateCoastMask = () => {
		updateCoastMaskUniforms(uniforms, params.coast.mask)
		regenerateTerrain()
	}
	const coastMaskFolder = coastFolder.addFolder('Rocky coast mask')
	const coastMaskControls = [
		['frequency', 'Patch frequency', 0.0005, 0.02, 0.0005],
		['detailFrequency', 'Detail frequency', 0.001, 0.08, 0.001],
		['detailWeight', 'Detail weight', 0, 1, 0.01],
		['threshold', 'Threshold', -1, 1.2, 0.01],
		['softness', 'Softness', 0.01, 1, 0.01],
	]
	for (const [key, label, min, max, step] of coastMaskControls) {
		coastMaskFolder
			.add(params.coast.mask, key, min, max, step)
			.name(label)
			.onFinishChange(updateCoastMask)
	}
	// Live; the reach and radius render the map again.
	const updateSeaFoam = () => world.seaFoam?.applySettings()
	const seaFoamFolder = coastFolder.addFolder('Sea foam')
	seaFoamFolder.add(params.seaFoam, 'enabled').name('Enabled').onChange(updateSeaFoam)
	seaFoamFolder.add(params.seaFoam, 'strength', 0, 1, 0.01).name('Strength').onChange(updateSeaFoam)
	seaFoamFolder
		.add(params.seaFoam, 'reach', 1, 30, 0.5)
		.name('Reach (units)')
		.onChange(updateSeaFoam)
	seaFoamFolder
		.add(params.seaFoam, 'edgeDepth', -8, -2, 0.05)
		.name('Edge depth')
		.onChange(updateSeaFoam)
	seaFoamFolder
		.add(params.seaFoam, 'slope', 0.05, 2, 0.01)
		.name('Depth per unit')
		.onChange(updateSeaFoam)
	seaFoamFolder
		.add(params.seaFoam, 'blend', 0, 6, 0.05)
		.name('Blend with coast')
		.onChange(updateSeaFoam)
	seaFoamFolder
		.add(params.seaFoam, 'radius', 100, 1500, 10)
		.name('Radius (units)')
		.onChange(updateSeaFoam)

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

	// Tuning starts with the cycle paused, at the debug (or ?time=) time.
	params.dayNight.paused = true
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
	// Three.js ignores exposure while the mode is None. DayNight blends the two
	// by the cycle's night factor every frame.
	toneMappingFolder.add(params.toneMapping, 'exposure', 0, 4, 0.01).name('Day exposure')
	toneMappingFolder.add(params.toneMapping, 'nightExposure', 0, 4, 0.01).name('Night exposure')

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
	// Per type; releasing a control re-bakes the atlas.
	const rebakeImpostors = () => world.sceneryImpostors?.rebake()
	const detailFolder = sceneryFolder.addFolder('Wood detail')
	for (const key of Object.values(SCENERY_TYPE_KEYS)) {
		const typeDetail = params.impostorDetail[key]
		const typeFolder = detailFolder.addFolder(key)
		typeFolder
			.add(typeDetail, 'scale', 0.002, 0.5, 0.001)
			.name('Repeats per unit')
			.onFinishChange(rebakeImpostors)
		typeFolder
			.add(typeDetail, 'color', 0, 1, 0.01)
			.name('Color strength')
			.onFinishChange(rebakeImpostors)
		typeFolder.add(typeDetail, 'normalized').name('Keep base color').onFinishChange(rebakeImpostors)
	}
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
	const sceneryLabels = {
		trees: 'Trees',
		cacti: 'Cacti',
		rocks: 'Rocks',
		seaRocks: 'Sea rocks',
		boats: 'Boats',
	}
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
		// The palettes live in the Biomes folders.
		if (category === 'seaRocks') addSeaRockControls(folder)
		if (category === 'boats') addBoatControls(folder)
	}

	// The sea rocks' depth, scale range, and satellites (settings.seaRocks);
	// the release re-places the scenery.
	function addSeaRockControls(folder) {
		const { seaRocks } = params.scenery
		folder.add(seaRocks, 'maxDepth', 0.5, 15, 0.1).name('Max depth').onFinishChange(updateScenery)
		folder.add(seaRocks.scale, 'min', 0.05, 3, 0.01).name('Min scale').onFinishChange(updateScenery)
		folder.add(seaRocks.scale, 'max', 0.1, 4, 0.01).name('Max scale').onFinishChange(updateScenery)
		folder
			.add(seaRocks.scale, 'bias', 0.2, 4, 0.05)
			.name('Small rock bias')
			.onFinishChange(updateScenery)
		const satellites = folder.addFolder('Satellites')
		satellites
			.add(seaRocks.satellites, 'count', 0, 6, 1)
			.name('Max count')
			.onFinishChange(updateScenery)
		satellites
			.add(seaRocks.satellites.distance, 'min', 0.5, 3, 0.05)
			.name('Min distance ×')
			.onFinishChange(updateScenery)
		satellites
			.add(seaRocks.satellites.distance, 'max', 0.5, 3, 0.05)
			.name('Max distance ×')
			.onFinishChange(updateScenery)
		satellites
			.add(seaRocks.satellites.scale, 'min', 0.1, 1, 0.01)
			.name('Min size ×')
			.onFinishChange(updateScenery)
		satellites
			.add(seaRocks.satellites.scale, 'max', 0.1, 1, 0.01)
			.name('Max size ×')
			.onFinishChange(updateScenery)
	}

	// The boats' depth band, count, draft, and rock clearance
	// (settings.boats); the release re-places the scenery.
	function addBoatControls(folder) {
		const { boats } = params.scenery
		folder.add(boats.depth, 'min', 0, 40, 0.5).name('Min depth').onFinishChange(updateScenery)
		folder.add(boats.depth, 'max', 1, 60, 0.5).name('Max depth').onFinishChange(updateScenery)
		folder.add(boats, 'maxPerChunk', 0, 4, 1).name('Max per chunk').onFinishChange(updateScenery)
		folder.add(boats, 'draft', 0, 3, 0.05).name('Draft').onFinishChange(updateScenery)
		folder
			.add(boats, 'rockClearance', 0, 20, 0.5)
			.name('Rock clearance')
			.onFinishChange(updateScenery)
	}

	// Live: a category's palettes (trunk colors, palette colors and weights)
	// and the noise that distributes them.
	function addPalette(parent, group, name) {
		const { noise, palettes } = params.sceneryPalette
		const folder = parent.addFolder(name)
		if (noise[group]) {
			folder
				.add(noise[group], 'frequency', 0.0005, 0.1, 0.0005)
				.name('Patch frequency')
				.onChange(updatePalette)
			folder.add(noise[group], 'mix', 0, 1, 0.01).name('Random mix').onChange(updatePalette)
		}
		const keys = new Set(
			Object.values(SCENERY_PALETTE_TYPES)
				.filter((entry) => entry.group === group)
				.map((entry) => entry.palette),
		)
		for (const key of keys) {
			const palette = palettes[key]
			if (!palette) continue
			// A group with one palette (the cacti) shows it directly.
			const paletteFolder = keys.size > 1 ? folder.addFolder(key) : folder
			if (palette.trunk !== undefined) {
				paletteFolder.addColor(palette, 'trunk').name('Trunk').onChange(updatePalette)
			}
			palette.colors.forEach((entry, slot) => {
				const label = entry.label ?? `Color ${slot + 1}`
				paletteFolder.addColor(entry, 'color').name(label).onChange(updatePalette)
				paletteFolder
					.add(entry, 'weight', 0, 1, 0.01)
					.name(`${label} weight`)
					.onChange(updatePalette)
			})
		}
	}

	// One folder per biome with its colors and topography, after the
	// distribution of the biomes and the map that shows it.
	function addBiomeControls() {
		const biomesFolder = gui.addFolder('Biomes')

		// The shader and the map follow at once; the release regenerates the
		// terrain and its scenery, whose heights depend on the biomes.
		const updateBiomes = () => {
			updateBiomeUniforms(uniforms, params.biomes)
			biomeMap.invalidate()
		}
		const distributionFolder = biomesFolder.addFolder('Distribution')
		const distributionControls = [
			['size', 'Biome size ×', 0.3, 5, 0.05],
			['desertBias', 'Desert share', -0.6, 0.6, 0.01],
			['iceSize', 'Ice size ×', 0.25, 4, 0.05],
			['iceThreshold', 'Ice rarity', 0.2, 1.1, 0.01],
			// Below the desert and ice blends, their topographies overlap.
			['iceRing', 'Forest ring', 0.02, 0.5, 0.005],
		]
		for (const [key, label, min, max, step] of distributionControls) {
			distributionFolder
				.add(params.biomes, key, min, max, step)
				.name(label)
				.onChange(updateBiomes)
				.onFinishChange(regenerateTerrain)
		}

		const mapFolder = biomesFolder.addFolder('Map')
		mapFolder
			.add(biomeMap.settings, 'visible')
			.name('Show')
			.onChange(() => biomeMap.applyVisibility())
		mapFolder
			.add(biomeMap.settings, 'follow')
			.name('Follow airplane')
			.onChange(() => biomeMap.invalidate())
			.listen()
		mapFolder.add(biomeMap, 'resetView').name('Reset view')

		const forestFolder = biomesFolder.addFolder('Forest')
		addTerrainPalette(forestFolder, 'temperate')
		addPalette(forestFolder, 'trees', 'Tree palette')
		addRockColors(forestFolder, BIOME.TEMPERATE, ['boulder', 'seaRock'])

		const desertFolder = biomesFolder.addFolder('Desert')
		addTerrainPalette(desertFolder, 'desert')
		const desertTopography = desertFolder.addFolder('Topography')
		const desertControls = [
			['frequency', 'Detail frequency ×', 0.1, 2, 0.01],
			['amplitude', 'Detail amplitude ×', 0, 2, 0.01],
			['blend', 'Blend width', 0.01, 0.4, 0.005],
			['flatten', 'Height reduction', 0, 1, 0.01],
			['depth', 'Reduction depth', 0.01, 1.5, 0.01],
		]
		for (const [key, label, min, max, step] of desertControls) {
			desertTopography
				.add(params.desert, key, min, max, step)
				.name(label)
				.onFinishChange(regenerateTerrain)
		}
		addPalette(desertFolder, 'cacti', 'Cactus palette')
		addRockColors(desertFolder, BIOME.DESERT, ['boulder', 'layeredRock', 'seaRock'])

		const iceFolder = biomesFolder.addFolder('Ice')
		addTerrainPalette(iceFolder, 'ice')
		// Craggier detail, never higher than the forest's: the amplitude stops
		// at 1 for the flight ceiling.
		const iceTopography = iceFolder.addFolder('Topography')
		const iceControls = [
			['frequency', 'Detail frequency ×', 0.5, 3, 0.01],
			['amplitude', 'Detail amplitude ×', 0, 1, 0.01],
			['blend', 'Blend width', 0.005, 0.1, 0.001],
		]
		for (const [key, label, min, max, step] of iceControls) {
			iceTopography
				.add(params.ice, key, min, max, step)
				.name(label)
				.onFinishChange(regenerateTerrain)
		}
		addSeaIceControls(iceFolder)
		addRockColors(iceFolder, BIOME.ICE, ['boulder', 'layeredRock', 'seaRock'])

		const seaFolder = biomesFolder.addFolder('Sea')
		const seaLabels = { shallow: 'Shallow', mid: 'Open sea', deep: 'Deep sea' }
		for (const name of TERRAIN_SEA_COLORS) {
			seaFolder
				.addColor(params.terrainPalette.sea, name)
				.name(seaLabels[name])
				.onChange(updateTerrainPalette)
		}
	}

	// Live: a biome's land band colors, the drift of each band toward its
	// variation color, the light patches, and the band lines.
	function addTerrainPalette(parent, key) {
		const palette = params.terrainPalette[key]
		const folder = parent.addFolder('Terrain palette')
		const label = (band) => `${band[0].toUpperCase()}${band.slice(1)}`
		for (const band of TERRAIN_PALETTE_BANDS) {
			folder.addColor(palette.colors, band).name(label(band)).onChange(updateTerrainPalette)
		}
		folder
			.add(palette, 'colorNoise', 0, 2, 0.01)
			.name('Light patches ×')
			.onChange(updateTerrainPalette)
		folder.add(palette, 'lines', 0, 1, 0.01).name('Band lines').onChange(updateTerrainPalette)
		const variationFolder = folder.addFolder('Variation')
		for (const band of TERRAIN_PALETTE_BANDS) {
			const variation = palette.variation[band]
			variationFolder
				.addColor(variation, 'color')
				.name(`${label(band)} toward`)
				.onChange(updateTerrainPalette)
			variationFolder
				.add(variation, 'amount', 0, 1, 0.01)
				.name(`${label(band)} amount`)
				.onChange(updateTerrainPalette)
		}
	}

	// Live: the rocks' colors in one biome, from the palettes picked by biome.
	function addRockColors(parent, biome, keys) {
		const slot = SCENERY_BIOME_SLOTS[biome]
		const labels = { boulder: 'Boulders', layeredRock: 'Layered rocks', seaRock: 'Sea rocks' }
		const folder = parent.addFolder('Rock colors')
		for (const key of keys) {
			folder
				.addColor(params.sceneryPalette.palettes[key].colors[slot], 'color')
				.name(labels[key])
				.onChange(updatePalette)
		}
	}

	// Live: the frozen sea's shape and colors; the map shows its sheet.
	function addSeaIceControls(parent) {
		const updateSeaIce = () => {
			updateSeaIceUniforms(uniforms, params.seaIce)
			biomeMap.invalidate()
		}
		const folder = parent.addFolder('Frozen sea')
		const controls = [
			['shelf', 'Sheet depth (units)', 0, 20, 0.1],
			['fade', 'Taper (ice field)', 0.005, 0.2, 0.005],
			['band', 'Floe band depth', 0, 12, 0.1],
			['cellSize', 'Floe size (units)', 1, 30, 0.5],
			['crackMin', 'Crack at sheet (units)', 0, 3, 0.05],
			['crackMax', 'Crack offshore (units)', 0, 6, 0.05],
			['edgeNoise', 'Edge wobble (depth)', 0, 4, 0.05],
			['edgeFrequency', 'Edge wobble frequency', 0.005, 0.3, 0.005],
		]
		for (const [key, label, min, max, step] of controls) {
			folder.add(params.seaIce, key, min, max, step).name(label).onChange(updateSeaIce)
		}
		const colorLabels = { sheet: 'Sheet', floe: 'Floes', water: 'Water between floes' }
		for (const [key, label] of Object.entries(colorLabels)) {
			folder.addColor(params.seaIce.colors, key).name(label).onChange(updateSeaIce)
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
