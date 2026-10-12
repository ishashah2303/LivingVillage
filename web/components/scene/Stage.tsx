'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { OrbitControls } from 'three-stdlib';
import { framePerf, useSim, useUI } from '../store';
import Birds from './Birds';
import Buildings from './Buildings';
import DayNight from './DayNight';
import { CameraRig, Cursor, Ground } from './Interaction';
import Items from './Items';
import NavDebug from './NavDebug';
import Terrain from './Terrain';
import Trees from './Trees';
import Villagers from './Villagers';

/** Advances the simulation once per rendered frame, before anything reads it. */
function SimDriver() {
  const sim = useSim();
  useFrame((_, dt) => {
    const t0 = performance.now();
    sim.advance(dt);
    framePerf.simMs += (performance.now() - t0 - framePerf.simMs) * 0.1;
  }, -1);
  return null;
}

/** Frame rate over half-second windows, plus the renderer's draw calls (shadow passes included). */
function PerfProbe() {
  const gl = useThree(s => s.gl);
  useEffect(() => {
    let frames = 0, elapsed = 0, worst = 0, raf = 0, last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      frames++;
      elapsed += dt;
      worst = Math.max(worst, dt);
      if (elapsed >= 500) {
        framePerf.fps = (frames * 1000) / elapsed;
        framePerf.frameMs = elapsed / frames;
        framePerf.worstMs = worst;
        framePerf.calls = gl.info.render.calls;
        framePerf.triangles = gl.info.render.triangles;
        frames = 0;
        elapsed = 0;
        worst = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gl]);
  return null;
}

declare global {
  interface Window {
    /** Debug handles for scripted demos and screenshots. */
    view?: (pos: [number, number, number], target: [number, number, number]) => void;
    ui?: typeof useUI;
  }
}

/** Exposes camera + UI store on window so demos and screenshot scripts can stage a shot. */
function DebugHandles() {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as OrbitControls | null;
  useEffect(() => {
    window.ui = useUI;
    window.view = (pos, target) => {
      camera.position.set(...pos);
      controls?.target.set(...target);
      controls?.update();
    };
  }, [camera, controls]);
  return null;
}

export default function Stage() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [4, 40, 41], fov: 38, near: 0.5, far: 400 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <SimDriver />
      <PerfProbe />
      <DayNight />
      <Terrain />
      <Buildings />
      <Trees />
      <Items />
      <Villagers />
      <Birds />
      <NavDebug />
      <Ground />
      <Cursor />
      <CameraRig />
      <DebugHandles />
    </Canvas>
  );
}
