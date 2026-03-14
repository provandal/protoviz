import { useEffect, useRef } from 'react';
import useViewerStore from '../store/viewerStore';

export default function usePlayback() {
  const playing = useViewerStore(s => s.playing);
  const playbackSpeed = useViewerStore(s => s.playbackSpeed);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        useViewerStore.getState().nextStep();
      }, playbackSpeed);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, playbackSpeed]);
}
