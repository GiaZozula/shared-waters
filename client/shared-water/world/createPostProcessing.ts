import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

const opticalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: window.innerWidth / window.innerHeight },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      vec2 p = (vUv - 0.5) * 2.0;
      p.x *= mix(0.72, 1.0, clamp(uAspect - 1.0, 0.0, 1.0));

      float radial = length(p);
      float vignette = pow(smoothstep(0.38, 1.18, radial), 1.45);
      color *= 1.0 - vignette * 0.74;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
}

export function createPostProcessing(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const composer = new EffectComposer(renderer)
  const opticalPass = new ShaderPass(opticalShader)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.38, 0.72))
  composer.addPass(opticalPass)
  composer.addPass(new OutputPass())
  return {
    render: () => composer.render(),
    update: (_elapsed?: number) => {},
    resize: (width: number, height: number, pixelRatio: number) => {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
      opticalPass.uniforms.uAspect.value = width / height
    },
  }
}
