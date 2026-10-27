import { BufferGeometry, CanvasTexture, Float32BufferAttribute, MeshStandardMaterial, SRGBColorSpace } from 'three';

const std = (color: string, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
  new MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });

/** Shared materials. `window` and `lantern` glow at night (DayNight animates their emissive intensity). */
const shared = new Map<string, MeshStandardMaterial>();

/**
 * One material per (base, color): meshes that look alike share a material, so StaticMerge can batch
 * them into one draw call (per-mesh clones defeat that).
 */
export function tinted(base: MeshStandardMaterial, color: string) {
  const key = `${base.uuid}|${color}`;
  let m = shared.get(key);
  if (!m) shared.set(key, (m = base.clone())), m.color.set(color);
  return m;
}

/** A shared flat-shaded material in `color` (produce, lily pads). */
export function flat(color: string) {
  const key = `flat|${color}`;
  let m = shared.get(key);
  if (!m) shared.set(key, (m = new MeshStandardMaterial({ color, flatShading: true })));
  return m;
}

export const MAT = {
  window: std('#46443c', { emissive: '#ffc873', emissiveIntensity: 0 }),
  lantern: std('#fff2cc', { emissive: '#ffb347', emissiveIntensity: 0.4 }),
  door: std('#6b4a30'),
  wood: std('#8a6440'),
  darkWood: std('#5e4029'),
  stone: std('#a19b8d'),
  darkStone: std('#7d776b'),
  water: new MeshStandardMaterial({ color: '#4f93ad', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.94 }),
  skin: std('#e5b995', { roughness: 0.8 }),
  pants: std('#4a4f5a'),
  dirt: std('#8a6a47'),
  soil: std('#7c5c3b'),
  path: std('#d8c596', { roughness: 1 }),
  plaza: std('#d2c9b6', { roughness: 1 }),
  sand: std('#dccf9f', { roughness: 1 }),
  metal: std('#a7adb5', { roughness: 0.4, metalness: 0.6 }),
  straw: std('#e3c373'),
  crop: std('#5f9a3a'),
  cropDry: std('#a39346'),
  leaf: std('#4d8a44'),
  /** White base so per-instance colors show as-is. */
  foliage: std('#ffffff'),
  barn: std('#9b3f32'),
  barnRoof: std('#6e2e25'),
  white: std('#f3efe6'),
};

/** Gable roof with the ridge along x: two slopes facing +/-z and two triangular gable ends. */
export function gableRoof(w: number, d: number, h: number, overhang = 0.3) {
  const x = w / 2 + overhang, z = d / 2 + overhang;
  const v = [
    // slope facing +z
    -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0,
    // slope facing -z
    x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0,
    // gable +x
    x, 0, z, x, 0, -z, x, h, 0,
    // gable -x
    -x, 0, -z, -x, 0, z, -x, h, 0,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Small round sign with a number on it (house numbers match the 2D mockup). */
export function numberTexture(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f1e3';
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b2f25';
  g.font = '700 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 32, 35);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Soft radial gradient used for glow sprites (fire halo, lanterns). */
const glows = new Map<string, CanvasTexture>();

/** Radial glow sprite texture. Cached: every fire used to build (and upload) its own copies. */
export function glowTexture(inner = 'rgba(255,190,90,1)', outer = 'rgba(255,120,30,0)') {
  const key = `${inner}|${outer}`;
  const hit = glows.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner.replace(/,\s*1\)$/, ',0.55)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  glows.set(key, t);
  return t;
}
