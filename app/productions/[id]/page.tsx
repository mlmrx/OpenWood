import type { Metadata } from 'next';
import { ProductionWorkspace } from './production-workspace';

export const metadata: Metadata = {
  title: 'Production Board — OpenWood',
  description: 'A versioned micro-drama production board for story, script, shots, sound, cut, quality, and release.',
};

export default async function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductionWorkspace productionId={id} />;
}
