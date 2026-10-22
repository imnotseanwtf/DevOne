/**
 * Joins chunks that arrive in the same tick into one, without delaying a lone
 * chunk: the first one schedules a flush for right after the current work, so a
 * burst (a big file, a log flood) becomes a few messages instead of thousands.
 */
export function createCoalescer(
  emit: (data: Buffer) => void,
  schedule: (run: () => void) => void = setImmediate
) {
  let queued: Buffer[] = [];
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (queued.length === 0) return;
    const data = queued.length === 1 ? queued[0] : Buffer.concat(queued);
    queued = [];
    emit(data);
  };

  return {
    push(chunk: Buffer) {
      queued.push(chunk);
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
    /** Sends what is waiting now, e.g. before the stream's end is announced. */
    flush
  };
}
