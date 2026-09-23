/**
 * At most `limit` holders at once; everyone else waits in arrival order.
 *
 * Bounds photo processing per API process. The add-vehicle form sends every
 * selected photo at once — up to 30 — and decoding 30 camera JPEGs in
 * parallel is what takes a container past its memory limit. Waiting uploads
 * hold only their compressed bytes (capped by the upload size limit).
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      // The slot passes straight to the next waiter; `active` only drops when
      // nobody is queued.
      if (next) next();
      else this.active -= 1;
    }
  }
}
