'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { OrbitControls } from 'three-stdlib';
import { useSim, useUI } from '../store';
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
  useFrame((_, dt) => sim.advance(dt), -1);
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
