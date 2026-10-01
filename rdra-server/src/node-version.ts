export function nodeVersionError(version: string): string | null {
  const [major, minor] = version.split(".").map((n) => Number.parseInt(n, 10));
  const ok = major > 22 || (major === 22 && minor >= 13);
  return ok ? null : `geass rdra-server には Node 22.13 以上が必要です（現在: ${version}）`;
}
