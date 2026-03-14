import { useEffect } from 'react';
import useViewerStore from '../store/viewerStore';

export default function useKeyboardNav() {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't capture when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }

      const state = useViewerStore.getState();

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          state.nextStep();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          state.prevStep();
          break;
        case ' ':
          e.preventDefault();
          state.togglePlay();
          break;
        case 'Home':
          e.preventDefault();
          state.goToStep(0);
          break;
        case 'End':
          e.preventDefault();
          if (state.scenario) {
            state.goToStep(state.scenario.timeline.length - 1);
          }
          break;
        case '1':
          state.setActiveBottomTab('explain');
          break;
        case '2':
          state.setActiveBottomTab('inspect');
          break;
        case '3':
          state.setActiveBottomTab('chat');
          break;
        case '4':
          state.setActiveBottomTab('about');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
