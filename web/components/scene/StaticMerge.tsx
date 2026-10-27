'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Matrix4, Mesh, type BufferGeometry, type Group, type InstancedMesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Bakes a static subtree into one mesh per material (and shadow flags) once it has mounted, and hides
 * the originals. Every mesh is a draw call, twice when it casts a shadow, and on integrated graphics
 * the per-call overhead, not the triangle count, was what capped the frame rate (the buildings and
 * terrain alone were 161 calls for a few thousand triangles).
 *
 * Objects tagged `userData={{ dynamic: true }}` (with their children) and instanced meshes are left
 * alone, so anything animated keeps working.
 */
export default function StaticMerge({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null);
  useLayoutEffect(() => {
    const root = ref.current!;
    root.updateWorldMatrix(true, true);
    const toRoot = root.matrixWorld.clone().invert();
    const buckets = new Map<string, { material: Material; cast: boolean; receive: boolean; parts: BufferGeometry[]; sources: Mesh[] }>();

    const visit = (o: Object3D) => {
      if (o.userData.dynamic || !o.visible) return;
      const m = o as Mesh;
      if (m.isMesh && !(m as InstancedMesh).isInstancedMesh && !Array.isArray(m.material)) {
        const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { material: m.material, cast: m.castShadow, receive: m.receiveShadow, parts: [], sources: [] }));
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
        b.parts.push(g);
        b.sources.push(m);
      }
      o.children.forEach(visit);
    };
    root.children.forEach(visit);

    const merged: Mesh[] = [];
    const hidden: Mesh[] = [];
    for (const b of buckets.values()) {
      if (b.parts.length < 2) {
        b.parts.forEach(g => g.dispose());
        continue;
      }
      // Geometries can only be merged on the attributes they all have (some custom ones lack uvs).
      const names = Object.keys(b.parts[0].attributes).filter(n => b.parts.every(g => g.attributes[n]));
      for (const g of b.parts) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
      const geo = mergeGeometries(b.parts, false);
      b.parts.forEach(g => g.dispose());
      if (!geo) continue;
      const mesh = new Mesh(geo, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      merged.push(mesh);
      for (const s of b.sources) (s.visible = false), hidden.push(s);
    }
    return () => {
      for (const m of merged) root.remove(m), m.geometry.dispose();
      for (const s of hidden) s.visible = true;
    };
  }, []);
  return <group ref={ref}>{children}</group>;
}
