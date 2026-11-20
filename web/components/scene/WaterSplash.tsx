'use client';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, Mesh, MeshBasicMaterial } from 'three';
import { useGame } from '../store';

/** One short-lived splash, recycled for each successful bucket; no simulation effects. */
export default function WaterSplash() {
  const game = useGame();
  const group = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const seen = useRef(0), age = useRef(2);
  useFrame((_, dt) => {
    const g = group.current!, f = game.waterFeedback;
    if (f && f.id !== seen.current) {
      seen.current = f.id;
      if (f.kind === 'hit' || f.kind === 'out') { age.current = 0; g.position.set(f.x, 0.15, f.z); }
    }
    age.current += Math.min(dt, 0.1);
    const t = age.current / 0.75;
    g.visible = t < 1;
    if (!g.visible) return;
    ring.current!.scale.setScalar(0.6 + t * 2.5);
    (ring.current!.material as MeshBasicMaterial).opacity = (1 - t) * 0.8;
    g.children.slice(1).forEach((drop, i) => {
      const a = i / 10 * Math.PI * 2;
      drop.position.set(Math.cos(a) * t * 2.3, 0.3 + Math.sin(t * Math.PI) * 1.8, Math.sin(a) * t * 2.3);
      drop.scale.setScalar(1 - t * 0.7);
    });
  });
  return <group ref={group} visible={false}>
    <mesh ref={ring} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.8, 1, 24]} /><meshBasicMaterial color="#9eeaff" transparent depthWrite={false} />
    </mesh>
    {Array.from({ length: 10 }, (_, i) => <mesh key={i}>
      <sphereGeometry args={[0.12, 4, 3]} /><meshBasicMaterial color="#9eeaff" />
    </mesh>)}
  </group>;
}
