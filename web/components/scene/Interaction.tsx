'use client';
import { OrbitControls } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import { Vector3, type Mesh, type MeshBasicMaterial } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useSim, useUI, type Tool } from '../store';
import { dist } from '@/sim/math';
import { FIRE } from '@/sim/simulation';

const hover = { x: 0, z: 0, active: false };
const TOOL_RADIUS: Record<Tool, number> = { select: 0.6, fire: FIRE.blockRadius, rock: 1.25, well: 1.1, food: 0.5, erase: 2.5 };
const TOOL_COLOR: Record<Tool, string> = { select: '#ffffff', fire: '#ff7a1f', rock: '#d6d3c8', well: '#8fd0ff', food: '#f0c24b', erase: '#ff4d6d' };

/** Invisible ground plane that turns clicks into world edits. */
export function Ground() {
  const sim = useSim();
  const tool = useUI(s => s.tool);
  const select = useUI(s => s.select);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // it was a camera drag
    const p = { x: e.point.x, z: e.point.z };
    switch (tool) {
      case 'select': {
        let best = null, bd = 1.6;
        for (const v of sim.villagers) if (v.visible && dist(v.pos, p) < bd) { bd = dist(v.pos, p); best = v; }
        if (best) select(best.id);
        break;
      }
      case 'fire': sim.startFire(p); break;
      case 'rock': sim.addRock(p); break;
      case 'well': sim.addWell(p); break;
      case 'food': sim.dropFood(p); break;
      case 'erase': sim.removeNear(p); break;
    }
  };

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position-y={0.06}
      onClick={onClick}
      onPointerMove={e => Object.assign(hover, { x: e.point.x, z: e.point.z, active: true })}
      onPointerOut={() => (hover.active = false)}
    >
      <planeGeometry args={[60, 40]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/** Placement preview: a ring sized like the obstacle, red where it cannot go. */
export function Cursor() {
  const sim = useSim();
  const tool = useUI(s => s.tool);
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const m = ref.current!;
    m.visible = hover.active && tool !== 'select';
    if (!m.visible) return;
    m.position.set(hover.x, 0.12, hover.z);
    m.scale.setScalar(TOOL_RADIUS[tool]);
    const ok = tool === 'erase' || sim.canPlace(hover);
    (m.material as MeshBasicMaterial).color.set(ok ? TOOL_COLOR[tool] : '#ff2a2a');
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[0.9, 1, 48]} />
      <meshBasicMaterial transparent opacity={0.9} />
    </mesh>
  );
}

/** Orbit camera; optionally follows the selected villager. */
export function CameraRig() {
  const sim = useSim();
  const controls = useRef<OrbitControlsImpl>(null);
  const target = useRef(new Vector3());
  useFrame(() => {
    const { follow, selected } = useUI.getState();
    const v = selected == null ? null : sim.villagers[selected];
    const c = controls.current;
    if (!c || !follow || !v?.visible) return;
    target.current.set(v.pos.x, 0, v.pos.z);
    const delta = target.current.clone().sub(c.target).multiplyScalar(0.08);
    c.target.add(delta);
    c.object.position.add(delta);
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 1.5]}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={1.3}
      minDistance={8}
      maxDistance={110}
    />
  );
}
