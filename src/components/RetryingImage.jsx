import React, { useEffect, useRef, useState } from 'react';

// Delays before each reload of an image that failed to load.
export const IMAGE_RETRY_DELAYS_MS = [500, 1500, 3000];

export function withRetryParam(src, attempt) {
  if (!attempt) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}retry=${attempt}`;
}

/**
 * An <img> for the app's own static icons that reloads itself a few times if
 * the first request fails. Right after the desktop app starts, its local server
 * can drop a connection while it is still starting, and a plain <img> then
 * stays broken until the window is reloaded.
 *
 * @param {{ src: string, onError?: (event: any) => void, [prop: string]: any }} props
 */
export default function RetryingImage({ src, onError, ...props }) {
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    setAttempt(0);
    return () => {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [src]);

  const handleError = (event) => {
    if (attempt >= IMAGE_RETRY_DELAYS_MS.length) {
      onError?.(event);
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setAttempt(attempt + 1);
    }, IMAGE_RETRY_DELAYS_MS[attempt]);
  };

  return <img {...props} src={withRetryParam(src, attempt)} onError={handleError} />;
}
