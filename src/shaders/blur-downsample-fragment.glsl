uniform sampler2D inputBuffer;
uniform vec2 texelSize;

varying vec2 vUv;

// 5-tap dual-filter downsample (Bjørge 2015): each bilinear tap averages a 2x2 texel block.
// The center block weighs 4/8 and the four diagonal blocks 1/8 each, a tent over ~4x4
// source texels. Edge-clamped by the sampler.
void main() {
  vec3 color = texture2D(inputBuffer, vUv).rgb * 4.0;
  color += texture2D(inputBuffer, vUv + texelSize * vec2(-1.0, -1.0)).rgb;
  color += texture2D(inputBuffer, vUv + texelSize * vec2(1.0, -1.0)).rgb;
  color += texture2D(inputBuffer, vUv + texelSize * vec2(-1.0, 1.0)).rgb;
  color += texture2D(inputBuffer, vUv + texelSize * vec2(1.0, 1.0)).rgb;

  gl_FragColor = vec4(color * 0.125, 1.0);
}
