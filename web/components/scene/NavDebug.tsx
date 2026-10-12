'use client';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { NavMeshHelper, TileCacheHelper } from '@recast-navigation/three';
import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial } from 'three';
import { useSim, useTick, useUI } from '../store';
import { PERCEPTION } from '@/sim/simulation';

/** The live Recast/Detour navmesh; re-extracted whenever TileCache rebuilds tiles. */
function NavMeshOverlay() {
  const sim = useSim();
  const helper = useMemo(() => {
    const h = new NavMeshHelper(sim.nav.navMesh, { navMeshMaterial: new MeshBasicMaterial({ color: '#12b89a', transparent: true, opacity: 0.34, depthWrite: false }) });
    // Polygon edges share the helper's geometry, which it rewrites in place on every update.
    h.add(new Mesh(h.navMeshGeometry, new MeshBasicMaterial({ color: '#06735e', wireframe: true, transparent: true, opacity: 0.55 })));
    return h;
  }, [sim]);
  const rev = useRef(sim.nav.revision);
  useFrame(() => {
    if (rev.current !== sim.nav.revision) {
      rev.current = sim.nav.revision;
      helper.update();
    }
  });
  useEffect(() => void helper.update(), [helper]);
  return <primitive object={helper} position-y={-0.12} />;
}

function ObstacleOverlay() {
  const sim = useSim();
  const helper = useMemo(
    () => new TileCacheHelper(sim.nav.tileCache, { obstacleMaterial: new MeshBasicMaterial({ color: '#ff4d6d', wireframe: true, transparent: true, opacity: 0.35 }) }),
    [sim],
  );
  const rev = useRef(-1);
  useFrame(() => {
    if (rev.current !== sim.nav.revision) {
      rev.current = sim.nav.revision;
      helper.update();
    }
  });
  return <primitive object={helper} />;
}

const MAX_SEGMENTS = 256;

/** DetourCrowd corridors: each walking villager's next corners, in its own color. */
function Corridors() {
  const sim = useSim();
  const obj = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3));
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3));
    return new LineSegments(g, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  }, []);
  const c = useMemo(() => new Color(), []);
  useFrame(() => {
    const pos = obj.geometry.getAttribute('position') as Float32BufferAttribute, col = obj.geometry.getAttribute('color') as Float32BufferAttribute;
    let n = 0;
    for (const v of sim.villagers) {
      if (!v.visible || !v.agent || v.act !== 'walk') continue;
      c.set(v.color);
      let prev = { x: v.pos.x, z: v.pos.z };
      for (const p of v.agent.corners()) {
        if (n >= MAX_SEGMENTS) break;
        pos.setXYZ(n * 2, prev.x, 0.15, prev.z);
        pos.setXYZ(n * 2 + 1, p.x, 0.15, p.z);
        col.setXYZ(n * 2, c.r, c.g, c.b);
        col.setXYZ(n * 2 + 1, c.r, c.g, c.b);
        prev = p;
        n++;
      }
    }
    obj.geometry.setDrawRange(0, n * 2);
    pos.needsUpdate = col.needsUpdate = true;
  });
  return <primitive object={obj} frustumCulled={false} />;
}

/** Full route of the selected villager, recomputed a few times per second. */
function SelectedRoute() {
  const sim = useSim();
  const id = useUI(s => s.selected);
  useTick(4);
  const v = id == null ? null : sim.villagers[id];
  if (!v?.visible || !v.target || v.act !== 'walk') return null;
  const path = sim.nav.path(v.pos, v.target, 3);
  if (!path || path.length < 2) return null;
  return (
    <group>
      <Line points={path.map(p => [p.x, 0.2, p.z] as [number, number, number])} color={v.color} lineWidth={3.5} dashed dashSize={0.6} gapSize={0.35} />
      <mesh position={[v.target.x, 0.08, v.target.z]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.3, 0.5, 24]} />
        <meshBasicMaterial color={v.color} />
      </mesh>
    </group>
  );
}

function PerceptionRing() {
  const sim = useSim();
  const id = useUI(s => s.selected);
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const v = id == null ? null : sim.villagers[id];
    if (!ref.current) return;
    ref.current.visible = !!v?.visible;
    if (v) ref.current.position.set(v.pos.x, 0.1, v.pos.z);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[PERCEPTION - 0.08, PERCEPTION, 96]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
    </mesh>
  );
}

export default function NavDebug() {
  const overlays = useUI(s => s.overlays);
  return (
    <>
      {overlays.navmesh && <NavMeshOverlay />}
      {overlays.obstacles && <ObstacleOverlay />}
      {overlays.paths && <Corridors />}
      {overlays.paths && <SelectedRoute />}
      {overlays.perception && <PerceptionRing />}
    </>
  );
}
