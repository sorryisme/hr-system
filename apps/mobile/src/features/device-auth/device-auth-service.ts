import { isCompleteCode } from './domain'
import { MOCK_VALID_CODE } from './mock-data'

export type VerifyResult = { ok: true } | { ok: false; message: string }

/**
 * 관리자 발급 코드 검증 — Mock. apps/api에 인증 도메인이 구현되고 Orval 클라이언트가
 * 연동되면 POST /api/devices/register 호출로 대체한다(dev_plan_0720.md §2.2 Phase 0, C-13).
 */
export function verifyDeviceCode(code: string): VerifyResult {
  if (!isCompleteCode(code)) {
    return { ok: false, message: '숫자 6자리를 모두 입력해주세요.' }
  }
  if (code !== MOCK_VALID_CODE) {
    return { ok: false, message: '등록 코드가 맞지 않아요. 관리자에게 다시 확인해주세요.' }
  }
  return { ok: true }
}
