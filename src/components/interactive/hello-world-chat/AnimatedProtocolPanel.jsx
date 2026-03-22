import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useChatStore from '../../../store/chatStore';
import ProtocolPanel from './ProtocolPanel';
import BitstreamDisplay from './BitstreamDisplay';

const LAYER_ORDER_DOWN = [7, 6, 4, 3, 2, 1]; // encapsulation: L7→L1
const LAYER_ORDER_UP = [1, 2, 3, 4, 6, 7];   // decapsulation: L1→L7
const LAYER_DELAY = 600; // ms per layer

export default function AnimatedProtocolPanel() {
  const { t } = useTranslation();
  const animationPhase = useChatStore(s => s.animationPhase);
  const animationLayer = useChatStore(s => s.animationLayer);
  const animationDirection = useChatStore(s => s.animationDirection);
  const currentPacket = useChatStore(s => s.currentPacket);
  const {
    setAnimationPhase, setAnimationLayer, setAnimationDirection, resetAnimation,
  } = useChatStore();

  const timerRef = useRef(null);
  const pausedRef = useRef(false);
  const layerIndexRef = useRef(0);

  const animating = animationPhase !== 'idle';

  // Run layer-by-layer animation sequence
  useEffect(() => {
    if (animationPhase !== 'encapsulating' && animationPhase !== 'decapsulating') return;

    const order = animationDirection === 'down' ? LAYER_ORDER_DOWN : LAYER_ORDER_UP;
    const startIdx = order.indexOf(animationLayer);
    if (startIdx === -1) return;

    layerIndexRef.current = startIdx;

    const advance = () => {
      if (pausedRef.current) return;
      const nextIdx = layerIndexRef.current + 1;
      if (nextIdx >= order.length) {
        // Animation complete — show bitstream briefly if sending
        if (animationDirection === 'down') {
          setAnimationPhase('transmitting');
          setAnimationLayer(1);
        } else {
          resetAnimation();
        }
        return;
      }
      layerIndexRef.current = nextIdx;
      setAnimationLayer(order[nextIdx]);
      timerRef.current = setTimeout(advance, LAYER_DELAY);
    };

    timerRef.current = setTimeout(advance, LAYER_DELAY);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [animationPhase, animationDirection]);

  // Transmitting phase: scroll bitstream for 2s then stop
  // Only auto-reset for sender (down direction). Receiver's transition is managed by LiveChatPanel.
  useEffect(() => {
    if (animationPhase !== 'transmitting') return;
    if (animationDirection === 'up') return; // receiver — LiveChatPanel handles transition
    const timer = setTimeout(() => {
      resetAnimation();
    }, 2000);
    return () => clearTimeout(timer);
  }, [animationPhase, animationDirection, resetAnimation]);

  const handlePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
  }, []);

  const handleStep = useCallback(() => {
    if (!animating) return;
    const order = animationDirection === 'down' ? LAYER_ORDER_DOWN : LAYER_ORDER_UP;
    const nextIdx = layerIndexRef.current + 1;
    if (nextIdx >= order.length) {
      resetAnimation();
      return;
    }
    layerIndexRef.current = nextIdx;
    setAnimationLayer(order[nextIdx]);
    pausedRef.current = true; // stay paused after step
  }, [animating, animationDirection, resetAnimation, setAnimationLayer]);

  const handleReset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pausedRef.current = false;
    resetAnimation();
  }, [resetAnimation]);

  const handleReplay = useCallback(() => {
    if (animating) return; // don't interrupt a running animation
    if (!currentPacket) return;
    pausedRef.current = false;
    setAnimationDirection('down');
    setAnimationPhase('encapsulating');
    setAnimationLayer(7);
  }, [animating, currentPacket, setAnimationDirection, setAnimationPhase, setAnimationLayer]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Animation controls */}
      {animating && (
        <div style={{
          padding: '6px 16px', borderBottom: '1px solid #1e293b',
          background: '#0a0f1a', display: 'flex', alignItems: 'center',
          gap: 8, flexShrink: 0,
        }}>
          <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>
            {animationDirection === 'down'
              ? t('helloChat.encapsulating', 'Encapsulating ↓')
              : t('helloChat.decapsulating', 'Decapsulating ↑')}
          </span>
          <span style={{
            color: '#3b82f6', fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            L{animationLayer}
          </span>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
            <button
              onClick={handlePause}
              style={{
                background: '#1e293b', border: '1px solid #334155',
                color: '#94a3b8', padding: '3px 10px', borderRadius: 4,
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {pausedRef.current
                ? t('helloChat.resume', 'Resume')
                : t('helloChat.pause', 'Pause')}
            </button>
            <button
              onClick={handleStep}
              style={{
                background: '#1e293b', border: '1px solid #334155',
                color: '#94a3b8', padding: '3px 10px', borderRadius: 4,
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t('helloChat.step', 'Step')}
            </button>
            <button
              onClick={handleReset}
              style={{
                background: '#1e293b', border: '1px solid #334155',
                color: '#64748b', padding: '3px 10px', borderRadius: 4,
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t('helloChat.skip', 'Skip')}
            </button>
          </div>
        </div>
      )}

      {/* Protocol layers */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <ProtocolPanel activeLayer={animationLayer} animating={animating} />
      </div>

      {/* Bitstream at bottom (L1 physical layer) */}
      {currentPacket && (
        <BitstreamDisplay
          packet={currentPacket}
          active={animationPhase === 'transmitting'}
          onReplay={!animating ? handleReplay : undefined}
        />
      )}
    </div>
  );
}
