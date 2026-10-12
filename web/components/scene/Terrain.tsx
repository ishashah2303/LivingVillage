'use client';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Float32BufferAttribute, InstancedMesh, Matrix4, PlaneGeometry } from 'three';
import { useSim } from '../store';
import { DOCK, FARM, PATHS, PLAZA_R, POND, g2w } from '@/sim/layout';
import { Rng } from '@/sim/math';
import { MAT } from './materials';

/** Low-poly grass: every triangle gets a slightly different green. */
function GrassTop() {
  const geo = useMemo(() => {
    const g = new PlaneGeometry(62, 42, 62, 42).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    const rng = new Rng(11), base = new Color('#8fb36a'), c = new Color(), colors: number[] = [];
    const n = g.getAttribute('position').count;
    for (let i = 0; i < n; i += 3) {
      c.copy(base).multiplyScalar(0.9 + rng.next() * 0.14);
      c.g *= 0.98 + rng.next() * 0.05;
      for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return g;
  }, []);
  return (
    <mesh geometry={geo} receiveShadow position-y={0.001}>
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  );
}

function Paths() {
  return (
    <group>
      {PATHS.map(([a, b, w], i) => {
        const len = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.x - a.x, b.z - a.z);
        return (
          <group key={i}>
            <mesh material={MAT.path} receiveShadow position={[(a.x + b.x) / 2, 0.012, (a.z + b.z) / 2]} rotation-y={ang}>
              <boxGeometry args={[w, 0.02, len]} />
            </mesh>
            <mesh material={MAT.path} receiveShadow position={[b.x, 0.012, b.z]}>
              <cylinderGeometry args={[w / 2, w / 2, 0.02, 16]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Plaza() {
  return (
    <group>
      <mesh material={MAT.plaza} receiveShadow position-y={0.025}>
        <cylinderGeometry args={[PLAZA_R, PLAZA_R, 0.05, 48]} />
      </mesh>
      {[2.6, 3.6, 4.6].map(r => (
        <mesh key={r} rotation-x={-Math.PI / 2} position-y={0.052}>
          <ringGeometry args={[r - 0.04, r, 64]} />
          <meshBasicMaterial color="#000" transparent opacity={0.07} />
        </mesh>
      ))}
    </group>
  );
}

function Farm() {
  const sim = useSim();
  const ref = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    for (let gx = 3.5; gx < 13; gx += 1.3)
      for (let gy = 20.5; gy < 27.5; gy += 1.2) if (Math.hypot(gx - 8, gy - 24) > 1.4) out.push(g2w(gx, gy));
    return out;
  }, []);
  useLayoutEffect(() => {
    const m = new Matrix4();
    spots.forEach((p, i) => ref.current!.setMatrixAt(i, m.makeTranslation(p.x, 0.36, p.z)));
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [spots]);
  useFrame(() => {
    const mat = sim.shortage > 0 ? MAT.cropDry : MAT.crop;
    if (ref.current && ref.current.material !== mat) ref.current.material = mat;
  });
  return (
    <group>
      <mesh material={MAT.soil} receiveShadow position={[(FARM.x0 + FARM.x1) / 2, 0.04, (FARM.z0 + FARM.z1) / 2]}>
        <boxGeometry args={[FARM.x1 - FARM.x0, 0.08, FARM.z1 - FARM.z0]} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, MAT.crop, spots.length]} castShadow>
        <coneGeometry args={[0.3, 0.62, 5]} />
      </instancedMesh>
    </group>
  );
}

function Pond() {
  const dx = DOCK.x - POND.x, dz = DOCK.z - POND.z, d = Math.hypot(dx, dz);
  const dir = { x: dx / d, z: dz / d };
  const dock = { x: POND.x + dir.x * (POND.r + 0.1), z: POND.z + dir.z * (POND.r + 0.1) };
  const pads = useMemo(() => {
    const rng = new Rng(3);
    return Array.from({ length: 6 }, () => {
      const a = rng.range(0, Math.PI * 2), r = rng.range(1.2, POND.r - 0.6);
      return { x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r, s: rng.range(0.25, 0.42) };
    });
  }, []);
  return (
    <group>
      <mesh material={MAT.sand} receiveShadow position={[POND.x, 0.02, POND.z]}>
        <cylinderGeometry args={[POND.r + 0.8, POND.r + 0.9, 0.04, 40]} />
      </mesh>
      <mesh material={MAT.water} receiveShadow position={[POND.x, 0.05, POND.z]}>
        <cylinderGeometry args={[POND.r, POND.r, 0.06, 40]} />
      </mesh>
      {pads.map((p, i) => (
        <mesh key={i} position={[p.x, 0.085, p.z]}>
          <cylinderGeometry args={[p.s, p.s, 0.015, 10]} />
          <meshStandardMaterial color="#5f9a3a" flatShading />
        </mesh>
      ))}
      <group position={[dock.x, 0, dock.z]} rotation-y={Math.atan2(-dir.x, -dir.z)}>
        <mesh material={MAT.wood} castShadow receiveShadow position={[0, 0.16, 0]}>
          <boxGeometry args={[DOCK.w, 0.1, DOCK.l]} />
        </mesh>
        {[-1, 1].map(s => (
          <mesh key={s} material={MAT.darkWood} position={[s * (DOCK.w / 2 - 0.05), 0.1, DOCK.l / 2 - 0.2]}>
            <cylinderGeometry args={[0.06, 0.06, 0.45, 6]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export default function Terrain() {
  const sides = useMemo(() => {
    const top = MAT.dirt.clone();
    top.color.set('#8fb36a');
    const bottom = MAT.dirt.clone();
    bottom.color.set('#5c452f');
    return [MAT.dirt, MAT.dirt, top, bottom, MAT.dirt, MAT.dirt];
  }, []);
  return (
    <group>
      <mesh material={sides} position={[0, -1.2, 0]} receiveShadow>
        <boxGeometry args={[62, 2.4, 42]} />
      </mesh>
      <GrassTop />
      <Paths />
      <Plaza />
      <Farm />
      <Pond />
    </group>
  );
}
