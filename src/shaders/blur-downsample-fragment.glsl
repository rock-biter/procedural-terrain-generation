uniform sampler2D inputBuffer;
uniform vec2 texelSize;

varying vec2 vUv;

// 13-tap downsample (Jimenez 2014): antialiased, near-Gaussian, and edge-clamped by the sampler.
void main() {
  vec3 a = texture2D(inputBuffer, vUv + texelSize * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(inputBuffer, vUv + texelSize * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(inputBuffer, vUv + texelSize * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(inputBuffer, vUv + texelSize * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(inputBuffer, vUv).rgb;
  vec3 f = texture2D(inputBuffer, vUv + texelSize * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(inputBuffer, vUv + texelSize * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(inputBuffer, vUv + texelSize * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(inputBuffer, vUv + texelSize * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(inputBuffer, vUv + texelSize * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(inputBuffer, vUv + texelSize * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(inputBuffer, vUv + texelSize * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(inputBuffer, vUv + texelSize * vec2(1.0, -1.0)).rgb;

  vec3 color = e * 0.125;
  color += (a + c + g + i) * 0.03125;
  color += (b + d + f + h) * 0.0625;
  color += (j + k + l + m) * 0.125;

  gl_FragColor = vec4(color, 1.0);
}
