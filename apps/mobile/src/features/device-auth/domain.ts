export const CODE_LENGTH = 6

/** 숫자만 남기고 자릿수를 제한한다 — 붙여넣기·자동완성 방어 */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH
}
