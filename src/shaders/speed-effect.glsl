// Upsampled blur pyramid: already holds each pixel's blend of pyramid levels from level 1 up.
uniform sampler2D blurBuffer;
uniform vec4 aberrationParams;

#include ./speed-effect-mask.glsl
#include ./bspline.glsl

// blend 0 = sharp input, 1 = blurBuffer.
vec3 sampleBlur(vec2 uv, float blend) {
  if(blend <= 0.0)
    return textureLod(inputBuffer, uv, 0.0).rgb;

  vec3 blurred = sampleBSpline(blurBuffer, uv);
  return blend >= 1.0 ? blurred : mix(textureLod(inputBuffer, uv, 0.0).rgb, blurred, blend);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 fromCenter = uv - 0.5;
  float radius = getRadius(fromCenter);
  float lod = getBlurLod(radius, resolution.y);
  vec2 dispersion = fromCenter * (2.0 * aberrationParams.x * getMask(aberrationParams, radius));
  vec2 dispersionPixels = dispersion * resolution;
  bool hasAberration = dot(dispersionPixels, dispersionPixels) > 0.25;

  if(lod <= 0.0 && !hasAberration) {
    outputColor = inputColor;
    return;
  }

  float blend = clamp(lod, 0.0, 1.0);
  vec3 color = hasAberration ? vec3(sampleBlur(uv + dispersion, blend).r, sampleBlur(uv, blend).g, sampleBlur(uv - dispersion, blend).b) : sampleBlur(uv, blend);

  outputColor = vec4(color, inputColor.a);
}
