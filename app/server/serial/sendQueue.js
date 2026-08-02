// Serializes all outbound packets through a single promise chain so two
// code paths can never interleave half-written frames on the port.

export class SendQueue {
  /** @param {(buf: Buffer) => Promise<void>} writeFn Resolves when the write drains. */
  constructor(writeFn) {
    this.writeFn = writeFn;
    this.tail = Promise.resolve();
    this.depth = 0;
  }

  /** Queue a frame; resolves once it has been written. */
  send(buf) {
    this.depth++;
    const p = this.tail.then(() => this.writeFn(buf));
    // Keep the chain alive even if a write rejects (port closed mid-write).
    this.tail = p.catch(() => {});
    return p.finally(() => {
      this.depth--;
    });
  }
}
