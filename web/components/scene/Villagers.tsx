'use client';
import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { MeshStandardMaterial, type Group, type Mesh } from 'three';
import { labelLayer, useSim, useUI } from '../store';
import type { Villager as V } from '@/sim/agents';
import { HOUSES } from '@/sim/layout';
import { clamp, lerp } from '@/sim/math';
import { MAT } from './materials';

/**
 * Procedural animation driven by the simulation: the walk cycle advances with distance
 * walked (not time), so feet do not slide when DetourCrowd slows an agent down.
 */
function Villager({ v }: { v: V }) {
  const sim = useSim();
  const selected = useUI(s => s.selected === v.id);
  const tool = useUI(s => s.tool);
  const select = useUI(s => s.select);
  const root = useRef<Group>(null), body = useRef<Group>(null), head = useRef<Mesh>(null);
  const legL = useRef<Group>(null), legR = useRef<Group>(null), armL = useRef<Group>(null), armR = useRef<Group>(null);
  const prop = useRef<Group>(null), ring = useRef<Mesh>(null), bubble = useRef<HTMLDivElement>(null), hp = useRef<HTMLDivElement>(null);
  const water = useRef<Group>(null);
  const cloth = useMemo(() => new MeshStandardMaterial({ color: v.color, roughness: 0.85, flatShading: true }), [v.color]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + v.id * 1.7;
    const r = root.current!;
    r.visible = v.visible;
    if (!v.visible) return;
    const a = sim.alpha;
    const x = lerp(v.prev.x, v.pos.x, a), z = lerp(v.prev.z, v.pos.z, a);
    const moving = v.speed > 0.15;
    const phase = (v.stride / 0.85) * Math.PI;
    const amp = moving ? clamp(v.speed / 2.2, 0.35, 1.5) * 0.55 : 0;
    let y = 0, lean = 0, armLx = -Math.sin(phase) * amp * 0.9, armRx = Math.sin(phase) * amp * 0.9, armLz = 0, armRz = 0, spin = 0;
    let legLx = Math.sin(phase) * amp, legRx = -Math.sin(phase) * amp, headX = 0;
    if (moving) {
      y = Math.abs(Math.sin(phase)) * 0.06 * amp;
      lean = v.speed > 3 ? 0.18 : 0.04;
    } else {
      switch (v.act) {
        case 'work':
          if (v.role === 'fisher') { armRx = -1.1 + Math.sin(t * 1.5) * 0.08; armLx = -0.6; }
          else if (v.role === 'merchant') { armRx = -0.5 + Math.sin(t * 3) * 0.4; armLz = 0.3 + Math.sin(t * 2.2) * 0.2; }
          else { armRx = -1.5 + Math.abs(Math.sin(t * 2.6)) * 1.5; armLx = armRx * 0.8; lean = 0.15 + Math.abs(Math.sin(t * 2.6)) * 0.1; }
          break;
        case 'eat':
          armRx = -1.6 + Math.abs(Math.sin(t * 2)) * 1.1;
          break;
        case 'forage':
          lean = 0.55; armRx = -1.1 + Math.sin(t * 3) * 0.3; armLx = -1.0 - Math.sin(t * 3) * 0.3;
          break;
        case 'social':
          armRx = -0.35 + Math.sin(t * 2.4) * 0.3; headX = Math.sin(t * 1.7) * 0.12;
          break;
        case 'dance':
          y = Math.abs(Math.sin(t * 5)) * 0.28; spin = t * 1.6; armLz = 2.5 + Math.sin(t * 5) * 0.3; armRz = -2.5 - Math.sin(t * 5) * 0.3;
          legLx = Math.sin(t * 5) * 0.4; legRx = -legLx;
          break;
        case 'douse':
          armRx = armLx = -1.35 + Math.sin(t * 9) * 0.18; lean = 0.12;
          break;
        case 'shelter':
          armLz = 0.5; armRz = -0.5; armLx = armRx = -0.5; headX = 0.25;
          break;
        default:
          y = Math.sin(t * 1.5) * 0.008;
      }
    }
    r.position.set(x, y, z);
    r.rotation.y = v.heading + spin;
    body.current!.rotation.x = lean;
    legL.current!.rotation.x = legLx;
    legR.current!.rotation.x = legRx;
    armL.current!.rotation.set(armLx, 0, armLz);
    armR.current!.rotation.set(armRx, 0, armRz);
    head.current!.rotation.x = headX;
    if (prop.current) prop.current.visible = v.role === 'guard' ? v.act !== 'douse' : v.act === 'work' && !moving;
    if (water.current) {
      water.current.visible = v.act === 'douse' && !moving;
      water.current.children.forEach((c, k) => {
        const p = (t * 1.6 + k / 6) % 1;
        c.position.set(Math.sin(k * 2.3) * 0.25, 1.2 + Math.sin(p * Math.PI) * 0.9, 0.5 + p * 2.6);
      });
    }
    if (ring.current) {
      ring.current.visible = selected;
      ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.06);
    }
    if (hp.current) {
      // Fire Season: a health bar under the name once smoke has hurt someone.
      const show = sim.rules.harm && v.health < 99;
      hp.current.style.display = show ? 'block' : 'none';
      if (show) (hp.current.firstChild as HTMLElement).style.width = `${v.health}%`;
      hp.current.classList.toggle('low', v.health < 35);
    }
    if (bubble.current) {
      const show = v.sayT > 0;
      bubble.current.style.display = show ? 'block' : 'none';
      if (show && bubble.current.textContent !== v.say) bubble.current.textContent = v.say;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    select(v.id);
  };

  return (
    <group ref={root} onClick={onClick} onPointerOver={() => (document.body.style.cursor = tool === 'select' ? 'pointer' : '')} onPointerOut={() => (document.body.style.cursor = '')}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.06} visible={false}>
        <ringGeometry args={[0.55, 0.72, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
      </mesh>
      <group ref={body}>
        {[[-0.12, legL], [0.12, legR]].map(([x, ref], i) => (
          <group key={i} ref={ref as React.RefObject<Group>} position={[x as number, 0.72, 0]}>
            <mesh material={MAT.pants} castShadow position-y={-0.34}>
              <cylinderGeometry args={[0.085, 0.075, 0.68, 6]} />
            </mesh>
          </group>
        ))}
        <mesh material={cloth} castShadow position-y={1.08}>
          <cylinderGeometry args={[0.23, 0.3, 0.72, 8]} />
        </mesh>
        <mesh material={MAT.darkWood} position-y={0.8}>
          <cylinderGeometry args={[0.305, 0.305, 0.06, 8]} />
        </mesh>
        <group ref={armL} position={[-0.31, 1.38, 0]}>
          <mesh material={cloth} position-y={-0.28}>
            <cylinderGeometry args={[0.065, 0.06, 0.56, 6]} />
          </mesh>
          <mesh material={MAT.skin} position-y={-0.6}>
            <sphereGeometry args={[0.07, 8, 6]} />
          </mesh>
        </group>
        <group ref={armR} position={[0.31, 1.38, 0]}>
          <mesh material={cloth} position-y={-0.28}>
            <cylinderGeometry args={[0.065, 0.06, 0.56, 6]} />
          </mesh>
          <mesh material={MAT.skin} position-y={-0.6}>
            <sphereGeometry args={[0.07, 8, 6]} />
          </mesh>
          <group ref={prop} position={[0, -0.6, 0]} visible={false}>
            <RoleProp role={v.role} />
          </group>
        </group>
        <mesh ref={head} material={MAT.skin} castShadow position-y={1.64}>
          <sphereGeometry args={[0.2, 12, 10]} />
        </mesh>
        {[-0.07, 0.07].map(x => (
          <mesh key={x} position={[x, 1.68, 0.18]}>
            <sphereGeometry args={[0.025, 6, 4]} />
            <meshBasicMaterial color="#2a211b" />
          </mesh>
        ))}
        <Hat role={v.role} />
      </group>
      {v.role === 'guard' && (
        <group ref={water} visible={false}>
          {Array.from({ length: 6 }, (_, k) => (
            <mesh key={k}>
              <sphereGeometry args={[0.07, 6, 4]} />
              <meshBasicMaterial color="#8fd0ff" />
            </mesh>
          ))}
        </group>
      )}
      <Html position={[0, 2.2, 0]} center zIndexRange={[20, 0]} portal={labelLayer}>
        <div className={`tag${selected ? ' sel' : ''}`}>
          <div ref={bubble} className="bubble" />
          <div className="name">{v.name}</div>
          <div ref={hp} className="hp" style={{ display: 'none' }}><i /></div>
        </div>
      </Html>
    </group>
  );
}

function Hat({ role }: { role: V['role'] }) {
  switch (role) {
    case 'farmer':
      return (
        <group position-y={1.8}>
          <mesh material={MAT.straw} castShadow>
            <cylinderGeometry args={[0.38, 0.38, 0.03, 14]} />
          </mesh>
          <mesh material={MAT.straw} position-y={0.08}>
            <cylinderGeometry args={[0.16, 0.2, 0.16, 10]} />
          </mesh>
        </group>
      );
    case 'guard':
      return (
        <mesh material={MAT.metal} position-y={1.7}>
          <sphereGeometry args={[0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      );
    case 'merchant':
      return (
        <mesh position-y={1.84}>
          <cylinderGeometry args={[0.17, 0.2, 0.15, 10]} />
          <meshStandardMaterial color="#7a2e3a" flatShading />
        </mesh>
      );
    case 'fisher':
      return (
        <mesh position-y={1.81}>
          <cylinderGeometry args={[0.19, 0.3, 0.14, 12]} />
          <meshStandardMaterial color="#d9b44a" flatShading />
        </mesh>
      );
    case 'woodcutter':
      return (
        <mesh position-y={1.72}>
          <sphereGeometry args={[0.215, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#b3412e" flatShading />
        </mesh>
      );
    default:
      return (
        <mesh material={MAT.darkWood} position={[0, 1.8, -0.12]}>
          <sphereGeometry args={[0.11, 8, 6]} />
        </mesh>
      );
  }
}

function RoleProp({ role }: { role: V['role'] }) {
  switch (role) {
    case 'guard':
      return (
        <group rotation-x={Math.PI / 2}>
          <mesh material={MAT.darkWood} position-y={0.1}>
            <cylinderGeometry args={[0.025, 0.025, 1.9, 5]} />
          </mesh>
          <mesh material={MAT.metal} position-y={1.1}>
            <coneGeometry args={[0.06, 0.22, 5]} />
          </mesh>
        </group>
      );
    case 'woodcutter':
      return (
        <group rotation-x={Math.PI / 2}>
          <mesh material={MAT.wood} position-y={0.3}>
            <cylinderGeometry args={[0.025, 0.025, 0.75, 5]} />
          </mesh>
          <mesh material={MAT.metal} position={[0.08, 0.62, 0]}>
            <boxGeometry args={[0.18, 0.14, 0.03]} />
          </mesh>
        </group>
      );
    case 'farmer':
      return (
        <group rotation-x={Math.PI / 2}>
          <mesh material={MAT.wood} position-y={0.4}>
            <cylinderGeometry args={[0.022, 0.022, 1.1, 5]} />
          </mesh>
          <mesh material={MAT.metal} position={[0, 0.95, 0.07]}>
            <boxGeometry args={[0.2, 0.04, 0.16]} />
          </mesh>
        </group>
      );
    case 'fisher':
      return (
        <mesh material={MAT.darkWood} rotation-x={1.1} position={[0, 0, 0.7]}>
          <cylinderGeometry args={[0.012, 0.018, 1.8, 4]} />
        </mesh>
      );
    default:
      return null;
  }
}

/** "z z" above houses where someone is asleep. */
function Sleepers() {
  const sim = useSim();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useFrame(({ clock }) => {
    HOUSES.forEach((h, i) => {
      const el = refs.current[i];
      if (!el) return;
      const asleep = sim.villagers.some(v => !v.visible && v.home === h.i && v.act === 'sleep');
      el.style.display = asleep ? 'block' : 'none';
      el.style.transform = `translateY(${Math.sin(clock.elapsedTime * 2 + i) * 4}px)`;
    });
  });
  return (
    <>
      {HOUSES.map((h, i) => (
        <Html key={h.i} position={[h.x + 1.3, 4.6, h.z]} center zIndexRange={[10, 0]} portal={labelLayer}>
          <div ref={el => { refs.current[i] = el; }} className="zz" style={{ display: 'none' }}>z z</div>
        </Html>
      ))}
    </>
  );
}

export default function Villagers() {
  const sim = useSim();
  return (
    <group>
      {sim.villagers.map(v => <Villager key={v.id} v={v} />)}
      <Sleepers />
    </group>
  );
}
