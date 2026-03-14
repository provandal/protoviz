import { create } from 'zustand';

const useViewerStore = create((set, get) => ({
  scenario: null,
  currentSlug: null,
  loading: false,
  error: null,
  step: 0,
  playing: false,
  playbackSpeed: 1800,
  activeBottomTab: 'explain',
  splitPosition: 55,
  poppedOut: false,
  chatMessages: [],
  chatApiKey: localStorage.getItem('protoviz_api_key') || '',
  chatModel: localStorage.getItem('protoviz_model') || 'claude-sonnet-4-6',

  setScenario: (scenario) => set({
    scenario,
    step: 0,
    playing: false,
    error: null,
    loading: false,
  }),

  goToStep: (idx) => {
    const { scenario } = get();
    if (!scenario) return;
    const max = scenario.timeline.length - 1;
    set({ step: Math.max(0, Math.min(max, idx)) });
  },

  nextStep: () => {
    const { step, scenario } = get();
    if (!scenario) return;
    if (step >= scenario.timeline.length - 1) {
      set({ playing: false });
    } else {
      set({ step: step + 1 });
    }
  },

  prevStep: () => {
    const { step } = get();
    if (step > 0) set({ step: step - 1 });
  },

  togglePlay: () => set(s => ({ playing: !s.playing })),
  setPlaying: (playing) => set({ playing }),
  setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),
  setSplitPosition: (pos) => set({ splitPosition: pos }),
  setPoppedOut: (val) => set({ poppedOut: val }),
  setChatMessages: (msgs) => set({ chatMessages: msgs }),
  setChatApiKey: (key) => {
    localStorage.setItem('protoviz_api_key', key);
    set({ chatApiKey: key });
  },
  setChatModel: (m) => {
    localStorage.setItem('protoviz_model', m);
    set({ chatModel: m });
  },
}));

export default useViewerStore;
