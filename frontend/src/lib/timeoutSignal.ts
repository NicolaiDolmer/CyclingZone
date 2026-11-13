// AbortSignal.timeout is unavailable in supported Chrome 90 / iOS 15.
// Explicit disposal also avoids retaining timers after a request settles.
export function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const dispose = () => clearTimeout(timer);
  return {
    signal: controller.signal,
    dispose,
    abort() { dispose(); controller.abort(); },
  };
}
