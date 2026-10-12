'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, SpriteMaterial, type Group, type PointLight, type Sprite } from 'three';
import { useSim, useTick } from '../store';
import { PLAZA_R } from '@/sim/layout';
import { FIRE, type Fire, type Food, type Item, type Rock, type Well } from '@/sim/simulation';
import { MAT, glowTexture } from './materials';

// Outer tongues are opaque-ish; only the hot core is additive, so the fire doesn't wash out to white.
const flameMats = (['#e8431c', '#ff7a1f', '#ffb02e', '#ffe16a'] as const).map(
  (c, i) => new MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity: i < 2 ? 0.95 : 0.8, blending: i < 2 ? NormalBlending : AdditiveBlending, depthWrite: i < 2 }),
);
const emberMat = new MeshBasicMaterial({ color: '#ffcf5a', toneMapped: false });
/** [x, z, height, radius, material] for each flame tongue. */
const FLAMES: [number, number, number, number, number][] = [
  [0, 0, 2.7, 0.75, 0], [0.45, 0.25, 2.0, 0.55, 1], [-0.4, 0.3, 2.2, 0.55, 1], [0.15, -0.45, 1.9, 0.5, 1],
  [-0.3, -0.35, 1.6, 0.45, 2], [0, 0.05, 1.6, 0.45, 3], [0.55, -0.2, 1.3, 0.35, 2],
];

function FireFx({ f }: { f: Fire }) {
  const flames = useRef<Group>(null), smoke = useRef<Group>(null), embers = useRef<Group>(null), light = useRef<PointLight>(null);
  const halo = useRef<Sprite>(null);
  const glow = useMemo(() => new SpriteMaterial({ map: glowTexture('rgba(255,150,60,1)'), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6, toneMapped: false }), []);
  const smokeMats = useMemo(() => {
    const puff = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    return Array.from({ length: 10 }, () => new SpriteMaterial({ map: puff, color: '#5f5a55', transparent: true, depthWrite: false }));
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + f.id * 3.1;
    const s = f.alive ? 1 : f.fade;
    flames.current!.children.forEach((m, k) => {
      const flick = 0.82 + 0.28 * Math.sin(t * (8 + k * 1.3) + k * 2.1) * Math.sin(t * 3.1 + k);
      m.scale.set(s * (0.85 + 0.15 * Math.sin(t * 7 + k)), s * flick, s * (0.85 + 0.15 * Math.cos(t * 6 + k)));
      m.rotation.y = t * 0.8 + k;
      m.position.y = (FLAMES[k][2] * s * flick) / 2;
    });
    halo.current!.scale.setScalar(s * (5.5 + Math.sin(t * 9) * 0.4));
    light.current!.intensity = s * (40 + 10 * Math.sin(t * 13) + 6 * Math.sin(t * 7.3));
    embers.current!.children.forEach((m, k) => {
      const p = (t * 0.55 + k / 12) % 1;
      m.position.set(Math.sin(k * 3.7 + t) * (0.3 + p * 0.9), 0.4 + p * 4.5, Math.cos(k * 2.9 + t * 0.7) * (0.3 + p * 0.9));
      m.scale.setScalar(s * (1 - p));
    });
    smoke.current!.children.forEach((m, k) => {
      const p = (t * 0.2 + k / 10) % 1;
      m.position.set(Math.sin(k * 1.9 + t * 0.25) * (0.3 + p * 1.6) + p * 1.2, 2.2 + p * 7, Math.cos(k * 2.3) * (0.3 + p));
      m.scale.setScalar(1.6 + p * 4.5);
      const mat = smokeMats[k];
      mat.opacity = Math.sin(p * Math.PI) * 0.55 * (f.alive ? 1 : 0.5 + 0.5 * s);
      mat.color.set(f.alive ? '#5f5a55' : '#eef1f3'); // steam once it is out
    });
  });
  return (
    <group position={[f.x, 0, f.z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <circleGeometry args={[FIRE.blockRadius, 28]} />
        <meshStandardMaterial color="#2b2520" transparent opacity={0.6} />
      </mesh>
      {[0, 1.1, 2.2].map(a => (
        <mesh key={a} material={MAT.darkWood} position-y={0.14} rotation={[Math.PI / 2, 0, a]}>
          <cylinderGeometry args={[0.12, 0.12, 1.9, 6]} />
        </mesh>
      ))}
      <group ref={flames}>
        {FLAMES.map(([x, z, h, r, m], k) => (
          <mesh key={k} material={flameMats[m]} position={[x, h / 2, z]}>
            <coneGeometry args={[r, h, 7]} />
          </mesh>
        ))}
      </group>
      <sprite ref={halo} material={glow} position-y={1.3} />
      <group ref={embers}>
        {Array.from({ length: 12 }, (_, k) => (
          <mesh key={k} material={emberMat}>
            <sphereGeometry args={[0.05, 4, 3]} />
          </mesh>
        ))}
      </group>
      <pointLight ref={light} color="#ff8a3a" distance={18} decay={1.4} position={[0, 1.8, 0]} />
      <group ref={smoke}>
        {smokeMats.map((m, k) => (
          <sprite key={k} material={m} />
        ))}
      </group>
    </group>
  );
}

function RockFx({ r }: { r: Rock }) {
  return (
    <group position={[r.x, 0, r.z]} rotation-y={r.rot}>
      <mesh castShadow receiveShadow position-y={0.55} scale={[1.1, 0.8, 1]}>
        <dodecahedronGeometry args={[r.r * 0.95, 0]} />
        <meshStandardMaterial color="#8b8a82" flatShading roughness={1} />
      </mesh>
      <mesh castShadow position={[0.9, 0.25, 0.5]}>
        <dodecahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial color="#9d9c93" flatShading roughness={1} />
      </mesh>
    </group>
  );
}

function WellFx({ w }: { w: Well }) {
  return (
    <group position={[w.x, 0, w.z]}>
      <mesh material={MAT.stone} castShadow receiveShadow position-y={0.4}>
        <cylinderGeometry args={[w.r, w.r + 0.05, 0.8, 14]} />
      </mesh>
      <mesh material={MAT.water} position-y={0.81}>
        <cylinderGeometry args={[w.r - 0.22, w.r - 0.22, 0.02, 14]} />
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} material={MAT.darkWood} castShadow position={[s * (w.r - 0.1), 1.3, 0]}>
          <boxGeometry args={[0.12, 1.8, 0.12]} />
        </mesh>
      ))}
      <mesh material={MAT.wood} position-y={1.85} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.05, 0.05, w.r * 2, 6]} />
      </mesh>
      <mesh material={MAT.barnRoof} castShadow position-y={2.45} rotation-y={Math.PI / 4}>
        <coneGeometry args={[w.r + 0.35, 0.7, 4]} />
      </mesh>
      <mesh material={MAT.wood} position={[0, 1.35, 0]}>
        <cylinderGeometry args={[0.14, 0.11, 0.22, 8]} />
      </mesh>
    </group>
  );
}

const FRUIT = ['#d8453a', '#f0c24b', '#8fc04a'];
function FoodFx({ f }: { f: Food }) {
  return (
    <group position={[f.x, 0, f.z]}>
      <mesh castShadow position-y={0.16}>
        <cylinderGeometry args={[0.45, 0.36, 0.32, 10]} />
        <meshStandardMaterial color="#b58a4f" flatShading />
      </mesh>
      {Array.from({ length: f.servings }, (_, k) => (
        <mesh key={k} position={[Math.cos(k * 2.1) * 0.18, 0.38, Math.sin(k * 2.1) * 0.18]}>
          <sphereGeometry args={[0.15, 8, 6]} />
          <meshStandardMaterial color={FRUIT[k % 3]} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function ItemFx({ it }: { it: Item }) {
  switch (it.kind) {
    case 'fire': return <FireFx f={it} />;
    case 'rock': return <RockFx r={it} />;
    case 'well': return <WellFx w={it} />;
    case 'food': return <FoodFx f={it} />;
  }
}

/** Lanterns strung around the square while a festival is on. */
function Festival() {
  const sim = useSim();
  const g = useRef<Group>(null);
  const poles = 10, R = PLAZA_R + 0.6;
  const lanterns = useMemo(() => {
    const out: { x: number; y: number; z: number; c: string }[] = [];
    const colors = ['#ffcf5a', '#ff8a5a', '#8fd0ff', '#ff6f91'];
    for (let i = 0; i < poles; i++)
      for (let k = 1; k < 4; k++) {
        const a = ((i + k / 4) / poles) * Math.PI * 2;
        out.push({ x: Math.cos(a) * R, y: 2.55 - Math.sin((k / 4) * Math.PI) * 0.45, z: Math.sin(a) * R, c: colors[(i + k) % 4] });
      }
    return out;
  }, [R]);
  const lamps = useMemo(() => lanterns.map(l => new MeshStandardMaterial({ color: l.c, emissive: l.c, emissiveIntensity: 0.9, flatShading: true })), [lanterns]);
  useFrame(({ clock }) => {
    const on = sim.festival > 0;
    g.current!.visible = on;
    if (!on) return;
    const night = Math.max(0, -Math.sin(((sim.hour - 6) / 12) * Math.PI));
    lamps.forEach((m, i) => (m.emissiveIntensity = 0.7 + night * 1.6 + Math.sin(clock.elapsedTime * 3 + i) * 0.2));
  });
  return (
    <group ref={g} visible={false}>
      {Array.from({ length: poles }, (_, i) => {
        const a = (i / poles) * Math.PI * 2;
        return (
          <mesh key={i} material={MAT.darkWood} castShadow position={[Math.cos(a) * R, 1.35, Math.sin(a) * R]}>
            <cylinderGeometry args={[0.05, 0.06, 2.7, 6]} />
          </mesh>
        );
      })}
      {lanterns.map((l, i) => (
        <mesh key={i} material={lamps[i]} position={[l.x, l.y, l.z]}>
          <sphereGeometry args={[0.16, 8, 6]} />
        </mesh>
      ))}
      <pointLight color="#ffc36b" intensity={30} distance={14} position={[0, 3, 0]} />
    </group>
  );
}

export default function Items() {
  const sim = useSim();
  useTick(6);
  return (
    <group>
      {sim.items.map(it => <ItemFx key={it.id} it={it} />)}
      <Festival />
    </group>
  );
}
