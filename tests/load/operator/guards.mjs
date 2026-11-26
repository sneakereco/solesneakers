export function createErrorGuard() {
  let previous = { attempts: 0, errors: 0 },
    badSince = null;
  return {
    observe(sample) {
      if (
        ![sample.at, sample.attempts, sample.errors].every(Number.isFinite) ||
        sample.attempts < previous.attempts ||
        sample.errors < previous.errors ||
        sample.errors > sample.attempts
      )
        throw Error("Emergency counters regressed or became invalid");
      const attempts = sample.attempts - previous.attempts,
        errors = sample.errors - previous.errors;
      previous = { attempts: sample.attempts, errors: sample.errors };
      if (attempts > 0) {
        if (errors / attempts > 0.05) badSince ??= sample.at;
        else badSince = null;
      }
      return badSince !== null && sample.at - badSince >= 60000;
    },
  };
}
