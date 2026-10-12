'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, Fog, type DirectionalLight, type HemisphereLight } from 'three';
import { useSim } from '../store';
import { clamp } from '@/sim/math';
import { MAT } from './materials';

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const NIGHT = new Color('#0f1a31'), DUSK = new Color('#e8a27a'), DAY = new Color('#bcd9ea');

/** Sun arc, sky color, fog and night glow, all driven by the simulation clock. */
export default function DayNight() {
  const sim = useSim();
  const { scene } = useThree();
  const sun = useRef<DirectionalLight>(null), moon = useRef<DirectionalLight>(null), hemi = useRef<HemisphereLight>(null);
  const tmp = useMemo(
    () => ({ bg: new Color(), warm: new Color('#ffc58f'), white: new Color('#fff6e8'), hn: new Color('#3a4670'), hdusk: new Color('#f1c7a4'), hd: new Color('#dfefff') }),
    [],
  );
  useMemo(() => {
    scene.background = new Color(DAY);
    scene.fog = new Fog(DAY, 95, 190);
  }, [scene]);

  useFrame(() => {
    const el = Math.sin(((sim.hour - 6) / 12) * Math.PI);
    // Direct sun only while it is up; sky light lingers after sunset so dusk is not pitch black.
    const sunUp = smooth(-0.04, 0.3, el);
    const ambient = smooth(-0.3, 0.2, el);
    const az = ((sim.hour - 6) / 12) * Math.PI;
    sun.current!.position.set(Math.cos(az) * 42, Math.max(el, 0.08) * 48 + 6, 22);
    sun.current!.intensity = 2.8 * sunUp;
    sun.current!.color.copy(tmp.warm).lerp(tmp.white, smooth(0.05, 0.55, el));
    moon.current!.intensity = 0.6 * (1 - ambient);
    hemi.current!.intensity = 0.5 + 0.8 * ambient;
    if (el < 0.05) hemi.current!.color.copy(tmp.hn).lerp(tmp.hdusk, smooth(-0.3, 0.05, el));
    else hemi.current!.color.copy(tmp.hdusk).lerp(tmp.hd, smooth(0.05, 0.4, el));
    const { bg } = tmp;
    if (el < 0) bg.copy(NIGHT).lerp(DUSK, smooth(-0.3, 0, el));
    else bg.copy(DUSK).lerp(DAY, smooth(0, 0.45, el));
    (scene.background as Color).copy(bg);
    (scene.fog as Fog).color.copy(bg);
    MAT.window.emissiveIntensity = (1 - sunUp) * 1.8;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#dfefff', '#6b7d4a', 1]} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-42}
        shadow-camera-right={42}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-camera-near={1}
        shadow-camera-far={160}
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
      />
      <directionalLight ref={moon} position={[-30, 40, -25]} color="#9fb4ff" intensity={0} />
    </>
  );
}
