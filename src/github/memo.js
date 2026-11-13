// @ts-check

/**
 * Caches a load by key, forgetting failures so the next attempt retries.
 * @template T
 * @param {Map<string, Promise<T>>} cache
 * @param {string} key
 * @param {() => Promise<T>} load
 */
export function memo(cache, key, load) {
  let value = cache.get(key);
  if (!value) {
    value = load();
    cache.set(key, value);
    value.catch(() => cache.delete(key));
  }
  return value;
}
