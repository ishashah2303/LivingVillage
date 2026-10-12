'use client';
import dynamic from 'next/dynamic';

// WebGL + WebAssembly only exist in the browser, so the whole app skips server rendering.
const VillageApp = dynamic(() => import('./VillageApp'), {
  ssr: false,
  loading: () => <div className="boot">Loading Living Village…</div>,
});

export default function ClientRoot() {
  return <VillageApp />;
}
