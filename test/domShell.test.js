import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('every element the scripts look up exists in index.html', () => {
	const html = read('index.html')
	const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
	for (const path of ['main.js', 'src/intro.js']) {
		for (const [, id] of read(path).matchAll(/getElementById\('([^']+)'\)/g)) {
			assert.ok(ids.has(id), `${path} looks up #${id}, missing from index.html`)
		}
	}
})

test('the load-error state starts hidden', () => {
	assert.match(read('index.html'), /<div\s+id="load-error"[^>]*\shidden[\s>]/)
})
