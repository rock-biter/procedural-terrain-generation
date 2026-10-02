// View mappings for impostors. Directions point from the object toward the
// viewer in the object's local frame (+Y up). A baked atlas holds one grid of
// framesX x framesY views per type, laid out by a view layout:
// - hemi-octahedral (createHemiOctViews()): one whole hemisphere. `hemisphere`
//   1 bakes the upper one, for scenery seen from above, and -1 the lower one,
//   for cloud shadows seen along the light from below; the lower mapping is
//   the upper one mirrored on y. Directions outside the hemisphere clamp to
//   its horizon.
// - frontal (createFrontalViews()): only the band in front of and below the
//   object, within ±azimuth of local -Z and from the horizon down to
//   `elevation`, for clouds, which always turn to face the airplane.
//   Directions outside the band clamp to its edge.
// src/shaders/impostor-octahedral.glsl mirrors these functions (selected by
// the defines of getViewDefines()); keep them in sync with the baker, which
// renders one frame per grid direction.

export const VIEW_LAYOUT = Object.freeze({
	HEMI_OCTAHEDRAL: 'hemi-octahedral',
	FRONTAL: 'frontal',
})

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
	// Only a straight-down or straight-up view is degenerate; even
	// hemi-octahedral frame counts and the frontal band never bake the pole.
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
export function getFrameBlend(x, y, z, frames, hemisphere = 1) {
	return getViewFrameBlend(x, y, z, {
		layout: VIEW_LAYOUT.HEMI_OCTAHEDRAL,
		framesX: frames,
		framesY: frames,
		hemisphere,
	})
}

function clamp01(value) {
	return Math.min(Math.max(value, 0), 1)
}

// The frame count must be even, so no frame looks straight at the pole, where
// the frame basis is degenerate (getFrameBasis()).
export function createHemiOctViews(frames, hemisphere = 1) {
	if (frames < 2 || frames % 2 !== 0) {
		throw new Error(`Impostor frame count ${frames} must be even`)
	}
	return Object.freeze({
		layout: VIEW_LAYOUT.HEMI_OCTAHEDRAL,
		framesX: frames,
		framesY: frames,
		hemisphere,
	})
}

// `azimuth` and `elevation` are in radians; the elevation stays below the pole.
export function createFrontalViews({ framesX, framesY, azimuth, elevation }) {
	if (framesX < 2 || framesY < 2) {
		throw new Error('A frontal view band needs at least 2 x 2 frames')
	}
	if (!(azimuth > 0 && azimuth < Math.PI) || !(elevation > 0 && elevation < Math.PI / 2)) {
		throw new Error('Frontal azimuth must be in (0, π) and elevation in (0, π / 2)')
	}
	return Object.freeze({
		layout: VIEW_LAYOUT.FRONTAL,
		framesX,
		framesY,
		azimuth,
		elevation,
	})
}

export function isSameViews(a, b) {
	return (
		a.layout === b.layout &&
		a.framesX === b.framesX &&
		a.framesY === b.framesY &&
		a.hemisphere === b.hemisphere &&
		a.azimuth === b.azimuth &&
		a.elevation === b.elevation
	)
}

// Grid position in [0, 1]² of a view direction, clamped to the layout.
export function encodeView(x, y, z, views) {
	if (views.layout === VIEW_LAYOUT.FRONTAL) {
		const horizontal = Math.hypot(x, z)
		const azimuth = horizontal > 1e-9 ? Math.atan2(x, -z) : 0
		const elevation = Math.atan2(-y, horizontal)
		return [
			clamp01((azimuth / views.azimuth) * 0.5 + 0.5),
			clamp01(elevation / views.elevation),
		]
	}
	const [u, v] = encodeHemiOct(x, y, z, views.hemisphere)
	return [clamp01(u * 0.5 + 0.5), clamp01(v * 0.5 + 0.5)]
}

// Unit direction of a grid position in [0, 1]².
export function decodeView(gx, gy, views) {
	if (views.layout === VIEW_LAYOUT.FRONTAL) {
		const azimuth = (gx * 2 - 1) * views.azimuth
		const elevation = gy * views.elevation
		const horizontal = Math.cos(elevation)
		return [
			horizontal * Math.sin(azimuth),
			-Math.sin(elevation),
			-horizontal * Math.cos(azimuth),
		]
	}
	return decodeHemiOct(gx * 2 - 1, gy * 2 - 1, views.hemisphere)
}

// Frames sit on grid corners, so the edge frames bake the layout's limits.
export function getViewFrameDirection(frameX, frameY, views) {
	return decodeView(frameX / (views.framesX - 1), frameY / (views.framesY - 1), views)
}

// Three frames around a view direction and their barycentric weights, on the
// layout's framesX x framesY grid.
export function getViewFrameBlend(x, y, z, views) {
	const [u, v] = encodeView(x, y, z, views)
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
// impostor and caster shaders. Floats keep a decimal point for GLSL.
export function getViewDefines(views) {
	const defines = {
		IMPOSTOR_FRAMES_X: views.framesX,
		IMPOSTOR_FRAMES_Y: views.framesY,
	}
	if (views.layout === VIEW_LAYOUT.FRONTAL) {
		defines.IMPOSTOR_FRONTAL_VIEWS = ''
		defines.IMPOSTOR_FRONTAL_AZIMUTH = views.azimuth.toFixed(6)
		defines.IMPOSTOR_FRONTAL_ELEVATION = views.elevation.toFixed(6)
	} else if (views.hemisphere < 0) {
		defines.IMPOSTOR_LOWER_HEMISPHERE = ''
	}
	return defines
}
