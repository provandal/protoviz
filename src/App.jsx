import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtoVizViewer from './components/viewer/ProtoVizViewer';
import PopoutView from './components/layout/PopoutView';
import Gallery from './components/gallery/Gallery';
import TroubleshooterPage from './components/troubleshooter/TroubleshooterPage';

const DEFAULT_SCENARIO = 'roce-v2-rc-connection-rdma-write-read';

// Detect if this window was opened as a popout
const isPopout = new URLSearchParams(window.location.search).get('popout') === 'bottom';

export default function App() {
  if (isPopout) {
    return <PopoutView />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Gallery />} />
        <Route path="/troubleshooter" element={<TroubleshooterPage />} />
        <Route path="/:scenarioSlug/step/:stepNum" element={<ProtoVizViewer />} />
        <Route path="/:scenarioSlug" element={<ProtoVizViewer />} />
      </Routes>
    </HashRouter>
  );
}
