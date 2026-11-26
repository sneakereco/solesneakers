// Coalesce concurrent public metadata/settings reads, without retaining a result.
// Browser identity, eligibility proofs, claim decisions and stock never enter here.
export function createInFlightLookup<T>(maxKeys = 1024) {
  const pending = new Map<string, Promise<T>>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= maxKeys)
      return Promise.reject(new Error("specialty_lookup_busy"));
    const request = Promise.resolve().then(load);
    pending.set(key, request);
    const clear = () => {
      if (pending.get(key) === request) pending.delete(key);
    };
    void request.then(clear, clear);
    return request;
  };
}
