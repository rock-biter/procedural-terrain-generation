import assert from 'node:assert/strict'
import test from 'node:test'
import {
	CLOUD_IMPOSTORS,
	SCENERY_IMPOSTORS,
	getCatalogSources,
} from '../src/impostors/impostorCatalogs.js'
import { SCENERY_MESH_LOD_COUNT } from '../src/sceneryMeshPolicy.js'

test('builds each source once, with every near-mesh level', () => {
	for (const catalog of [SCENERY_IMPOSTORS, CLOUD_IMPOSTORS]) {
		for (let type = 0; type < catalog.typeCount; type++) {
			const levels = getCatalogSources(catalog, type)
			assert.equal(levels.length, SCENERY_MESH_LOD_COUNT)
			assert.equal(getCatalogSources(catalog, type), levels)
			assert.ok(levels[0].boundingSphere)
			assert.ok(levels[0].index.count > levels[1].index.count)
		}
	}
})

test('matches a fresh build of the same type', () => {
	for (const catalog of [SCENERY_IMPOSTORS, CLOUD_IMPOSTORS]) {
		const [shared] = getCatalogSources(catalog, 0)
		const [fresh] = catalog.createSources(0, 1)
		assert.deepEqual(shared.getAttribute('position').array, fresh.getAttribute('position').array)
		assert.deepEqual(shared.index.array, fresh.index.array)
	}
})
