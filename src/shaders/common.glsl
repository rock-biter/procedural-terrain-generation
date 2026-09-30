#include <common>
uniform float uTime;
uniform vec3 uCamera;
uniform float uCurvature;
uniform vec3 uGrass;
uniform vec3 uLand;
uniform vec3 uRocks;
uniform vec3 uAtmosphere;
// Seeded shift of the biome field; src/biome.js applies the same offset on the CPU.
uniform vec2 uBiomeOffset;
varying vec3 wPosition;
varying float distanceFromCamera;

mat4 rotateZ(float alpha) {
    float cosA = cos(alpha);
    float sinA = sin(alpha);

    return mat4(
        cosA, -sinA, 0.0, 0.0,
        sinA, cosA,  0.0, 0.0,
        0.0,  0.0,   1.0, 0.0,
        0.0,  0.0,   0.0, 1.0
    );
}

// Rodrigues rotation of v around a unit axis by the angle with cosine c and sine s.
vec3 rotateAroundAxis(vec3 v, vec3 axis, float c, float s) {
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Mirrored by getBiomeValue() in src/biome.js; keep both in sync.
// biomeXZ is the world XZ position already shifted by uBiomeOffset.
float getBiomeValue(vec2 biomeXZ) {
  return snoise(biomeXZ * 0.000175)
    + snoise(biomeXZ * 0.0035) * 0.22
    + snoise(biomeXZ * 0.012) * 0.06;
}
