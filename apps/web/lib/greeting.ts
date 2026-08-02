/**
 * Time-of-day greeting computed from the visitor's own device clock, never a
 * server timestamp — a candidate in a different timezone than the server
 * must still get a greeting that matches their own local time of day.
 */
export function timeOfDayPeriod(now: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function timeOfDayGreeting(now: Date = new Date()): string {
  return `Good ${timeOfDayPeriod(now)}`;
}
