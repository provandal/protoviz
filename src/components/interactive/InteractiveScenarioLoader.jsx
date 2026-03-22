import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';

const scenarioMap = {
  'hello-world-chat': lazy(() => import('./hello-world-chat/HelloWorldChat')),
};

export default function InteractiveScenarioLoader() {
  const { slug } = useParams();
  const Component = scenarioMap[slug];

  if (!Component) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#020817', color: '#64748b',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      }}>
        Interactive scenario not found: {slug}
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="pvz-loading">Loading...</div>}>
      <Component />
    </Suspense>
  );
}
