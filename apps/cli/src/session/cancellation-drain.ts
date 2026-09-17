/** A cancel ACK is not completion. Keep one owner until requests settle or the
 * process has actually exited; a failed termination remains explicitly retryable. */
export function createCancellationDrain(options: {
  pending: Promise<void>;
  terminate: () => Promise<void>;
  onFailure: (error: unknown) => void;
  timeoutMs: number;
}): { completion: Promise<void>; retry: () => Promise<boolean> } {
  let finish!: () => void;
  let settled = false;
  let escalationStarted = false;
  let attempt: Promise<boolean> | undefined;
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const complete = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    finish();
  };
  const attemptStop = (): Promise<boolean> => {
    if (settled) return Promise.resolve(true);
    if (attempt) return attempt;
    attempt = options
      .terminate()
      .then(
        () => {
          complete();
          return true;
        },
        (error) => {
          options.onFailure(error);
          return false;
        }
      )
      .finally(() => {
        attempt = undefined;
      });
    return attempt;
  };
  const timer = setTimeout(() => {
    escalationStarted = true;
    void attemptStop();
  }, options.timeoutMs);
  void options.pending.then(complete, complete);
  return {
    completion,
    retry: () => (settled || escalationStarted ? attemptStop() : Promise.resolve(false)),
  };
}
