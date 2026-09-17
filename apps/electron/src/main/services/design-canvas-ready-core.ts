type TimerHandle = ReturnType<typeof setTimeout>

type CanvasReadyDeadlineOptions = {
  timeoutMs: number
  setTimer?: (handler: () => void, milliseconds: number) => TimerHandle
  clearTimer?: (timer: TimerHandle) => void
}

/** Keep the readiness deadline in the main process, where a stuck renderer cannot stall it. */
export async function waitForCanvasReady(
  begin: () => PromiseLike<unknown>,
  options: CanvasReadyDeadlineOptions
): Promise<void> {
  const setTimer =
    options.setTimer ?? ((handler, milliseconds) => setTimeout(handler, milliseconds))
  const clearTimer = options.clearTimer ?? clearTimeout
  let timer: TimerHandle | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimer(
      () => reject(Error('Canvas product API did not become ready')),
      options.timeoutMs
    )
  })
  try {
    await Promise.race([Promise.resolve().then(begin), deadline])
  } finally {
    if (timer !== undefined) clearTimer(timer)
  }
}
