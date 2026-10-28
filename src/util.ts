export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> => Promise.race([
  promise,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
]);

export const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
