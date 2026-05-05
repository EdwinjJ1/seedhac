const TRUNCATE_SUFFIX = '\n…[truncated]';
const TRUNCATE_SUFFIX_BYTES = new TextEncoder().encode(TRUNCATE_SUFFIX).length;

/**
 * UTF-8 安全截断：不撕裂多字节字符，超长时附加截断标记。
 * 使用 fatal:true decoder 逐字节回退找合法边界。
 */
export function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  const cutTarget = maxBytes - TRUNCATE_SUFFIX_BYTES;
  const strict = new TextDecoder('utf-8', { fatal: true });
  for (let cut = cutTarget; cut >= cutTarget - 3 && cut >= 0; cut--) {
    try {
      return strict.decode(bytes.slice(0, cut)) + TRUNCATE_SUFFIX;
    } catch {
      // 切到多字节字符中间，继续回退
    }
  }
  return s.slice(0, cutTarget) + TRUNCATE_SUFFIX;
}
