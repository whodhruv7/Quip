import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PixState } from "@/types";

// Relative path so the asset works both in dev server and file:// packaged runs.
const MODEL_URL = "./models/textured_mesh.glb";

function stateScale(state: PixState, t: number): number {
  switch (state) {
    case "thinking":
      return 1 + Math.sin(t * 4.5) * 0.015;
    case "responding":
      return 1 + Math.sin(t * 7) * 0.03;
    case "listening":
      return 1 + Math.sin(t * 3.2) * 0.01;
    case "sleeping":
      return 0.98 + Math.sin(t * 1.4) * 0.008;
    case "happy":
      return 1 + Math.sin(t * 5.5) * 0.02;
    default:
      return 1 + Math.sin(t * 2.4) * 0.01;
  }
}

export function Pix3D({
  state,
  moodSpeed = 1,
  onReadyChange,
  onLoadError,
}: {
  state: PixState;
  moodSpeed?: number;
  onReadyChange?: (ready: boolean) => void;
  onLoadError?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.15, 4.3);

    const root = new THREE.Group();
    scene.add(root);

    const softLight = new THREE.DirectionalLight(0xffffff, 1.6);
    softLight.position.set(2.6, 4.2, 3.2);
    scene.add(softLight);

    const coolLight = new THREE.DirectionalLight(0x8ad7ff, 0.85);
    coolLight.position.set(-3, 1.8, 2.5);
    scene.add(coolLight);

    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambient);

    const gltfLoader = new GLTFLoader();
    const clock = new THREE.Clock();
    let disposed = false;
    let model: THREE.Group | null = null;
    let frame = 0;

    const setReady = (next: boolean) => {
      if (readyRef.current === next) return;
      readyRef.current = next;
      onReadyChange?.(next);
    };

    gltfLoader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        model.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            const material = mesh.material;
            const materials = Array.isArray(material) ? material : [material];
            materials.forEach((mat) => {
              const anyMat = mat as THREE.MeshStandardMaterial;
              anyMat.metalness = 0.08;
              anyMat.roughness = 0.5;
              anyMat.envMapIntensity = 0.4;
            });
          }
        });

        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        model.position.sub(center);
        model.scale.setScalar(2.4 / maxDim);
        model.rotation.x = -0.08;
        root.add(model);
        setReady(true);
      },
      undefined,
      () => {
        setReady(false);
        onLoadError?.();
      }
    );

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const animate = () => {
      if (disposed) return;
      const elapsed = clock.getElapsedTime() * moodSpeed;
      const breathing = stateScale(state, elapsed);
      root.scale.setScalar(breathing);
      root.position.y = Math.sin(elapsed * 1.8) * 0.03;
      root.rotation.y = Math.sin(elapsed * 0.75) * 0.22;
      if (model) {
        model.rotation.x = -0.08 + Math.sin(elapsed * 1.3) * 0.03;
        model.rotation.z = Math.sin(elapsed * 0.9) * 0.02;
      }
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };

    resize();
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      if (model) {
        model.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.geometry.dispose();
            const material = mesh.material;
            if (Array.isArray(material)) {
              material.forEach((mat) => mat.dispose());
            } else {
              material.dispose();
            }
          }
        });
      }
    };
  }, [moodSpeed, onReadyChange, state]);

  const aura = useMemo(() => {
    const opacity = state === "sleeping" ? 0.22 : 0.4;
    return `radial-gradient(circle at 50% 45%, rgba(130, 210, 255, ${opacity}) 0%, rgba(130, 210, 255, ${opacity * 0.55}) 45%, transparent 75%)`;
  }, [state]);

  return (
    <div
      ref={hostRef}
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        overflow: "hidden",
        background: aura,
        boxShadow: "inset 0 0 24px rgba(255,255,255,0.14)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
    </div>
  );
}
