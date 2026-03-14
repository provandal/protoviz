import { useRef, useEffect, useCallback } from 'react';

export default function SplitLayout({ top, bottom, splitPercent, onSplitChange }) {
  const containerRef = useRef(null);
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback((e) => {
    draggingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      onSplitChange(Math.max(20, Math.min(85, pct)));
    };

    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onSplitChange]);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: splitPercent, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {top}
      </div>
      <div
        onMouseDown={handleMouseDown}
        style={{
          height: 7, flexShrink: 0, cursor: 'row-resize',
          background: '#0f172a',
          borderTop: '1px solid #1e293b', borderBottom: '1px solid #1e293b',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
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
