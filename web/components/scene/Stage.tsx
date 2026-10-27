'use client';
import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import type { OrbitControls } from 'three-stdlib';
import { framePerf, useGame, useSim, useUI } from '../store';
import Birds from './Birds';
import Buildings from './Buildings';
import DayNight from './DayNight';
import { CameraRig, Cursor, Ground } from './Interaction';
import Items from './Items';
import NavDebug from './NavDebug';
import StaticMerge from './StaticMerge';
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

/**
 * The sun's shadow map is redrawn every other frame: villagers move a few centimeters per frame, so
 * nobody sees the lag, and the shadow pass (a second draw of every caster) costs half as much.
 */
function ShadowThrottle() {
  const gl = useThree(s => s.gl);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useFrame(({ clock }) => {
    if (Math.floor(clock.elapsedTime * 60) % 2 === 0) gl.shadowMap.needsUpdate = true;
  });
  return null;
}

/**
 * Pixel density. A 4K laptop reports 2-2.5 device pixels per CSS pixel, which is 4-6x the pixels of an
 * ordinary screen for an integrated GPU to fill. Start at 1.5 at most, and step down to 1 while frames drop.
 */
const MAX_DPR = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

declare global {
  interface Window {
    /** Debug handles for scripted demos and screenshots. */
    view?: (pos: [number, number, number], target: [number, number, number]) => void;
    ui?: typeof useUI;
    three?: { scene: import('three').Scene; gl: import('three').WebGLRenderer };
  }
}

/** Exposes camera + UI store on window so demos and screenshot scripts can stage a shot. */
function DebugHandles() {
  const camera = useThree(s => s.camera);
  const scene = useThree(s => s.scene);
  const gl = useThree(s => s.gl);
  const controls = useThree(s => s.controls) as OrbitControls | null;
  useEffect(() => {
    window.ui = useUI;
    window.three = { scene, gl };
    window.view = (pos, target) => {
      camera.position.set(...pos);
      controls?.target.set(...target);
      controls?.update();
    };
  }, [camera, controls, scene, gl]);
  return null;
}

export default function Stage() {
  const game = useGame();
  const [dpr, setDpr] = useState(MAX_DPR);
  framePerf.dpr = dpr;
  // One canvas for the whole session: a new game remounts only the parts that belong to its world,
  // so the WebGL context and the compiled shaders survive Start and Play again.
  return (
    <Canvas
      shadows
      dpr={dpr}
      camera={{ position: [4, 40, 41], fov: 38, near: 0.5, far: 400 }}
      gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
    >
      <PerformanceMonitor
        flipflops={4}
        onDecline={() => setDpr(d => Math.max(1, d - 0.25))}
        onIncline={() => setDpr(d => Math.min(MAX_DPR, d + 0.25))}
        onFallback={() => setDpr(1)}
      />
      <ShadowThrottle />
      <SimDriver />
      <PerfProbe />
      <DayNight />
      <StaticMerge>
        <Terrain />
        <Buildings />
      </StaticMerge>
      <Trees />
      <group key={game.id}>
        <Items />
        <Villagers />
        <Birds />
        <NavDebug />
        <Ground />
        <Cursor />
      </group>
      <CameraRig />
      <DebugHandles />
    </Canvas>
  );
}
