uniform sampler2D levelBuffer;
uniform sampler2D coarserBuffer;
uniform float level;
uniform float viewHeight;

varying vec2 vUv;

#include ./speed-effect-mask.glsl
#include ./bspline.glsl

// U(level) = mix(D(level), U(level + 1), lod - level): pixels that need more blur than
// this level take it from the coarser result, so the composite reads only U(1).
void main() {
  float lod = getBlurLod(getRadius(vUv - 0.5), viewHeight);
  float blend = clamp(lod - level, 0.0, 1.0);
  vec3 color;

  if(blend <= 0.0) {
    color = texture2D(levelBuffer, vUv).rgb;
  } else if(blend >= 1.0) {
    color = sampleBSpline(coarserBuffer, vUv);
  } else {
    color = mix(texture2D(levelBuffer, vUv).rgb, sampleBSpline(coarserBuffer, vUv), blend);
  }

  gl_FragColor = vec4(color, 1.0);
}
