'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BufferGeometry, ConeGeometry, DoubleSide, Euler, Float32BufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { useSim } from '../store';
import { BOIDS } from '@/sim/boids';
import { lerp } from '@/sim/math';

function wingGeometry(side: 1 | -1) {
  const g = new BufferGeometry();
  // hinge along the body (z axis), tip out to the side
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0.14, 0, 0, -0.16, side * 0.62, 0, -0.08], 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The flock drawn as three instanced meshes (body + two flapping wings). Instances are allocated
 * for the stress-test maximum once; `count` limits drawing to the live birds.
 */
export default function Birds() {
  const sim = useSim();
  const n = BOIDS.maxCount;
  const body = useRef<InstancedMesh>(null), wl = useRef<InstancedMesh>(null), wr = useRef<InstancedMesh>(null);
  const geo = useMemo(() => {
    const b = new ConeGeometry(0.09, 0.42, 5);
    b.rotateX(Math.PI / 2); // point forward along +z
    return { body: b, left: wingGeometry(1), right: wingGeometry(-1) };
  }, []);
  const mat = useMemo(() => new MeshStandardMaterial({ color: '#2f3a40', roughness: 0.8, side: DoubleSide, flatShading: true }), []);
  const tmp = useMemo(() => ({ m: new Matrix4(), w: new Matrix4(), q: new Quaternion(), e: new Euler(0, 0, 0, 'YXZ'), p: new Vector3(), s: new Vector3(1, 1, 1), f: new Quaternion(), qw: new Quaternion(), z: new Vector3(0, 0, 1) }), []);

  useFrame(() => {
    const a = sim.alpha, { m, w, q, e, p, s, f, qw, z } = tmp;
    const birds = sim.flock.birds;
    birds.forEach((b, i) => {
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      e.set(-Math.asin(b.vy / sp), Math.atan2(b.vx, b.vz), 0);
      q.setFromEuler(e);
      p.set(lerp(b.px, b.x, a), lerp(b.py, b.y, a), lerp(b.pz, b.z, a));
      m.compose(p, q, s);
      body.current!.setMatrixAt(i, m);
      const flap = Math.sin(b.flap) * 0.85;
      w.compose(p, qw.copy(q).multiply(f.setFromAxisAngle(z, flap)), s);
      wl.current!.setMatrixAt(i, w);
      w.compose(p, qw.copy(q).multiply(f.setFromAxisAngle(z, -flap)), s);
      wr.current!.setMatrixAt(i, w);
    });
    for (const r of [body, wl, wr]) {
      r.current!.count = birds.length;
      r.current!.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={body} args={[geo.body, mat, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={wl} args={[geo.left, mat, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={wr} args={[geo.right, mat, n]} castShadow frustumCulled={false} />
    </group>
  );
}
