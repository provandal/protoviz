import { useRef, useEffect, useCallback } from 'react';

export default function SplitLayout({ top, bottom, splitPercent, onSplitChange }) {
  const containerRef = useRef(null);
  const draggingRef = useRef(false);

  const calcPercent = useCallback((clientY) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((clientY - rect.top) / rect.height) * 100;
    return Math.max(20, Math.min(85, pct));
  }, []);

  const handleMouseDown = useCallback((e) => {
    draggingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, []);

  const handleTouchStart = useCallback((e) => {
    draggingRef.current = true;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingRef.current) return;
      const pct = calcPercent(e.clientY);
      if (pct !== null) onSplitChange(pct);
    };

    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    const handleTouchMove = (e) => {
      if (!draggingRef.current) return;
      const touch = e.touches[0];
      if (touch) {
        const pct = calcPercent(touch.clientY);
        if (pct !== null) onSplitChange(pct);
      }
    };

    const handleTouchEnd = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onSplitChange, calcPercent]);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: splitPercent, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {top}
      </div>
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{
          height: 7, flexShrink: 0, cursor: 'row-resize',
          background: '#0f172a',
          borderTop: '1px solid #1e293b', borderBottom: '1px solid #1e293b',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none',
        }}
      >
        <div style={{ width: 48, height: 3, background: '#334155', borderRadius: 2 }} />
      </div>
      <div style={{ flex: 100 - splitPercent, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {bottom}
      </div>
    </div>
  );
}
