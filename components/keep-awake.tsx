'use client';
import { useEffect, useRef, useState } from 'react';
import { Sun } from 'lucide-react';
/** Browser capability only: never changes game clocks or host liveness. */
export default function KeepAwake() {
  const [supported, setSupported] = useState<boolean>();
  const [status, setStatus] = useState<
    'off' | 'requesting' | 'active' | 'waiting' | 'released' | 'denied'
  >('off');
  const enabled = useRef(false);
  const alive = useRef(false);
  const lock = useRef<WakeLockSentinel | undefined>(undefined);
  const generation = useRef(0);
  const request = async () => {
    if (!alive.current || !enabled.current || document.visibilityState !== 'visible') return;
    const ticket = ++generation.current;
    setStatus('requesting');
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (
        !alive.current ||
        !enabled.current ||
        ticket !== generation.current ||
        document.visibilityState !== 'visible'
      ) {
        await acquired.release();
        return;
      }
      if (acquired.released) {
        setStatus('released');
        return;
      }
      lock.current = acquired;
      acquired.addEventListener('release', () => {
        if (lock.current !== acquired) return;
        lock.current = undefined;
        if (alive.current && enabled.current)
          setStatus(document.visibilityState === 'visible' ? 'released' : 'waiting');
      });
      setStatus('active');
    } catch {
      if (alive.current && enabled.current && ticket === generation.current) setStatus('denied');
    }
  };
  useEffect(() => {
    alive.current = true;
    setSupported(window.isSecureContext && typeof navigator.wakeLock?.request === 'function');
    const visibility = () => {
      if (!enabled.current) return;
      if (document.visibilityState === 'visible') {
        if (!lock.current || lock.current.released) void request();
      } else {
        generation.current++;
        const old = lock.current;
        lock.current = undefined;
        void old?.release().catch(() => {});
        setStatus('waiting');
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      enabled.current = false;
      generation.current++;
      const old = lock.current;
      lock.current = undefined;
      void old?.release().catch(() => {});
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  if (supported === undefined) return null;
  // Do not crowd the session toolbar with an unsupported feature notice.
  if (!supported) return null;
  const messages = {
    off: 'Keep the host screen awake',
    requesting: 'Requesting screen wake lock…',
    active: 'Screen will stay awake',
    waiting: 'Screen wake lock is waiting for the tab',
    released: 'Screen wake lock was released — tap to retry',
    denied: 'Screen wake lock unavailable — tap to retry',
  };
  const enabledStatus = status === 'active' || status === 'requesting' || status === 'waiting';
  return (
    <div className="awake-control">
      <button
        type="button"
        className="button secondary small-button awake-button"
        aria-pressed={enabledStatus}
        title={messages[status]}
        onClick={() => {
          if (status === 'active' || status === 'waiting' || status === 'requesting') {
            enabled.current = false;
            generation.current++;
            const old = lock.current;
            lock.current = undefined;
            void old?.release().catch(() => {});
            setStatus('off');
          } else {
            enabled.current = true;
            void request();
          }
        }}
      >
        <Sun size={17} aria-hidden="true" />
        <span>Keep screen awake</span>
        {status !== 'off' && <span className={'awake-state '+(status === 'active' ? 'is-active' : '')} role="status">
          {status === 'active' ? 'On' : status === 'requesting' ? '…' : status === 'waiting' ? 'Paused' : 'Retry'}
        </span>}
      </button>
    </div>
  );
}
