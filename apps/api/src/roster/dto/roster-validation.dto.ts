import { ApiProperty } from '@nestjs/swagger';

/// §4.2 인력배치기준 표의 11개 행. JobRole과 1:1이 아니다 — NURSE·NURSE_AIDE는
/// "간호(조무)사" 1행으로, PHYSICAL_THERAPIST·OCCUPATIONAL_THERAPIST는
/// "물리(작업)치료사" 1행으로 합산 표기한다(원문 표 그대로).
export const STAFFING_CATEGORIES = [
  'DIRECTOR',
  'OFFICE_MANAGER',
  'SOCIAL_WORKER',
  'NURSE_OR_AIDE',
  'THERAPIST',
  'CAREGIVER',
  'CLERK',
  'DIETITIAN',
  'COOK',
  'HYGIENIST',
  'JANITOR',
] as const;

export type StaffingCategory = (typeof STAFFING_CATEGORIES)[number];

/// 월별 적정 근무자 수 체크(§4.2) 1개 직군행
export class MonthlyStaffingItemDto {
  @ApiProperty({ enum: STAFFING_CATEGORIES })
  category!: StaffingCategory;

  /// 배치기준상 필요 인원(월별 현원 기준, §4.2)
  @ApiProperty()
  required!: number;

  /// 월 기준근무시간 충족 인원 + 미달 근무시간 합산 환산 인원(§4.2 근무자 산정 방식, 가산 산정 반올림)
  @ApiProperty()
  actual!: number;

  @ApiProperty()
  met!: boolean;
}

export class BonusScoreBreakdownDto {
  /// ① 인력배치추가 가산(간호(조무)사·사회복지사·물리(작업)치료사 합, §4.3①)
  @ApiProperty()
  staffAddon!: number;

  /// ② 야간직원배치 가산(§4.3②)
  @ApiProperty()
  nightAddon!: number;

  /// ③ 간호사배치 가산(입소자 50인 이상 시설 +0.2점 포함, §4.3③)
  @ApiProperty()
  nurseAddon!: number;
}

export class BonusScoreDto {
  @ApiProperty({ description: '①+②+③ 합계' })
  estimated!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'Facility.addonTargetScore(A-6) — 미설정 시 null' })
  target!: number | null;

  @ApiProperty({ type: BonusScoreBreakdownDto })
  breakdown!: BonusScoreBreakdownDto;

  /// §4.3 실근무시간 대체 산정 안내 — 실제 GPS 태그 연동(Phase 3) 전까지 근무표 계획 시간 기준
  @ApiProperty({ default: true })
  isPlanBased!: boolean;
}

export class RosterValidationDto {
  /// §4.1 월 기준근무시간(시간 단위). 고시 파라미터(RegulationParamSet) 미설정 시 null
  @ApiProperty({ type: Number, nullable: true })
  monthlyBaseHours!: number | null;

  @ApiProperty({ type: [MonthlyStaffingItemDto] })
  monthlyStaffing!: MonthlyStaffingItemDto[];

  @ApiProperty({ type: BonusScoreDto, nullable: true })
  bonusScore!: BonusScoreDto | null;

  /// RegulationParamSet 또는 MonthlyCensus(월별 현원) 미설정 — 패널에 "설정 필요" 안내
  @ApiProperty()
  configMissing!: boolean;
}
