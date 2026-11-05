// Keep marks on the same curved, moving surface as getOceanHeight.
export const waterHeightGLSL = `
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uWaterEnergy;

  float waterHeight(vec2 point) {
    vec2 p = vec2(point.x, -point.y);
    vec2 wind = vec2(uWind.x, -uWind.y) / max(length(uWind), 0.0001);
    vec2 crossWind = vec2(-wind.y, wind.x);
    return -2.0 - pow(length(p) / 82.0, 2.0) * 9.0
      + (1.3 + uWaterEnergy * 1.2) * (sin(p.x * 0.075 + uTime * 0.13) * 0.24
      + sin(p.y * 0.052 - uTime * 0.10) * 0.18
      + sin((p.x + p.y) * 0.19 + uTime * 0.21) * 0.055
      + sin((p.x - p.y) * 0.14 - uTime * 0.16) * 0.045
      + sin(dot(p, wind) * 0.24 + uTime * (0.32 + uWaterEnergy * 0.32)) * 0.14 * uWaterEnergy
      + sin(dot(p, crossWind) * 0.42 - uTime * 0.34) * 0.065 * uWaterEnergy);
  }
`

export const waterMarkVertexShader = `
  ${waterHeightGLSL}
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    worldPosition.y = waterHeight(worldPosition.xz) + 0.12;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`
