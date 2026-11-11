'use client';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, type Group, type LineSegments } from 'three';
import { LAND_PROJECT, MEADOW_SPOTS } from '@/sim/layout';
import { Rng } from '@/sim/math';
import { useSim, useTick, labelLayer } from '../store';
import { MAT, flat } from './materials';

/** The new district stays outside StaticMerge because its visibility and height change. */
export function LandExpansion() {
  const sim = useSim();
  useTick(4);
  const progress = sim.landWork / LAND_PROJECT.workRequired;
  const visible = sim.buildingLand || progress > 0;
  return <group>
    {visible && <group position={[40.5, sim.meadowOpen ? 0 : -2.5 * (1 - progress), 0]}>
      <mesh material={MAT.dirt} position-y={-1.2} receiveShadow><boxGeometry args={[20, 2.4, 42]} /></mesh>
      <mesh material={flat(sim.meadowOpen ? '#92b66d' : '#bdad83')} position-y={0.015} receiveShadow>
        <boxGeometry args={[20, 0.03, 42]} />
      </mesh>
    </group>}
    {!sim.meadowOpen && <group position={[LAND_PROJECT.x, 0, LAND_PROJECT.z]}>
      {[-3, 3].map(z => <group key={z} position={[2.5, 0, z]}>
        <mesh material={MAT.darkWood} position-y={0.75}><boxGeometry args={[0.15, 1.5, 0.15]} /></mesh>
      </group>)}
      <mesh material={flat('#d6ad56')} position={[2.5, 0.95, 0]}><boxGeometry args={[0.16, 0.3, 6.2]} /></mesh>
      {visible && <Html position={[0, 2.4, 0]} center portal={labelLayer} zIndexRange={[18, 0]}>
        <div className="tag"><div className="name">East meadow · {Math.floor(progress * 100)}%</div></div>
      </Html>}
    </group>}
    {sim.meadowOpen && <group>
      <mesh material={MAT.path} position={[34, 0.045, 0]} receiveShadow><boxGeometry args={[14, 0.05, 2]} /></mesh>
      <mesh material={MAT.path} position={[40, 0.045, 0]} receiveShadow><boxGeometry args={[1.6, 0.05, 24]} /></mesh>
      {MEADOW_SPOTS.map(s => <group key={s.cmd} position={[s.x, 0, s.z]}>
        <mesh material={MAT.plaza} position-y={0.045} receiveShadow><cylinderGeometry args={[2.5, 2.5, 0.06, 16]} /></mesh>
        <mesh material={MAT.darkWood} position={[0, 0.7, -2.5]}><boxGeometry args={[0.12, 1.4, 0.12]} /></mesh>
        <mesh material={flat('#6b9863')} position={[0.4, 1.2, -2.5]}><boxGeometry args={[0.8, 0.45, 0.08]} /></mesh>
      </group>)}
      <Html position={[40, 2.4, 0]} center portal={labelLayer} zIndexRange={[18, 0]}>
        <div className="tag"><div className="name">East meadow · open</div></div>
      </Html>
    </group>}
  </group>;
}

/** A single draw call for rain; positions depend on simulation time, so pause freezes it. */
export function RainShower() {
  const sim = useSim();
  const ref = useRef<LineSegments>(null);
  const cloud = useRef<Group>(null);
  const { geometry, drops } = useMemo(() => {
    const rng = new Rng(81);
    const drops = Array.from({ length: 450 }, () => ({ x: rng.next(), z: rng.next(), y: rng.next() }));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(drops.length * 6), 3));
    return { geometry, drops };
  }, []);
  useFrame(() => {
    if (!ref.current || !cloud.current) return;
    ref.current.visible = cloud.current.visible = sim.rain > 0;
    if (sim.rain <= 0) return;
    const attr = geometry.getAttribute('position');
    drops.forEach((d, i) => {
      const x = sim.bounds.minX + d.x * (sim.bounds.maxX - sim.bounds.minX);
      const z = -20 + d.z * 40;
      const y = ((d.y * 14 - sim.simTime * 11) % 14 + 14) % 14;
      attr.setXYZ(i * 2, x, y, z);
      attr.setXYZ(i * 2 + 1, x + 0.12, y + 0.75, z);
    });
    attr.needsUpdate = true;
  });
  return <>
    <lineSegments ref={ref} geometry={geometry} visible={false} frustumCulled={false}>
      <lineBasicMaterial color="#d6eafa" transparent opacity={0.65} depthWrite={false} />
    </lineSegments>
    <group ref={cloud} visible={false} position={[0, 14, -9]}>
      {[-16, -5, 6, 17].map((x, i) => <mesh key={x} material={flat('#8698a5')} position={[x, i % 2, 0]} scale={[7, 1.3, 3.5]}>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>)}
    </group>
  </>;
}
