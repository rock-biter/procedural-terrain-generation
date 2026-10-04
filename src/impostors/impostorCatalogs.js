import { createScenerySources } from './impostorArchetypes.js'
import { createCloudSources } from './cloudArchetypes.js'
import { SCENERY_MESH_LOD_COUNT } from '../sceneryMeshPolicy.js'
import { SCENERY_PALETTE_SIZE } from '../sceneryPalettePolicy.js'
import {
	CLOUD_ATLAS_COLUMNS,
	CLOUD_ATLAS_ROWS,
	CLOUD_TYPE_COUNT,
	IMPOSTOR_ATLAS_COLUMNS,
	IMPOSTOR_ATLAS_ROWS,
	IMPOSTOR_TYPE_COUNT,
} from './impostorTypes.js'

// The families of objects drawn through the impostor pipeline: their source
// models, atlas layout, the hemisphere they are seen from (1 upper, -1 lower;
// the default hemi-octahedral bake uses it, see octahedral.js), and the shader
// defines that adapt the shared impostor and near-mesh shaders to them. The
// bake's view layout adds its own defines (getViewDefines()). createSources(type, lodCount) returns [LOD 0,
// LOD 1, ...] indexed geometries in one local frame, base on y = 0.
//
// Every material built from a catalog carries its defines, so materials of
// different families never share a compiled program (their onBeforeCompile
// source is the same).

// Trees, cacti, and rocks, placed per chunk by the workers. SCENERY_PALETTE
// paints the trees' crowns and the cacti per instance from their baked paint
// mask (src/sceneryPalettePolicy.js).
export const SCENERY_IMPOSTORS = Object.freeze({
	name: 'scenery',
	typeCount: IMPOSTOR_TYPE_COUNT,
	columns: IMPOSTOR_ATLAS_COLUMNS,
	rows: IMPOSTOR_ATLAS_ROWS,
	hemisphere: 1,
	createSources: createScenerySources,
	defines: Object.freeze({
		SCENERY_PALETTE: '',
		SCENERY_PALETTE_SIZE,
	}),
})

// Clouds (src/clouds.js): seen only from below, turned in the shaders so their
// front face looks at the airplane (the yaw slot only seeds the dither), and
// faded by fog alone (no atmosphere clamp). Their normalized wood grain keeps
// their light color (src/clouds.js sets it).
export const CLOUD_IMPOSTORS = Object.freeze({
	name: 'clouds',
	typeCount: CLOUD_TYPE_COUNT,
	columns: CLOUD_ATLAS_COLUMNS,
	rows: CLOUD_ATLAS_ROWS,
	hemisphere: -1,
	createSources: createCloudSources,
	defines: Object.freeze({
		SCENERY_FACE_AIRPLANE: '',
		SCENERY_NO_ATMOSPHERE_CLAMP: '',
	}),
})

// Source geometries built once per catalog and type, every near-mesh level at
// once, and shared by the atlas bakes and the near meshes: their attributes
// are uploaded once. They live as long as the page; consumers never dispose
// or modify them.
const sources = new Map()

export function getCatalogSources(catalog, type) {
	const key = `${catalog.name}:${type}`
	let levels = sources.get(key)
	if (!levels) {
		levels = catalog.createSources(type, SCENERY_MESH_LOD_COUNT)
		sources.set(key, levels)
	}
	return levels
}

// Layout defines shared by every impostor shader of the catalog.
export function getCatalogDefines(catalog) {
	return {
		IMPOSTOR_TYPE_COUNT: catalog.typeCount,
		IMPOSTOR_ATLAS_COLUMNS: catalog.columns,
		IMPOSTOR_ATLAS_ROWS: catalog.rows,
		...catalog.defines,
	}
}
