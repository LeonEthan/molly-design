export type HostTimeSource = {
  now: () => Date;
  resolveTimeZone: () => string;
};

/** Sampled for every prompt; the SDK restarts the hook chain from its base system prompt. */
export function hostTimeContext(source?: HostTimeSource): string {
  const instant = source?.now() ?? new Date();
  const timeZone = source?.resolveTimeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map(({ type, value }) => [type, value])
  );
  return [
    'Host time at prompt start (from the host clock):',
    `UTC time: ${instant.toISOString()}`,
    `Local date and time: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    `IANA time zone: ${timeZone}`,
    'Use this clock to interpret relative time. A task or event may specify a different date.',
    'Geographic location: not provided by the host; use location explicitly supplied by the user. Do not infer location from the host time zone.',
  ].join('\n');
}
