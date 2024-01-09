import {
	MathUtils,
	Mesh,
	MeshStandardMaterial,
	MultiplyBlending,
	PlaneGeometry,
	Scene,
	Vector3,
} from 'three'

const material = new MeshStandardMaterial({
	// wireframe: true,
	color: 'lightblue',
	// flatShading: true,
})

const sea = new Mesh(
	new PlaneGeometry(1, 1),
	new MeshStandardMaterial({
		color: 0x053399,
		transparent: true,
		opacity: 0.5,
		// blending: MultiplyBlending,
	})
)
sea.geometry.rotateX(-Math.PI * 0.5)
sea.geometry.translate(0.5, 0, 0.5)

material.onBeforeCompile = (shader) => {
	// const { fragmentShader, vertexShader } = shader

	// console.log(fragmentShader)

	shader.vertexShader = shader.vertexShader.replace(
		'#include <common>',
		`#include <common>
    varying vec3 wPosition;
    `
	)

	shader.vertexShader = shader.vertexShader.replace(
		'#include <project_vertex>',
		`#include <project_vertex>
    wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
    `
	)

	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <common>',
		`#include <common>
	  varying vec3 wPosition;
	  `
	)

	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <color_fragment>',
		`#include <color_fragment>

		float pctDeep = smoothstep(-24.,-40.,wPosition.y);
		diffuseColor.rgb = mix(vec3(0.0,0.,0.5),vec3(0.0,0.,0.02),pctDeep);
    float pctSea = smoothstep(-6.,-16.,wPosition.y);
	  diffuseColor.rgb = mix(vec3(0.,0.2,.6),diffuseColor.rgb,pctSea);
		float pctSand = step(wPosition.y,0.);
	  diffuseColor.rgb = mix(vec3(0.9,0.8,0.5),diffuseColor.rgb,pctSand);
    float pct = step(wPosition.y + sin(wPosition.x * 0.3) * 0.6 + cos(wPosition.z * 0.3) * 0.6,1.6);
	  diffuseColor.rgb = mix(vec3(0.1,0.4,0.),diffuseColor.rgb,pct);
    float pct2 = step(wPosition.y + sin(wPosition.x * 0.1) * 1.6 + cos(wPosition.z * 0.1) * 1.6 ,7.);
    diffuseColor.rgb = mix(vec3(0.8,0.3,0.),diffuseColor.rgb,pct2);
    float pct3 = step(wPosition.y + sin(wPosition.x * 0.15) * 2.5 + cos(wPosition.z * 0.15) * 2.5,14.);
    diffuseColor.rgb = mix(vec3(0.4,0.8,0.9),diffuseColor.rgb,pct3);
	  `
	)
}

export default class Chunk extends Mesh {
	constructor(
		size,
		noise,
		params = {},
		LOD = 0,
		position = new Vector3(0, 0, 0)
	) {
		const segments = Math.floor(size * 0.5 ** LOD)
		const geometry = new PlaneGeometry(size, size, segments, segments)
		geometry.rotateX(-Math.PI * 0.5)
		geometry.translate(size / 2, 0, size / 2)
		super(geometry, material)

		this.position.copy(position)
		this.noise = noise
		this.size = size
		this.LOD = LOD
		this.params = params

		sea.scale.setScalar(size)

		this.updateGeometry()
		this.add(sea.clone())
	}

	updateLOD(LOD) {
		if (LOD === this.LOD) return

		this.LOD = LOD
		const segments = Math.floor(this.size * 0.5 ** LOD)
		const geometry = new PlaneGeometry(this.size, this.size, segments, segments)
		geometry.rotateX(-Math.PI * 0.5)
		geometry.translate(this.size / 2, 0, this.size / 2)
		this.needsUpdate = true
		this.geometry = geometry
		this.updateGeometry()
		// this.geometry.needsUpdate = true
	}

	updateGeometry() {
		const posAttr = this.geometry.getAttribute('position')
		const { x: fx, z: fz } = this.params.frequency

		for (let i = 0; i < posAttr.count; i++) {
			const x = posAttr.getX(i) + this.position.x
			const z = posAttr.getZ(i) + this.position.z

			let h = 0

			for (let j = 0; j < this.params.octaves; j++) {
				const octave = j
				const amplitude =
					this.params.amplitude * this.params.persistance ** octave
				const lacunarity = this.params.lacunarity ** octave

				let increment = this.noise(
					x * 0.01 * fx * lacunarity,
					z * 0.01 * fz * lacunarity
				)

				increment *= increment
				h += increment * amplitude
			}

			let l = this.noise(x * 0.001, z * 0.001)
			// l *= l
			l -= 0.5
			l *= this.params.amplitude * 3
			// const pct = MathUtils.smoothstep(l, 0, 1)
			// h = MathUtils.lerp(l, h, pct)

			h += l

			posAttr.setY(i, h)
		}

		posAttr.needsUpdate = true

		this.geometry.computeVertexNormals()
	}
}
