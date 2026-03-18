import { useEffect, useRef } from 'react';
import useViewerStore from '../store/viewerStore';

export default function usePlayback() {
  const playing = useViewerStore(s => s.playing);
  const playbackSpeed = useViewerStore(s => s.playbackSpeed);
  const walkthroughActive = useViewerStore(s => s.walkthroughActive);
  const intervalRef = useRef(null);

  // Disable auto-play when walkthrough is active
  useEffect(() => {
    if (walkthroughActive && playing) {
      useViewerStore.getState().setPlaying(false);
    }
  }, [walkthroughActive, playing]);

  useEffect(() => {
    if (playing && !walkthroughActive) {
      intervalRef.current = setInterval(() => {
        useViewerStore.getState().nextStep();
      }, playbackSpeed);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, playbackSpeed, walkthroughActive]);
}
