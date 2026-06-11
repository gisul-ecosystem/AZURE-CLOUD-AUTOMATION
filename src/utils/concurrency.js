const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runWithConcurrency = async (items, concurrency, worker, options = {}) => {
  const resolvedConcurrency = Math.max(1, Number(concurrency) || 1);
  const queue = Array.isArray(items) ? items : [];
  const continueOnError = Boolean(options.continueOnError);
  const onError = typeof options.onError === 'function' ? options.onError : null;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(resolvedConcurrency, queue.length || 1) }, async () => {
    while (cursor < queue.length) {
      const currentIndex = cursor;
      cursor += 1;

      // Give the event loop a chance to breathe between tight loops.
      // This helps when the queue is large and work is mostly async.
      try {
        await worker(queue[currentIndex], currentIndex);
      } catch (error) {
        if (onError) {
          await onError(error, queue[currentIndex], currentIndex);
        }

        if (!continueOnError) {
          throw error;
        }
      }
      await sleep(0);
    }
  });

  await Promise.all(workers);
};

module.exports = {
  runWithConcurrency,
  sleep
};
