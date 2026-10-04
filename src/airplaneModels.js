// Per-model data for the player airplane (loaded in main.js, used by
// src/plane.js). Lengths are in each model's geometry units after
// BufferGeometry.center() and the `rotationY` turn, where the nose points to
// +Z, the wings run along X, and +Y is up. Measurements: docs/ASSETS.md.
//
// - `path`: public URL of the GLB (gltfpack, EXT_meshopt_compression).
// - `shadowPath`: public URL of the simplified shadow caster (about 4,000
//   triangles, positions only, in the model's geometry space), made by
//   scripts/encode-assets.mjs.
// - `rotationY`: turn about Y (radians) that brings the nose to +Z.
// - `wingspan`: world-unit width of the scaled model along X; 7.6 puts the wing
//   tips at the default trail stripes (about ±3.8).
// - `trailAnchor`: trail emission point, the trailing edge at the wing tips.
// - `propeller.axis`: XY point of the propeller axis, parallel to +Z.
// - `propeller.minZ`: the propeller's UV charts are the only ones reaching
//   beyond this Z (src/propellerMask.js).
// - `propeller.plugs`: dark surfaces inside the cowl, centered on the axis,
//   that close openings the turning propeller reveals in a fused mesh:
//   `{ z, radius }` discs or `{ z, innerRadius, outerRadius, thetaStart,
//   thetaLength }` ring sectors (degrees from +X seen from the front).
export const AIRPLANE_MODELS = Object.freeze({
	// Monoplane; the lower-right blade root is fused into the cowl face.
	toy: Object.freeze({
		path: '/plane-toy/plane-toy.glb',
		shadowPath: '/plane-toy/plane-toy-shadow.glb',
		rotationY: 0,
		wingspan: 7.6,
		trailAnchor: Object.freeze([0, 0.014, 0.05]),
		propeller: Object.freeze({
			axis: Object.freeze([0, 0.0346]),
			minZ: 0.28,
			plugs: Object.freeze([
				Object.freeze({
					z: 0.252,
					innerRadius: 0.03,
					outerRadius: 0.062,
					thetaStart: -120,
					thetaLength: 130,
				}),
				Object.freeze({ z: 0.243, radius: 0.043 }),
			]),
		}),
	}),
	// Biplane authored nose toward +X; the trails leave the upper wing tips.
	biplane: Object.freeze({
		path: '/plane-toy/plane-toy-2.glb',
		shadowPath: '/plane-toy/plane-toy-2-shadow.glb',
		rotationY: -Math.PI / 2,
		wingspan: 7.6,
		trailAnchor: Object.freeze([0, 0.166, 0.15]),
		propeller: Object.freeze({
			axis: Object.freeze([-0.0005, 0.0406]),
			minZ: 0.445,
			plugs: Object.freeze([]),
		}),
	}),
})

export const DEFAULT_AIRPLANE_MODEL = 'biplane'

// `?plane=<key>` picks a model; unknown or missing keys use the default.
export function getAirplaneModelKey(urlParams) {
	const key = urlParams.get('plane')
	return Object.hasOwn(AIRPLANE_MODELS, key) ? key : DEFAULT_AIRPLANE_MODEL
}
