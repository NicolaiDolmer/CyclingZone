type PosthogCapture = {
  isCapturing: () => boolean;
  capture: (name: string, properties?: Record<string, unknown>, options?: { userId?: string | null }) => void;
};

let sink: PosthogCapture | undefined;

// The optional PostHog runtime registers its existing consent and identity gate.
// Eager telemetry callers can check availability without loading that runtime.
export function registerPosthogCapture(runtime: PosthogCapture) {
  sink = runtime;
}

export function isPosthogCapturing() {
  return sink?.isCapturing() ?? false;
}

export function capturePosthogEvent(name: string, properties?: Record<string, unknown>, options?: { userId?: string | null }) {
  if (sink?.isCapturing()) sink.capture(name, properties, options);
}
