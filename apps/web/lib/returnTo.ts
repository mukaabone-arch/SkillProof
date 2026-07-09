/** Only ever follow a same-origin relative path — never an absolute/protocol-relative URL from the query string. */
export function isSafeReturnTo(path: string | null): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//');
}
