/** Tiny classNames join — avoids a dependency for something this small. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
