import { TimeoutError, withRetry, withTimeout } from "../runtime/resilience.js";

async function main() {
  let calls = 0;
  const result = await withRetry(
    () => withTimeout(async () => {
      calls += 1;
      if (calls < 2) throw new Error("temporary upstream error");
      return "ok";
    }, 100),
    { maxRetries: 2, baseDelayMs: 10 },
    error => !(error instanceof TimeoutError)
  );

  console.log({ result, calls });

  try {
    await withTimeout(
      signal => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve("late"), 200);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      }),
      20
    );
  } catch (error) {
    console.log(error instanceof TimeoutError ? error.message : error);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
