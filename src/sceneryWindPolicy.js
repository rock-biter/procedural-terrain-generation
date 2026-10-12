import { IMPOSTOR_TYPE_COUNT } from './impostors/impostorTypes.js'
import {
	SCENERY_MESH_DISABLED_RANGE,
	SCENERY_MESH_MIN_BAND,
	getSceneryMeshFade,
	getSceneryMeshRange,
} from './sceneryMeshPolicy.js'
import { SCENERY_TYPE_KEYS } from './sceneryPlacement.js'

// Pure rules for the wind on the near scenery meshes (src/impostors/sceneryMeshes.js,
// scenery-wind-pars-vertex.glsl). Only the meshes move: the impostors stay
// still, so the motion fades out before the impostor hand-over.

// Distances from the eye to an instance's flat world base: the motion is full
// below `full` and none beyond `start`. getSceneryWindRange() keeps `start`
// within the near meshes' band.
export const SCENERY_WIND_RANGES = Object.freeze({
	desktop: Object.freeze({ start: 160, full: 70 }),
	mobile: Object.freeze({ start: 100, full: 40 }),
})

// - `intensity`: units the top of a scale-1 tree with sensitivity 1 sways;
// - `speed`: units per second the gusts travel downwind;
// - `frequency`: gust noise per world unit (lower = wider gusts);
// - `direction`: degrees from +X toward +Z the wind blows to;
// - `flutter`: the quick shiver of the crowns and fronds: `amount` in units at
//   the top of a scale-1 tree with sensitivity 1, `speed` in noise units per
//   second, `frequency` per world unit;
// - `sensitivity`: per tree type (keyed like SCENERY_TYPE_KEYS); every other
//   type stays still.
export const SCENERY_WIND_DEFAULTS = Object.freeze({
	intensity: 0.5,
	speed: 10,
	frequency: 0.015,
	direction: 30,
	flutter: Object.freeze({ amount: 0.12, speed: 0.8, frequency: 0.35 }),
	sensitivity: Object.freeze({ roundTree: 0.3, conifer: 0.6, palm: 1 }),
})

export function createSceneryWindSettings({ isMobile = false } = {}) {
	const range = isMobile ? SCENERY_WIND_RANGES.mobile : SCENERY_WIND_RANGES.desktop
	return {
		enabled: true,
		...SCENERY_WIND_DEFAULTS,
		flutter: { ...SCENERY_WIND_DEFAULTS.flutter },
		sensitivity: { ...SCENERY_WIND_DEFAULTS.sensitivity },
		...range,
	}
}

// [full, start] for the shader's fade, kept valid for smoothstep() and with
// `start` no farther than the near meshes' `start` (`meshSettings` is
// params.sceneryMeshes), where the still impostor begins to take over. While
// the wind or the meshes are disabled, the fade is 0 at every distance.
export function getSceneryWindRange(settings, meshSettings) {
	const [meshStart] = getSceneryMeshRange(meshSettings)
	const start = Math.min(settings.start, meshStart)
	if (!settings.enabled || !meshSettings.enabled || start < SCENERY_MESH_MIN_BAND) {
		return [...SCENERY_MESH_DISABLED_RANGE]
	}
	const full = Math.min(Math.max(settings.full, 0), start - SCENERY_MESH_MIN_BAND)
	return [full, start]
}

// Share of the motion at `distance`: 1 - smoothstep(full, start, distance),
// as in applySceneryWind() (scenery-wind-pars-vertex.glsl).
export function getSceneryWindFade(distance, [full, start]) {
	return getSceneryMeshFade(distance, full, start)
}

// Sensitivity per impostor type: the settings' value for the trees, 0 for
// every other type.
export function getSceneryWindSensitivities(settings, typeCount = IMPOSTOR_TYPE_COUNT) {
	return Array.from({ length: typeCount }, (_, type) =>
		Math.max(settings.sensitivity[SCENERY_TYPE_KEYS[type]] ?? 0, 0),
	)
}

// Unit [x, z] the wind blows toward, `degrees` from +X toward +Z.
export function getSceneryWindDirection(degrees) {
	const angle = (degrees * Math.PI) / 180
	return [Math.cos(angle), Math.sin(angle)]
}
