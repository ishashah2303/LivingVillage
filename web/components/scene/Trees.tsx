'use client';
import { useLayoutEffect, useRef } from 'react';
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { TREES } from '@/sim/layout';
import { MAT } from './materials';

const pines = TREES.filter(t => t.kind === 'pine');
const rounds = TREES.filter(t => t.kind === 'round');

/** Procedurally placed trees, drawn with instancing (one draw call per part). */
export default function Trees() {
  const trunks = useRef<InstancedMesh>(null);
  const pineLow = useRef<InstancedMesh>(null);
  const pineHigh = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3(), c = new Color();
    TREES.forEach((t, i) => {
      s.setScalar(t.s);
      m.compose(p.set(t.x, 0.6 * t.s, t.z), q.identity(), s);
      trunks.current!.setMatrixAt(i, m);
    });
    pines.forEach((t, i) => {
      s.setScalar(t.s);
      q.setFromAxisAngle(new Vector3(0, 1, 0), (i * 1.7) % 6.28);
      m.compose(p.set(t.x, 1.75 * t.s, t.z), q, s);
      pineLow.current!.setMatrixAt(i, m);
      m.compose(p.set(t.x, 2.7 * t.s, t.z), q, s.setScalar(t.s * 0.72));
      pineHigh.current!.setMatrixAt(i, m);
      c.set(t.color);
      pineLow.current!.setColorAt(i, c);
      pineHigh.current!.setColorAt(i, c.multiplyScalar(1.08));
    });
    rounds.forEach((t, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), (i * 2.3) % 6.28);
      m.compose(p.set(t.x, 2.1 * t.s, t.z), q, s.set(t.s * 1.05, t.s * 0.95, t.s * 1.05));
      crowns.current!.setMatrixAt(i, m);
      crowns.current!.setColorAt(i, c.set(t.color).multiplyScalar(1.1));
    });
    for (const r of [trunks, pineLow, pineHigh, crowns]) {
      r.current!.instanceMatrix.needsUpdate = true;
      if (r.current!.instanceColor) r.current!.instanceColor.needsUpdate = true;
    }
  }, []);

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, MAT.darkWood, TREES.length]} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 1.2, 6]} />
      </instancedMesh>
      <instancedMesh ref={pineLow} args={[undefined, MAT.foliage, pines.length]} castShadow receiveShadow>
        <coneGeometry args={[1.25, 1.9, 7]} />
      </instancedMesh>
      <instancedMesh ref={pineHigh} args={[undefined, MAT.foliage, pines.length]} castShadow>
        <coneGeometry args={[1.05, 1.6, 7]} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, MAT.foliage, rounds.length]} castShadow receiveShadow>
        <icosahedronGeometry args={[1.35, 0]} />
      </instancedMesh>
    </group>
  );
}
