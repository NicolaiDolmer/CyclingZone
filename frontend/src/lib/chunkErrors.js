const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \d+ failed/i,
  /chunkloaderror/i,
  /module script.*mime type/i,
  /expected a javascript module script/i,
  // React.lazy intern-state efter en fejlet dynamic import (#881), Firefox/Safari:
  // "e._result is undefined" / "undefined is not an object (evaluating 'e._result.default')".
  /_result is undefined/i,
  /_result\.default/i,
];

export function getErrorText(error) {
  if (!error) return "";
  const parts = [
    error.name,
    error.message,
    error.stack,
    error.cause?.message,
  ].filter(Boolean);
  return parts.join("\n");
}

export function isChunkLoadError(error) {
  const text = getErrorText(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function getChunkReloadKey(release = "unknown") {
  return `cz:chunk-reload-attempted:${release || "unknown"}`;
}

export function shouldAttemptChunkReload({ error, release, storage } = {}) {
  if (!isChunkLoadError(error) || !storage) return false;
  const key = getChunkReloadKey(release);
  try {
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}
