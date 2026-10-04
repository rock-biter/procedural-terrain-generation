// Three-free scalar helpers for the pure policy modules and the workers, with
// the formulas of three's MathUtils, so results stay bit-identical.

export function clamp01(value) {
	return Math.min(Math.max(value, 0), 1)
}

export function lerp(x, y, t) {
	return (1 - t) * x + t * y
}

// Hermite step of `x` from `edge0` to `edge1`, like GLSL smoothstep().
export function smoothstep(edge0, edge1, x) {
	const t = clamp01((x - edge0) / (edge1 - edge0))
	return t * t * (3 - 2 * t)
}
