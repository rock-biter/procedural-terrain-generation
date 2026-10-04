import {
	BufferAttribute,
	CircleGeometry,
	MathUtils,
	Mesh,
	MeshStandardMaterial,
	RingGeometry,
	Vector2,
} from 'three'
import propellerParsVertex from './shaders/propeller-pars-vertex.glsl'
import { getPropellerMask } from './propellerMask.js'
import { replaceChunks } from './shaderChunks.js'

// Dark plugs inside the cowl (AIRPLANE_MODELS[*].propeller.plugs), matching
// the gap between the spinner and the cowl.
const PROPELLER_PLUG_COLOR = '#3b291c'

// Spins the propeller fused into the airplane `model` in its material's vertex
// shader (propeller-pars-vertex.glsl): a per-vertex mask selects the
// propeller's UV charts (src/propellerMask.js), and `config` is the model's
// AIRPLANE_MODELS entry. `settings.speed` (params.propeller) sets turns per
// second, read every update.
export default class Propeller {
	constructor(model, config, settings) {
		this.settings = settings
		const { geometry, material } = model
		const position = geometry.attributes.position
		const zValues = new Float32Array(position.count)
		for (let i = 0; i < position.count; i++) zValues[i] = position.getZ(i)
		const { propeller } = config
		const axis = new Vector2().fromArray(propeller.axis)
		const mask = getPropellerMask(zValues, geometry.index.array, propeller.minZ)
		// Not normalized: the bytes 0 and 1 reach the shader as 0.0 and 1.0.
		geometry.setAttribute('propeller', new BufferAttribute(mask, 1))
		this.uniforms = {
			uPropellerAngle: { value: 0 },
			uPropellerAxis: { value: axis },
		}
		material.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, this.uniforms)
			shader.vertexShader = replaceChunks(shader.vertexShader, {
				common: `#include <common>\n${propellerParsVertex}`,
				beginnormal_vertex: `#include <beginnormal_vertex>
					vec2 propellerRotation = vec2(cos(uPropellerAngle), sin(uPropellerAngle));
					if (propeller > 0.5) objectNormal.xy = rotatePropeller(objectNormal.xy, propellerRotation);`,
				begin_vertex: `#include <begin_vertex>
					if (propeller > 0.5) {
						transformed.xy = uPropellerAxis + rotatePropeller(position.xy - uPropellerAxis, propellerRotation);
					}`,
			})
		}
		material.needsUpdate = true

		if (propeller.plugs.length === 0) return
		const plugMaterial = new MeshStandardMaterial({
			color: PROPELLER_PLUG_COLOR,
			roughness: 1,
			metalness: 0,
		})
		for (const plug of propeller.plugs) {
			const plugGeometry =
				plug.radius === undefined
					? new RingGeometry(
							plug.innerRadius,
							plug.outerRadius,
							16,
							1,
							MathUtils.degToRad(plug.thetaStart),
							MathUtils.degToRad(plug.thetaLength),
						)
					: new CircleGeometry(plug.radius, 32)
			const mesh = new Mesh(plugGeometry, plugMaterial)
			mesh.name = 'propeller-plug'
			mesh.position.set(axis.x, axis.y, plug.z)
			model.add(mesh)
		}
	}

	update(dt) {
		const turns = this.settings.speed * dt
		const angle = this.uniforms.uPropellerAngle.value + turns * Math.PI * 2
		this.uniforms.uPropellerAngle.value = angle % (Math.PI * 2)
	}
}
