import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import ProtoVizViewer from './components/viewer/ProtoVizViewer';
import PopoutView from './components/layout/PopoutView';
import Gallery from './components/gallery/Gallery';
import TroubleshooterPage from './components/troubleshooter/TroubleshooterPage';
import ScenarioCreator from './components/creator/ScenarioCreator';

const DEFAULT_SCENARIO = 'roce-v2-rc-connection-rdma-write-read';

/** Track SPA route changes in GoatCounter */
function AnalyticsTracker() {
  const location = useLocation();
  useEffect(() => {
    if (window.goatcounter?.count) {
      window.goatcounter.count({ path: location.pathname + location.search });
    }
  }, [location]);
  return null;
}

// Detect if this window was opened as a popout
const isPopout = new URLSearchParams(window.location.search).get('popout') === 'bottom';

export default function App() {
  if (isPopout) {
    return <PopoutView />;
  }

  return (
    <HashRouter>
      <AnalyticsTracker />
      <Routes>
        <Route path="/" element={<Gallery />} />
        <Route path="/troubleshooter" element={<TroubleshooterPage />} />
        <Route path="/create" element={<ScenarioCreator />} />
        <Route path="/:scenarioSlug/step/:stepNum" element={<ProtoVizViewer />} />
        <Route path="/:scenarioSlug" element={<ProtoVizViewer />} />
      </Routes>
    </HashRouter>
  );
}
