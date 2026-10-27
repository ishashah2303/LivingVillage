'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group, Mesh } from 'three';
import { useSim } from '../store';
import { BARN, CRATES, FOUNTAIN, HOUSES, HOUSE_HALF, STALLS, TOWER, type House as HouseT } from '@/sim/layout';
import { MAT, flat, gableRoof, numberTexture, tinted } from './materials';
import StaticMerge from './StaticMerge';

const W = HOUSE_HALF * 2;

function House({ h }: { h: HouseT }) {
  const roof = useMemo(() => gableRoof(W, W, 1.7, 0.35), []);
  const wallMat = tinted(MAT.white, h.wall);
  const sign = useMemo(() => numberTexture(h.i + 1), [h.i]);
  const roofMat = tinted(MAT.wood, h.roof);
  return (
    <group position={[h.x, 0, h.z]}>
      <mesh material={wallMat} castShadow receiveShadow position-y={1.3}>
        <boxGeometry args={[W, 2.6, W]} />
      </mesh>
      {/* timber frame */}
      <mesh material={MAT.darkWood} position={[0, 2.62, 0]}>
        <boxGeometry args={[W + 0.08, 0.12, W + 0.08]} />
      </mesh>
      <mesh geometry={roof} material={roofMat} castShadow position-y={2.66} />
      <mesh material={MAT.door} position={[0, 0.75, HOUSE_HALF + 0.03]}>
        <boxGeometry args={[0.9, 1.5, 0.08]} />
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} material={MAT.window} position={[s * 1.05, 1.6, HOUSE_HALF + 0.03]}>
          <boxGeometry args={[0.6, 0.55, 0.06]} />
        </mesh>
      ))}
      {[-1, 1].map(s => (
        <mesh key={`side${s}`} material={MAT.window} position={[s * (HOUSE_HALF + 0.03), 1.6, 0]}>
          <boxGeometry args={[0.06, 0.55, 0.7]} />
        </mesh>
      ))}
      <mesh material={MAT.darkStone} castShadow position={[0.9, 3.7, -0.7]}>
        <boxGeometry args={[0.4, 1.1, 0.4]} />
      </mesh>
      {/* house number, as in the 2D mockup */}
      <mesh position={[0, 2.2, HOUSE_HALF + 0.03]}>
        <planeGeometry args={[0.5, 0.5]} />
        <meshStandardMaterial map={sign} transparent />
      </mesh>
    </group>
  );
}

function Stall({ x, z, color, hw, hd }: { x: number; z: number; color: string; hw: number; hd: number }) {
  const sim = useSim();
  const produce = useRef<Group>(null);
  useFrame(() => {
    if (produce.current) produce.current.visible = sim.shortage <= 0;
  });
  const awning = tinted(MAT.white, color);
  return (
    <group position={[x, 0, z]}>
      <mesh material={MAT.wood} castShadow receiveShadow position-y={0.5}>
        <boxGeometry args={[hw * 2, 1, hd * 2]} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} material={MAT.darkWood} position={[sx * (hw - 0.08), 1.35, sz * (hd - 0.08)]}>
          <boxGeometry args={[0.09, 2.7, 0.09]} />
        </mesh>
      ))}
      <mesh material={awning} castShadow position={[0, 2.72, 0.1]} rotation-x={0.18}>
        <boxGeometry args={[hw * 2 + 0.3, 0.08, hd * 2 + 0.5]} />
      </mesh>
      {/* Hidden during a food shortage, so it is batched on its own rather than with the static stall. */}
      <group ref={produce} userData={{ dynamic: true }}>
        <StaticMerge>
          {['#e0703a', '#c43d3d', '#9cc04a', '#f0c24b', '#e0703a', '#9cc04a'].map((c, k) => (
            <mesh key={k} material={flat(c)} position={[-hw + 0.35 + k * ((hw * 2 - 0.7) / 5), 1.12, 0.15]}>
              <sphereGeometry args={[0.16, 8, 6]} />
            </mesh>
          ))}
        </StaticMerge>
      </group>
    </group>
  );
}

function Tower() {
  const flag = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.4) * 0.25;
  });
  const t = TOWER.half;
  return (
    <group position={[TOWER.x, 0, TOWER.z]}>
      <mesh material={MAT.stone} castShadow receiveShadow position-y={0.6}>
        <boxGeometry args={[t * 2, 1.2, t * 2]} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} material={MAT.darkWood} castShadow position={[sx * (t - 0.15), 2.6, sz * (t - 0.15)]}>
          <boxGeometry args={[0.18, 2.8, 0.18]} />
        </mesh>
      ))}
      <mesh material={MAT.wood} castShadow position-y={4.05}>
        <boxGeometry args={[t * 2 + 0.3, 0.2, t * 2 + 0.3]} />
      </mesh>
      <mesh material={MAT.barnRoof} castShadow position-y={5.1} rotation-y={Math.PI / 4}>
        <coneGeometry args={[t * 1.75, 1.4, 4]} />
      </mesh>
      <mesh material={MAT.darkWood} position={[0, 6.2, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 1.2, 6]} />
      </mesh>
      <mesh ref={flag} position={[0, 6.55, 0]} userData={{ dynamic: true }}>
        <boxGeometry args={[0.02, 0.35, 0.6]} />
        <meshStandardMaterial color="#c9502a" />
      </mesh>
    </group>
  );
}

function Barn() {
  const roof = useMemo(() => gableRoof(BARN.half * 2, BARN.half * 2, 1.3, 0.25), []);
  return (
    <group position={[BARN.x, 0, BARN.z]}>
      <mesh material={MAT.barn} castShadow receiveShadow position-y={1.1}>
        <boxGeometry args={[BARN.half * 2, 2.2, BARN.half * 2]} />
      </mesh>
      <mesh geometry={roof} material={MAT.barnRoof} castShadow position-y={2.2} rotation-y={Math.PI / 2} />
      <mesh material={MAT.white} position={[0, 0.8, -BARN.half - 0.02]}>
        <boxGeometry args={[1.1, 1.4, 0.04]} />
      </mesh>
    </group>
  );
}

function Fountain() {
  const spout = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (spout.current) spout.current.scale.y = 1 + Math.sin(clock.elapsedTime * 5) * 0.12;
  });
  return (
    <group position={[FOUNTAIN.x, 0, FOUNTAIN.z]}>
      <mesh material={MAT.stone} castShadow receiveShadow position-y={0.3}>
        <cylinderGeometry args={[FOUNTAIN.r, FOUNTAIN.r + 0.08, 0.6, 20]} />
      </mesh>
      <mesh material={MAT.water} position-y={0.61}>
        <cylinderGeometry args={[FOUNTAIN.r - 0.18, FOUNTAIN.r - 0.18, 0.02, 20]} />
      </mesh>
      <mesh material={MAT.stone} castShadow position-y={0.95}>
        <cylinderGeometry args={[0.18, 0.26, 1.1, 10]} />
      </mesh>
      <mesh material={MAT.stone} position-y={1.5}>
        <cylinderGeometry args={[0.55, 0.3, 0.18, 14]} />
      </mesh>
      <mesh ref={spout} material={MAT.water} position-y={1.75} userData={{ dynamic: true }}>
        <coneGeometry args={[0.18, 0.5, 10]} />
      </mesh>
    </group>
  );
}

export default function Buildings() {
  return (
    <group>
      {HOUSES.map(h => <House key={h.i} h={h} />)}
      {STALLS.map((s, i) => <Stall key={i} {...s} />)}
      {CRATES.map((c, i) => (
        <mesh key={i} material={MAT.wood} castShadow receiveShadow position={[c.x, c.s / 2, c.z]} rotation-y={i * 0.5}>
          <boxGeometry args={[c.s, c.s, c.s]} />
        </mesh>
      ))}
      <Tower />
      <Barn />
      <Fountain />
    </group>
  );
}
