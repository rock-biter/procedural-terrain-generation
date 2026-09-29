const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function isDebugEnabled(searchParams) {
	return searchParams.get('debug') === '1'
}

export function isEditableTarget(target) {
	if (!target) return false

	return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable === true
}

// Uses the physical key so the shortcut works on every keyboard layout.
export function isFlightPauseShortcut(event) {
	return (
		event.code === 'KeyP' &&
		!event.repeat &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		!isEditableTarget(event.target)
	)
}
