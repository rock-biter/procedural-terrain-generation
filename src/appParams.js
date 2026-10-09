import { ACESFilmicToneMapping } from 'three'
import { createAdaptivePixelRatioSettings, parsePixelRatio } from './adaptivePixelRatio'
import { createAuroraSettings, parseAuroraChance } from './auroraPolicy'
import { createTerrainSettings } from './chunkGeometry'
import { createCloudSettings } from './cloudPlacement'
import { createDayNightPalette, DAY_NIGHT_DEFAULTS, getStartTimeOfDay } from './dayNightPolicy'
import {
	createCloudMeshSettings,
	createSceneryMeshSettings,
	createSceneryWireframeSettings,
} from './sceneryMeshPolicy'
import { createSceneryPaletteSettings } from './sceneryPalettePolicy'
import { createScenerySettings, SCENERY_TYPE_KEYS } from './sceneryPlacement'
import { createSeaFoamSettings } from './seaFoamPolicy'
import { createSeaIceSettings } from './seaIcePolicy'
import { createCloudShadowSettings, createSceneryShadowSettings } from './shadowPolicy'
import { createTerrainNormalSettings } from './terrainNormals'
import { createTerrainPaletteSettings } from './terrainPalettePolicy'

// The mutable parameters of the app, edited live by the ?gui=1 debug panel
// (src/debug/debugGui.js) and read by every system. `urlParams` supplies
// ?time=, ?dpr=, and ?aurora=; `isMobile` picks the mobile presets; `debug`
// (either debug flag) starts the day at a fixed time.
export function createAppParams({ urlParams, isMobile, debug = false }) {
	return {
		speedEffect: 0,
		// Peak intensities; the day/night cycle scales them every frame.
		directionalLight: 4,
		moonLight: 1.2,
		ambientLight: 1.5,
		dayNight: {
			timeOfDay: getStartTimeOfDay(urlParams, { debug }),
			cycleDuration: DAY_NIGHT_DEFAULTS.cycleDuration,
			paused: false,
			// Editable copy of DAY_NIGHT_DEFAULTS.keyframes (sRGB colors).
			keyframes: createDayNightPalette(),
			skyGradientHeight: DAY_NIGHT_DEFAULTS.skyGradientHeight,
		},
		// Radial fog range in world units from the eye; DayNight applies it.
		fog: { near: 200, far: 2100 },
		// Terrain generation (amplitude, frequency, octaves, lacunarity,
		// persistance, biome distribution, desert and ice topography, coastal
		// relief); see TERRAIN_DEFAULTS.
		...createTerrainSettings(),
		// Shader-side, applied live: the land band colors of every biome and the
		// sea colors; see createTerrainPaletteSettings().
		terrainPalette: createTerrainPaletteSettings(),
		// Shader-side, applied live: the frozen sea of the ice biome; see
		// createSeaIceSettings().
		seaIce: createSeaIceSettings(),
		// Soft lighter patches on land from a world-space noise: frequency (per world
		// unit), intensity (0.3 = up to 30% brighter), threshold (noise value in
		// [0, 1] where lightening starts), softness (transition half-width), and
		// speed (noise drift per second).
		terrainColorNoise: {
			frequency: 0.012,
			intensity: 0.75,
			threshold: 0.61,
			softness: 0.3,
			speed: 0.25,
		},
		// Shader-side, applied live: the sand's brightness on fully rocky coast
		// (src/coast.js mask); 1 leaves it unchanged.
		coastSand: { shade: 0.82 },
		// Normal map, tile size (world units), and strength per terrain layer;
		// defaults and texture assignment live in TERRAIN_NORMAL_LAYERS.
		terrainNormals: createTerrainNormalSettings(),
		// Renderer tone mapping operator (a THREE.*ToneMapping constant) and exposure.
		// A tone-mapped mode switches the composer to half-float buffers. `exposure`
		// is the day value; DayNight blends it toward `nightExposure` by the cycle's
		// `night` factor every frame.
		toneMapping: { mode: ACESFilmicToneMapping, exposure: 1, nightExposure: 1.3 },
		// Adaptive resolution (src/adaptivePixelRatio.js): the pixel ratio drops
		// toward `min` while the frame rate is below 60 fps. `?dpr=` pins the ratio
		// and turns adaptation off.
		pixelRatio: createAdaptivePixelRatioSettings({
			enabled: parsePixelRatio(urlParams) === null,
		}),
		postProcessing: {
			// Minimum effect intensity; lets the GUI hold the effect on while tuning.
			preview: 0,
			// Edge blur and aberration always shown, as for a speed effect of this
			// value; boosting animates the rest. 0 leaves the edges sharp at rest. The
			// camera FOV kick ignores it.
			idleSpeedEffect: 0.4,
			// Static screen-space grain; intensity is the maximum brightness change
			// (0.05 = ±5%). 0 disables it.
			grain: { intensity: 0.035 },
			// Radii: 0 = viewport center, ~0.71 = edge midpoints, 1 = corners.
			// verticalScale shrinks only the vertical distance (1 = circular falloff).
			verticalScale: 0.78,
			blur: { strength: 0.075, start: 0.35, end: 1.5, curve: 1.2 },
			aberration: { strength: 0.016, start: 0.28, end: 0.9, curve: 2.2 },
		},
		// Placement settings sent to the chunk workers; see createScenerySettings().
		scenery: createScenerySettings({ isMobile }),
		// Wood color baked into every impostor, per type (keyed like
		// SCENERY_TYPE_KEYS): repeats per object unit, color strength (0 = vertex
		// color only, 1 = vertex color × texture), and `normalized`, which divides
		// the grain by the texture's mean color so it keeps the base color (as on
		// the clouds). The trees get the clouds' strong, normalized grain at about
		// one repeat per tree; the boat keeps its model's colors, without grain.
		// Changing them re-bakes the atlas.
		impostorDetail: {
			roundTree: { scale: 0.15, color: 0.6, normalized: true },
			conifer: { scale: 0.15, color: 0.6, normalized: true },
			cactusOneArm: { scale: 0.01, color: 0.1, normalized: false },
			cactusTwoArms: { scale: 0.01, color: 0.1, normalized: false },
			boulder: { scale: 0.01, color: 0.1, normalized: false },
			layeredRock: { scale: 0.01, color: 0.1, normalized: false },
			seaRock: { scale: 0.01, color: 0.1, normalized: false },
			boat: { scale: 0.01, color: 0, normalized: false },
			iceSpikesTwo: { scale: 0.01, color: 0.1, normalized: false },
			iceSpikesThree: { scale: 0.01, color: 0.1, normalized: false },
			palm: { scale: 0.15, color: 0.6, normalized: true },
		},
		// Shader-side, applied live: the trees' trunk colors and crown palettes and
		// the cacti's palette, picked per instance from world-space noise; see
		// createSceneryPaletteSettings().
		sceneryPalette: createSceneryPaletteSettings(),
		// Near scenery meshes, in units from the eye: full-detail meshes below
		// `lodStart`, reduced-detail meshes from `lodEnd` to `start`, impostors
		// beyond `end`, with dithered cross-fades inside each band.
		sceneryMeshes: createSceneryMeshSettings({ isMobile }),
		// Debug overlay outlining scenery triangles in one color per level of
		// detail: LOD 0 mesh, LOD 1 mesh, impostor quad.
		sceneryWireframe: createSceneryWireframeSettings(),
		// Soft shadows of scenery and the airplane on terrain and scenery, in two
		// cascades that fade out with distance; see createSceneryShadowSettings().
		shadows: createSceneryShadowSettings({ isMobile }),
		// The coast's ripples around the sea rocks, from a top-down map of the
		// distance to the nearest rock; see createSeaFoamSettings().
		seaFoam: createSeaFoamSettings({ isMobile }),
		// Shader-side, applied live: brightness change per type in stops (1 = half
		// to double brightness) and the world frequency of the noise that drives it.
		// The trees and cacti vary less, so their palette colors stay recognizable;
		// the boat keeps its model's colors.
		impostorVariation: {
			frequency: 0.01,
			amount: {
				...Object.fromEntries(Object.values(SCENERY_TYPE_KEYS).map((key) => [key, 0.8])),
				roundTree: 0.35,
				conifer: 0.35,
				cactusOneArm: 0.35,
				cactusTwoArms: 0.35,
				palm: 0.35,
				boat: 0,
			},
		},
		// World-level cloud field (src/clouds.js): deterministic placement (see
		// createCloudSettings()), near-mesh bands like sceneryMeshes, the wood
		// detail baked into the cloud atlas (changing it re-bakes), the ambient
		// light multiplier that keeps the undersides bright, the brightness
		// variation per type, and the cloud shadows on terrain and scenery (see
		// createCloudShadowSettings()).
		clouds: {
			placement: createCloudSettings({ isMobile }),
			meshes: createCloudMeshSettings({ isMobile }),
			detail: { scale: 0.012, color: 0.6 },
			ambient: 2.72,
			variation: {
				frequency: 0.0405,
				// Keyed like CLOUD_TYPE_KEYS.
				amount: { bank: 0.99, heap: 1.26, puff: 0.99 },
			},
			shadows: createCloudShadowSettings({ isMobile }),
		},
		// The aurora over the ice biome (src/aurora.js): its chance (?aurora=
		// overrides it), night window, curtains, motion, and look; see
		// createAuroraSettings().
		aurora: createAuroraSettings({ isMobile, chance: parseAuroraChance(urlParams) }),
		// Airplane propeller rotation in turns per second. With two blades, speeds
		// near half the frame rate (30 at 60 fps) strobe and look still.
		propeller: { speed: 4 },
		trails: {
			ribbonWidth: 9.6,
			lineWidth: 0.65,
			borderWidth: 0.08,
			outerEdge: { frequency: 1.4, amplitude: 0.47 },
			innerEdge: { frequency: 1.4, amplitude: 0.43 },
			oscillation: { frequency: 0.03, amplitude: 0.3 },
		},
	}
}
