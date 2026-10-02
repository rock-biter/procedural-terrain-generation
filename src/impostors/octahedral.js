// Hemi-octahedral view mapping for impostors. Directions point from the object
// toward the viewer in the object's local frame (+Y up). An atlas covers one
// hemisphere: `hemisphere` 1 (the default) bakes the upper one, for scenery
// seen from above, and -1 the lower one, for clouds seen from below; the
// lower mapping is the upper one mirrored on y. Directions outside the
// hemisphere clamp to its horizon. src/shaders/impostor-octahedral.glsl
// mirrors these functions (IMPOSTOR_LOWER_HEMISPHERE selects -1); keep them in
// sync with the baker, which renders one frame per grid direction.

export function encodeHemiOct(x, y, z, hemisphere = 1) {
	const sum = Math.abs(x) + Math.max(y * hemisphere, 0) + Math.abs(z)
	const px = x / sum
	const pz = z / sum
	return [px + pz, px - pz]
}

export function decodeHemiOct(u, v, hemisphere = 1) {
	const px = (u + v) * 0.5
	const pz = (u - v) * 0.5
	const py = (1 - Math.abs(px) - Math.abs(pz)) * hemisphere
	const length = Math.hypot(px, py, pz)
	return [px / length, py / length, pz / length]
}

// Frames sit on grid corners so the outer ring samples the horizon exactly.
export function getFrameDirection(frameX, frameY, frames, hemisphere = 1) {
	const u = (frameX / (frames - 1)) * 2 - 1
	const v = (frameY / (frames - 1)) * 2 - 1
	return decodeHemiOct(u, v, hemisphere)
}

// Camera basis used to bake a frame: z looks from the object to the viewer.
export function getFrameBasis(direction) {
	const [fx, fy, fz] = direction
	// right = normalize(cross(worldUp, direction))
	let rx = fz
	let rz = -fx
	const rightLength = Math.hypot(rx, rz)
	// Only a straight-down or straight-up view is degenerate; even frame
	// counts never bake the pole.
	if (rightLength < 1e-6) {
		rx = 1
		rz = 0
	} else {
		rx /= rightLength
		rz /= rightLength
	}
	// up = cross(direction, right)
	return {
		right: [rx, 0, rz],
		up: [fy * rz, fz * rx - fx * rz, -fy * rx],
		forward: [fx, fy, fz],
	}
}

// Three frames around a view direction and their barycentric weights.
export function getFrameBlend(x, y, z, frames, hemisphere = 1) {
	const [u, v] = encodeHemiOct(x, y, z, hemisphere)
	const last = frames - 1
	const gx = Math.min(Math.max((u * 0.5 + 0.5) * last, 0), last)
	const gy = Math.min(Math.max((v * 0.5 + 0.5) * last, 0), last)
	const baseX = Math.min(Math.floor(gx), last - 1)
	const baseY = Math.min(Math.floor(gy), last - 1)
	const fx = gx - baseX
	const fy = gy - baseY

	if (fx > fy) {
		return {
			frames: [
				[baseX, baseY],
				[baseX + 1, baseY],
				[baseX + 1, baseY + 1],
			],
			weights: [1 - fx, fx - fy, fy],
		}
	}

	return {
		frames: [
			[baseX, baseY],
			[baseX, baseY + 1],
			[baseX + 1, baseY + 1],
		],
		weights: [1 - fy, fy - fx, fx],
	}
}
