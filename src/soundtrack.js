// Looping background music, streamed by a media element instead of being
// downloaded and decoded before startup. The element starts buffering when
// `preload` is set; nothing else waits for it, and a failed load only leaves
// the music silent.
//
// The volume goes through a Web Audio gain node, created on the first play()
// (which must run inside a user gesture), because iOS ignores the volume of
// media elements.
export default class Soundtrack {
	constructor(src, { volume = 1, preload = true } = {}) {
		this.element = new Audio(src)
		this.element.loop = true
		this.element.preload = preload ? 'auto' : 'none'
		this.volume = volume
		this.muted = false
		this.context = null
		this.gain = null
	}

	play() {
		if (!this.context) {
			this.context = new AudioContext()
			this.gain = this.context.createGain()
			this.context
				.createMediaElementSource(this.element)
				.connect(this.gain)
				.connect(this.context.destination)
			this.applyVolume()
		}
		this.context.resume()
		this.element.play().catch((error) => {
			console.warn('Soundtrack playback failed', error)
		})
	}

	setMuted(muted) {
		this.muted = muted
		this.applyVolume()
	}

	applyVolume() {
		if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume
	}
}
