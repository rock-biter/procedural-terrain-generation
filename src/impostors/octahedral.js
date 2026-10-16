import { clamp01 } from '../math.js'
// View mappings for impostors. Directions point from the object toward the
// viewer in the object's local frame (+Y up). A baked atlas holds one
// hemi-octahedral grid of framesX x framesY views per type
// (createHemiOctViews()), covering the upper hemisphere, for scenery seen from
// above. Directions below it clamp to its horizon.
// src/shaders/impostor-octahedral.glsl mirrors these functions; keep them in
// sync with the baker, which renders one frame per grid direction.

export function encodeHemiOct(x, y, z) {
	const sum = Math.abs(x) + Math.max(y, 0) + Math.abs(z)
	const px = x / sum
	const pz = z / sum
	return [px + pz, px - pz]
}

export function decodeHemiOct(u, v) {
	const px = (u + v) * 0.5
	const pz = (u - v) * 0.5
	const py = 1 - Math.abs(px) - Math.abs(pz)
	const length = Math.hypot(px, py, pz)
	return [px / length, py / length, pz / length]
}

// Frames sit on grid corners so the outer ring samples the horizon exactly.
export function getFrameDirection(frameX, frameY, frames) {
	const u = (frameX / (frames - 1)) * 2 - 1
	const v = (frameY / (frames - 1)) * 2 - 1
	return decodeHemiOct(u, v)
}

// Camera basis used to bake a frame: z looks from the object to the viewer.
export function getFrameBasis(direction) {
	const [fx, fy, fz] = direction
	// right = normalize(cross(worldUp, direction))
	let rx = fz
	let rz = -fx
	const rightLength = Math.hypot(rx, rz)
	// Only a straight-down or straight-up view is degenerate; even
	// hemi-octahedral frame counts never bake the pole.
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

// Three frames around a view direction and their barycentric weights, on a
// square hemi-octahedral grid.
export function getFrameBlend(x, y, z, frames) {
	return getViewFrameBlend(x, y, z, { framesX: frames, framesY: frames })
}

// The frame count must be even, so no frame looks straight at the pole, where
// the frame basis is degenerate (getFrameBasis()).
export function createHemiOctViews(frames) {
	if (frames < 2 || frames % 2 !== 0) {
		throw new Error(`Impostor frame count ${frames} must be even`)
	}
	return Object.freeze({ framesX: frames, framesY: frames })
}

export function isSameViews(a, b) {
	return a.framesX === b.framesX && a.framesY === b.framesY
}

// Grid position in [0, 1]² of a view direction, clamped to the hemisphere.
export function encodeView(x, y, z) {
	const [u, v] = encodeHemiOct(x, y, z)
	return [clamp01(u * 0.5 + 0.5), clamp01(v * 0.5 + 0.5)]
}

// Unit direction of a grid position in [0, 1]².
export function decodeView(gx, gy) {
	return decodeHemiOct(gx * 2 - 1, gy * 2 - 1)
}

// Frames sit on grid corners, so the edge frames bake the horizon.
export function getViewFrameDirection(frameX, frameY, views) {
	return decodeView(frameX / (views.framesX - 1), frameY / (views.framesY - 1), views)
}

// Three frames around a view direction and their barycentric weights, on the
// layout's framesX x framesY grid.
export function getViewFrameBlend(x, y, z, views) {
	const [u, v] = encodeView(x, y, z)
	const lastX = views.framesX - 1
	const lastY = views.framesY - 1
	const gx = u * lastX
	const gy = v * lastY
	const baseX = Math.min(Math.floor(gx), lastX - 1)
	const baseY = Math.min(Math.floor(gy), lastY - 1)
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

// Pixel size of one type block and of the whole atlas.
export function getAtlasLayout(views, { columns, rows }, frameSize) {
	const blockWidth = views.framesX * frameSize
	const blockHeight = views.framesY * frameSize
	return {
		blockWidth,
		blockHeight,
		width: blockWidth * columns,
		height: blockHeight * rows,
	}
}

// Largest frame size whose supersampled bake target (one type block) and atlas
// both fit the GPU texture limit.
export function getMaxImpostorFrameSize(maxTextureSize, views, { columns, rows }, supersample) {
	const widest = Math.max(
		views.framesX * supersample,
		views.framesY * supersample,
		views.framesX * columns,
		views.framesY * rows,
	)
	return Math.floor(maxTextureSize / widest)
}

// Shader defines of a layout, read by impostor-octahedral.glsl and the
// impostor and caster shaders.
export function getViewDefines(views) {
	return {
		IMPOSTOR_FRAMES_X: views.framesX,
		IMPOSTOR_FRAMES_Y: views.framesY,
	}
}
