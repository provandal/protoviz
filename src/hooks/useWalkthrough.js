import useViewerStore from '../store/viewerStore';

/**
 * Hook for managing guided walkthrough state.
 * Provides narration, navigation, progress, and highlight info.
 */
export default function useWalkthrough() {
  const scenario = useViewerStore(s => s.scenario);
  const walkthroughActive = useViewerStore(s => s.walkthroughActive);
  const walkthroughId = useViewerStore(s => s.walkthroughId);
  const walkthroughStepIndex = useViewerStore(s => s.walkthroughStepIndex);
  const highlightFields = useViewerStore(s => s.highlightFields);
  const startWalkthrough = useViewerStore(s => s.startWalkthrough);
  const exitWalkthrough = useViewerStore(s => s.exitWalkthrough);
  const nextWalkthroughStep = useViewerStore(s => s.nextWalkthroughStep);
  const prevWalkthroughStep = useViewerStore(s => s.prevWalkthroughStep);

  const walkthroughs = scenario?.walkthroughs || [];
  const hasWalkthroughs = walkthroughs.length > 0;

  // Get current walkthrough object
  const currentWalkthrough = walkthroughActive
    ? walkthroughs.find(w => w.id === walkthroughId) || null
    : null;

  // Get current narration text
  const currentNarration = currentWalkthrough
    ? (currentWalkthrough.steps[walkthroughStepIndex]?.narration || '')
    : '';

  // Progress info
  const walkthroughProgress = currentWalkthrough
    ? { current: walkthroughStepIndex + 1, total: currentWalkthrough.steps.length }
    : { current: 0, total: 0 };

  return {
    // State
    isWalkthroughActive: walkthroughActive,
    currentNarration,
    highlightFields,
    walkthroughProgress,
    hasWalkthroughs,
    walkthroughs,
    currentWalkthrough,

    // Actions
    startWalkthrough,
    exitWalkthrough,
    nextWalkthroughStep,
    prevWalkthroughStep,
  };
}
