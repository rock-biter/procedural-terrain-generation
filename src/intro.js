import gsap from 'gsap'

// The startup flow in the DOM shell (index.html): the loading bar, the
// load-error state, the Play button and its intro (the camera pulls back while
// the airplane speeds up), and the sound toggle. `canvas` is the renderer's;
// `playMusic` is false in the ?gui=1 tuning mode, which never plays the
// soundtrack.
export default class Intro {
	soundOn = true

	constructor({ canvas, soundtrack, playMusic = true, isMobile = false }) {
		this.canvas = canvas
		this.soundtrack = soundtrack
		this.playMusic = playMusic
		this.isMobile = isMobile
		this.loader = document.getElementById('loader')
		this.progress = document.getElementById('progress')
		this.playButton = document.getElementById('play')
		this.soundToggle = document.getElementById('sound-toggle')
		this.error = document.getElementById('load-error')
		this.errorMessage = document.getElementById('load-error-message')
		this.retryButton = document.getElementById('load-retry')
	}

	showLoader() {
		gsap.to(this.loader, { autoAlpha: 1, duration: 0 })
	}

	setProgress(loaded, total) {
		gsap.to(this.progress, { width: `${(100 * loaded) / total}%`, duration: 1 })
	}

	// Once every startup asset has loaded: the loader fades out, `onReady()`
	// builds the world, then Play fades in over the fading-in canvas. Pressing
	// it starts the music and the intro, whose end calls world.startFlight().
	start(world, onReady) {
		gsap.set(this.canvas, { autoAlpha: 0 })
		this.soundToggle.addEventListener('click', () => this.toggleSound())

		gsap.to(this.loader, {
			autoAlpha: 0,
			duration: 1,
			onComplete: () => {
				onReady()
				gsap.to(this.playButton, {
					autoAlpha: 1,
					duration: 0.5,
					onComplete: () => {
						this.playButton.addEventListener('click', () => this.play(world))
						gsap.to(this.canvas, { autoAlpha: 1, duration: 3, ease: 'power3.out' })
					},
				})
			},
		})
	}

	play(world) {
		if (this.playMusic) this.soundtrack.play()
		gsap.fromTo(world.plane, { baseSpeed: 35 }, { duration: 1, baseSpeed: 55, speed: 55 })
		gsap.to(this.playButton, { duration: 0.2, autoAlpha: 0 })
		gsap.fromTo(
			world.camera.position,
			{ z: -1 },
			{
				duration: 1,
				ease: 'expo.out',
				z: this.isMobile ? -16 : -18,
				onComplete: () => world.startFlight(),
			},
		)
	}

	toggleSound() {
		this.soundOn = !this.soundOn
		this.soundtrack.setMuted(!this.soundOn)
		gsap.to(this.soundToggle, { opacity: this.soundOn ? 1 : 0.4, duration: 0.2 })
	}

	// Replaces the loader with `message` and a Retry button that reloads the page.
	showError(message) {
		gsap.to(this.loader, { autoAlpha: 0, duration: 0.3 })
		this.errorMessage.textContent = message
		this.error.hidden = false
		this.retryButton.addEventListener('click', () => window.location.reload(), { once: true })
		this.retryButton.focus()
	}
}
