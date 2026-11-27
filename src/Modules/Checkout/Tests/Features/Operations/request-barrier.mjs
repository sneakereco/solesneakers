export async function atRequestBarrier({
  arrived,
  pending,
  resume,
  inspect,
  timeoutMs = 10000,
}) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error("refusal barrier deadline")), timeoutMs);
  });
  try {
    await Promise.race([
      arrived,
      ...pending.map((request, index) =>
        request.then(() => {
          throw Error("request " + (index + 1) + " returned before the refusal barrier");
        }),
      ),
      deadline,
    ]);
    await Promise.race([inspect(), deadline]);
  } finally {
    clearTimeout(timer);
    resume();
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("refusal barrier cleanup deadline")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
