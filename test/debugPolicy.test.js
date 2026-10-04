import assert from 'node:assert/strict'
import test from 'node:test'
import { isDebugEnabled, isEditableTarget, isFlightPauseShortcut } from '../src/debugPolicy.js'

const keyP = (overrides = {}) => ({
	code: 'KeyP',
	repeat: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	target: { tagName: 'BODY' },
	...overrides,
})

test('enables debug features only for debug=1', () => {
	assert.equal(isDebugEnabled(new URLSearchParams('?debug=1')), true)
	assert.equal(isDebugEnabled(new URLSearchParams('?debug=1&gui=1')), true)
	assert.equal(isDebugEnabled(new URLSearchParams('')), false)
	assert.equal(isDebugEnabled(new URLSearchParams('?debug=0')), false)
	assert.equal(isDebugEnabled(new URLSearchParams('?debug=true')), false)
})

test('detects editable targets', () => {
	assert.equal(isEditableTarget(null), false)
	assert.equal(isEditableTarget({ tagName: 'CANVAS' }), false)
	assert.equal(isEditableTarget({ tagName: 'INPUT' }), true)
	assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true)
	assert.equal(isEditableTarget({ tagName: 'SELECT' }), true)
	assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true)
})

test('toggles flight pause on the physical P key regardless of layout', () => {
	assert.equal(isFlightPauseShortcut(keyP()), true)
	assert.equal(isFlightPauseShortcut(keyP({ key: 'P' })), true)
	assert.equal(isFlightPauseShortcut(keyP({ code: 'KeyO' })), false)
})

test('ignores repeated, modified, or text-input P presses', () => {
	assert.equal(isFlightPauseShortcut(keyP({ repeat: true })), false)
	assert.equal(isFlightPauseShortcut(keyP({ ctrlKey: true })), false)
	assert.equal(isFlightPauseShortcut(keyP({ metaKey: true })), false)
	assert.equal(isFlightPauseShortcut(keyP({ altKey: true })), false)
	assert.equal(isFlightPauseShortcut(keyP({ target: { tagName: 'INPUT' } })), false)
})
