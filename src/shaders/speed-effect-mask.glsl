// Shared by the speed-effect composite and the blur upsample, so both see the same blur level.
uniform float intensity;
// x = strength, y = start radius, z = end radius, w = curve exponent.
uniform vec4 blurParams;
// Scales the vertical distance from the center: < 1 weakens the effect toward the top and bottom edges.
uniform float verticalScale;

// 0 at the center, ~0.71 at the left/right edges, and 1 at the corners when verticalScale is 1.
// Only the vertical component is scaled, so the horizontal falloff never changes.
float getRadius(vec2 fromCenter) {
  return length(vec2(fromCenter.x, fromCenter.y * verticalScale)) * 1.41421356;
}

float getMask(vec4 params, float radius) {
  return intensity * pow(smoothstep(params.y, params.z, radius), params.w);
}

// Level k of the pyramid blurs by roughly 2^k pixels of a viewport viewHeight pixels tall.
float getBlurLod(float radius, float viewHeight) {
  float blurPixels = blurParams.x * getMask(blurParams, radius) * viewHeight;
  return log2(max(blurPixels, 1.0));
}
