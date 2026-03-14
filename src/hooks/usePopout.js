import { useRef, useEffect, useCallback } from 'react';
import useViewerStore from '../store/viewerStore';

const CHANNEL = 'protoviz-detail-panel';

/**
 * Main window hook — opens and communicates with the popout window.
 */
export function usePopout() {
  const channelRef = useRef(null);
  const popoutRef = useRef(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL);

    channelRef.current.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'popout_closed') {
        useViewerStore.getState().setPoppedOut(false);
        popoutRef.current = null;
      } else if (msg.type === 'request_data') {
        const state = useViewerStore.getState();
        if (state.scenario) {
          channelRef.current.postMessage({
            type: 'init',
            scenario: state.scenario,
            step: state.step,
            activeBottomTab: state.activeBottomTab,
            chatMessages: state.chatMessages,
          });
        }
      }
    };

    return () => channelRef.current?.close();
  }, []);

  // Forward step, tab, and chat changes to popout
  useEffect(() => {
    const unsubscribe = useViewerStore.subscribe((state, prev) => {
      if (!channelRef.current) return;
      if (state.step !== prev.step) {
        channelRef.current.postMessage({ type: 'step_change', step: state.step });
      }
      if (state.activeBottomTab !== prev.activeBottomTab) {
        channelRef.current.postMessage({ type: 'tab_change', tab: state.activeBottomTab });
      }
      if (state.chatMessages !== prev.chatMessages) {
        channelRef.current.postMessage({ type: 'chat_sync', chatMessages: state.chatMessages });
      }
    });
    return unsubscribe;
  }, []);

  const handlePopout = useCallback(() => {
    if (popoutRef.current && !popoutRef.current.closed) {
      popoutRef.current.focus();
      return;
    }

    const base = import.meta.env.BASE_URL || '/';
    const url = `${window.location.origin}${base}?popout=bottom`;
    popoutRef.current = window.open(url, 'protoviz-detail', 'width=900,height=550');
    useViewerStore.getState().setPoppedOut(true);

    setTimeout(() => {
      const state = useViewerStore.getState();
      channelRef.current?.postMessage({
        type: 'init',
        scenario: state.scenario,
        step: state.step,
        activeBottomTab: state.activeBottomTab,
        chatMessages: state.chatMessages,
      });
    }, 800);
  }, []);

  const focusPopout = useCallback(() => {
    if (popoutRef.current && !popoutRef.current.closed) {
      popoutRef.current.focus();
    }
  }, []);

  return { handlePopout, focusPopout };
}

/**
 * Popout window hook — receives state from the main window.
 */
export function usePopoutReceiver() {
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);

    channel.onmessage = (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'init':
          if (msg.scenario) {
            useViewerStore.getState().setScenario(msg.scenario);
            useViewerStore.setState({ step: msg.step || 0 });
            if (msg.activeBottomTab) {
              useViewerStore.setState({ activeBottomTab: msg.activeBottomTab });
            }
            if (msg.chatMessages) {
              useViewerStore.setState({ chatMessages: msg.chatMessages });
            }
          }
          break;
        case 'step_change':
          useViewerStore.setState({ step: msg.step });
          break;
        case 'tab_change':
          useViewerStore.setState({ activeBottomTab: msg.tab });
          break;
        case 'chat_sync':
          useViewerStore.setState({ chatMessages: msg.chatMessages });
          break;
      }
    };

    channel.postMessage({ type: 'request_data' });

    const handleUnload = () => {
      channel.postMessage({ type: 'popout_closed' });
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      channel.close();
    };
  }, []);
}
