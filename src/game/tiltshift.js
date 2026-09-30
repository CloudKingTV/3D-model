import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Tilt-shift: the miniature-faking trick from photography.
 *
 * A real macro shot of something 96mm long has a depth of field a few
 * millimetres deep, so everything but a narrow band is blurred. Reproducing
 * that is the single strongest cue that what you are looking at is tiny — more
 * convincing than any amount of modelling detail. This fakes it in screen
 * space (blur by distance from a horizontal band) rather than from real depth,
 * which costs one cheap pass instead of a second render of the whole scene.
 *
 * A gentle saturation lift rides along, because toy-like colour sells it too.
 */
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uFocus: { value: 0.52 }, // screen-space Y of the sharp band
    uRange: { value: 0.1 }, // half-height of the fully sharp band
    uFeather: { value: 0.3 },
    uStrength: { value: 5.0 }, // blur radius in pixels at full falloff
    uSaturation: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform vec2 uDirection;
    uniform float uFocus;
    uniform float uRange;
    uniform float uFeather;
    uniform float uStrength;
    uniform float uSaturation;
    varying vec2 vUv;

    void main() {
      float distanceFromBand = abs(vUv.y - uFocus);
      float blur = smoothstep(uRange, uRange + uFeather, distanceFromBand) * uStrength;

      vec4 color;
      if (blur < 0.01) {
        color = texture2D(tDiffuse, vUv);
      } else {
        // Five-tap gaussian, using linear sampling for a wider kernel per tap.
        vec2 offset = uDirection * uTexel * blur;
        color  = texture2D(tDiffuse, vUv) * 0.2270270270;
        color += texture2D(tDiffuse, vUv + offset * 1.3846153846) * 0.3162162162;
        color += texture2D(tDiffuse, vUv - offset * 1.3846153846) * 0.3162162162;
        color += texture2D(tDiffuse, vUv + offset * 3.2307692308) * 0.0702702703;
        color += texture2D(tDiffuse, vUv - offset * 3.2307692308) * 0.0702702703;
      }

      if (uSaturation != 1.0) {
        float grey = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
        color.rgb = mix(vec3(grey), color.rgb, uSaturation);
      }
      gl_FragColor = color;
    }
  `,
};

export function createTiltShift(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const horizontal = new ShaderPass(TiltShiftShader);
  const vertical = new ShaderPass(TiltShiftShader);
  vertical.uniforms.uDirection.value.set(0, 1);
  vertical.uniforms.uSaturation.value = 1.12;
  composer.addPass(horizontal);
  composer.addPass(vertical);
  composer.addPass(new OutputPass());

  const passes = [horizontal, vertical];

  return {
    composer,
    render() {
      composer.render();
    },
    setSize(width, height, pixelRatio) {
      composer.setSize(width, height);
      composer.setPixelRatio(pixelRatio);
      for (const pass of passes) {
        pass.uniforms.uTexel.value.set(1 / width, 1 / height);
      }
    },
    /** Keep the sharp band on the board as it moves up and down the frame. */
    setFocus(screenY) {
      for (const pass of passes) {
        pass.uniforms.uFocus.value = THREE.MathUtils.clamp(screenY, 0.15, 0.85);
      }
    },
    /** Half-height of the fully sharp band, in screen fractions. */
    setRange(range) {
      for (const pass of passes) pass.uniforms.uRange.value = range;
    },
    setStrength(strength) {
      for (const pass of passes) pass.uniforms.uStrength.value = strength;
    },
    dispose() {
      for (const pass of passes) pass.dispose?.();
      composer.dispose();
    },
  };
}
