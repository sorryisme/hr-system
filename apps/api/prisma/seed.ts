import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { hashPassword } from '../src/auth/password.util';

// Prisma v7: bare `new PrismaClient()`는 드라이버 어댑터 없이는 생성이 거부된다.
// DATABASE_URL은 prisma CLI(prisma.config.ts)가 .env에서 주입한다.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

// 시드 재실행 시에도 동일한 값이 나오도록 산정 기준일을 고정한다(오늘 날짜에 의존하지 않음).
const AS_OF_DATE = new Date('2026-07-22T00:00:00Z');

/**
 * D-9 연차 부여 규칙(근로기준법 제60조, docs/plan/dev_plan_0720.md §D-9).
 * - 입사 1년 미만: 개근 개월 수만큼 1일씩 부여(최대 11일)
 * - 입사 1년 이상: 1년차 15일, 이후 2년마다 +1일(3년차 16, 5년차 17…), 가산 포함 총 상한 25일
 * balanceYear는 입사일 기준 연차연도의 시작 연도(schema.prisma LeaveBalance 주석 참고).
 */
function calculateAnnualLeaveGrant(hireDate: Date, balanceYear: number, asOf: Date): string {
  const servedYears = balanceYear - hireDate.getUTCFullYear();

  if (servedYears < 1) {
    let months = (asOf.getUTCFullYear() - hireDate.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - hireDate.getUTCMonth());
    if (asOf.getUTCDate() < hireDate.getUTCDate()) months -= 1;
    return Math.max(0, Math.min(months, 11)).toFixed(1);
  }

  const bonusSteps = Math.floor((servedYears - 1) / 2);
  return Math.min(15 + bonusSteps, 25).toFixed(1);
}

async function main() {
  const facility = await prisma.facility.upsert({
    where: { id: 1n },
    update: {},
    create: { id: 1n, name: '샘플요양원', capacity: 60 },
  });

  // §4.7 확정 근무유형표(DDL v1.2 초기 데이터) 기준. recognizedMinutes: 주간=480, 야간(주야비)=580(9h40m),
  // 야간전담=480, 연차=480, 반차=240, 유급병가=480, 휴무·결근=0(불인정)
  const shiftTypes = [
    { code: 'D', label: '주간', startTime: new Date('1970-01-01T08:50:00Z'), endTime: new Date('1970-01-01T18:00:00Z'), breakMinutes: 70, crossesMidnight: false, countsAsWork: true, recognizedMinutes: 480, cellLabel: '주', sortOrder: 1 },
    { code: 'N', label: '야간(주야비)', startTime: new Date('1970-01-01T17:50:00Z'), endTime: new Date('1970-01-01T09:00:00Z'), breakMinutes: 330, crossesMidnight: true, countsAsWork: true, recognizedMinutes: 580, cellLabel: '야', sortOrder: 2 },
    { code: 'NF', label: '야간(야간전담)', startTime: new Date('1970-01-01T18:00:00Z'), endTime: new Date('1970-01-01T09:00:00Z'), breakMinutes: 420, crossesMidnight: true, countsAsWork: true, recognizedMinutes: 480, cellLabel: '야', sortOrder: 3 },
    { code: 'OFF', label: '휴무', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedMinutes: 0, cellLabel: '휴', sortOrder: 4 },
    { code: 'AL', label: '연차', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedMinutes: 480, cellLabel: '연', sortOrder: 5 },
    { code: 'HAM', label: '오전반차', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedMinutes: 240, cellLabel: '오전', sortOrder: 6 },
    { code: 'HPM', label: '오후반차', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedMinutes: 240, cellLabel: '오후', sortOrder: 7 },
    // 유급휴일대체. 근로자 관점 1일 휴가. 공단 인정분은 §4.4 규칙으로 ledger에서 별도 산정(최대 480분)
    { code: 'SUB', label: '휴일대체', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedMinutes: 480, cellLabel: '유', sortOrder: 8 },
    // D-18: 신청·결재 유형 아님 — Phase 2 근무표 관리자 직접 입력
    { code: 'SICK', label: '병가(유급)', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedMinutes: 480, cellLabel: '병', sortOrder: 9 },
    // D-18: 기준근무시간 불인정(§4.1)
    { code: 'ABS', label: '결근', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedMinutes: 0, cellLabel: '결', sortOrder: 10 },
  ];

  for (const shiftType of shiftTypes) {
    await prisma.shiftType.upsert({
      where: { facilityId_code: { facilityId: facility.id, code: shiftType.code } },
      update: {},
      create: { facilityId: facility.id, ...shiftType },
    });
  }

  await seedApprovalFixtures(facility.id);
}

// =============================================================
// 결재함 수직 슬라이스용 픽스처 (기획서 v3.2 §3 — 팀/직원/결재선/잔여/신청)
// 모든 인명은 가상 인물이다.
// =============================================================

async function seedApprovalFixtures(facilityId: bigint) {
  // --- 팀 (uq_team_name upsert) ---
  const teamNames = ['1층팀', '2층팀'];
  const teams: Record<string, bigint> = {};
  for (const [i, name] of teamNames.entries()) {
    const team = await prisma.team.upsert({
      where: { facilityId_name: { facilityId, name } },
      update: {},
      create: { facilityId, name, sortOrder: i + 1 },
    });
    teams[name] = team.id;
  }

  // --- 관리자 웹 로그인 계정(로컬 개발용 — 운영 배포 시 실제 계정 정책으로 교체) ---
  // 비밀번호는 전 계정 공통 'admin1234!' (scrypt 해시 저장, 평문 미저장)
  const devPasswordHash = await hashPassword('admin1234!');
  const adminCredentials: Record<string, { email: string; passwordHash: string }> = {
    '1': { email: 'director@careshift.kr', passwordHash: devPasswordHash },
    '2': { email: 'manager@careshift.kr', passwordHash: devPasswordHash },
  };

  // --- 모바일 기기 등록 로그인용 관리자 발급 코드(로컬 개발용 — C-13/N-10) ---
  // pin_hash는 employee 테이블의 관리자 발급 코드 해시(scrypt, password.util 재사용).
  // 관리자(1~2, ADMIN)는 웹 로그인 대상이라 코드를 발급하지 않는다 — 종사자(3~8, STAFF)에만 부여.
  // 등록 성공 시 서버가 소진(null)시키므로, 재테스트하려면 db:seed를 다시 실행한다.
  const staffPinCodes: Record<string, string> = {
    '3': '333333',
    '4': '123456',
    '5': '555555',
    '6': '666666',
    '7': '777777',
    '8': '888888',
    '9': '999999',
  };
  const staffPinCredentials: Record<string, { pinHash: string }> = {};
  for (const [id, code] of Object.entries(staffPinCodes)) {
    staffPinCredentials[id] = { pinHash: await hashPassword(code) };
  }

  // --- 직원 (고정 id upsert). 1~3 = 결재 권한자(서명 더미 필수 — D-12), 4~8 = 신청자 ---
  const employees = [
    { id: 1n, name: '김평온', jobRole: 'DIRECTOR', systemRole: 'ADMIN', hireDate: new Date('2015-03-01'), canShiftWork: false, signaturePath: 'signatures/emp1.png' },
    { id: 2n, name: '박든든', jobRole: 'OFFICE_MANAGER', systemRole: 'ADMIN', hireDate: new Date('2017-05-15'), canShiftWork: false, signaturePath: 'signatures/emp2.png' },
    { id: 3n, name: '이살핌', jobRole: 'SOCIAL_WORKER', systemRole: 'STAFF', hireDate: new Date('2020-01-06'), canShiftWork: false, signaturePath: 'signatures/emp3.png' },
    { id: 4n, name: '최정성', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2021-04-01'), teamId: teams['1층팀'] },
    { id: 5n, name: '정보람', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2019-09-16'), teamId: teams['1층팀'] },
    { id: 6n, name: '한슬기', jobRole: 'NURSE_AIDE', systemRole: 'STAFF', hireDate: new Date('2022-02-07'), teamId: teams['2층팀'] },
    { id: 7n, name: '오다정', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2018-11-12'), teamId: teams['2층팀'] },
    { id: 8n, name: '강마루', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2023-06-19'), teamId: teams['2층팀'] },
    // 입사 1년 미만(D-9 개근 개월 부여 케이스 확인용)
    { id: 9n, name: '윤새봄', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2026-03-02'), teamId: teams['2층팀'] },
  ] as const;
  for (const emp of employees) {
    // 로그인 계정은 update에도 넣는다 — 마이그레이션 이전에 만들어진 기존 행에도 반영되도록
    const credential = adminCredentials[emp.id.toString()] ?? {};
    const pinCredential = staffPinCredentials[emp.id.toString()] ?? {};
    await prisma.employee.upsert({
      where: { id: emp.id },
      update: { ...credential, ...pinCredential },
      create: { facilityId, ...credential, ...pinCredential, ...emp },
    });
  }

  // --- 결재선 (표준 3단계, §3.1 / D-13). uq_line_step upsert ---
  const effectiveFrom = new Date('2026-01-01');
  const lines = [
    { stepNo: 1, approverRole: 'SOCIAL_WORKER', deputyId: 2n },
    { stepNo: 2, approverRole: 'OFFICE_MANAGER' },
    { stepNo: 3, approverRole: 'DIRECTOR' },
  ] as const;
  for (const line of lines) {
    await prisma.approvalLine.upsert({
      where: { facilityId_stepNo_effectiveFrom: { facilityId, stepNo: line.stepNo, effectiveFrom } },
      update: {},
      create: { facilityId, effectiveFrom, ...line },
    });
  }

  // --- 잔여 (2026). reserved = 열린 신청(PENDING/INTERIM) 합계, used = 승인 확정분과 정합 ---
  // granted는 입사일 기준 D-9 규칙으로 계산(calculateAnnualLeaveGrant). remaining은 DB GENERATED 컬럼 — 쓰지 않는다
  const hireDatesById = new Map<bigint, Date>(employees.map((e) => [e.id, e.hireDate]));
  const balanceYear = 2026;
  const leaveBalances = [
    { employeeId: 1n, used: '0.0', reserved: '0.0' },
    { employeeId: 2n, used: '0.0', reserved: '0.0' },
    { employeeId: 3n, used: '0.0', reserved: '0.0' },
    { employeeId: 4n, used: '0.0', reserved: '2.5' }, // 신청 1(2.0) + 6(0.5)
    { employeeId: 5n, used: '1.0', reserved: '0.5' }, // 승인 7(1.0), 신청 2(0.5)
    { employeeId: 6n, used: '1.0', reserved: '0.0' }, // 전결 승인 8(1.0)
    { employeeId: 7n, used: '0.0', reserved: '0.0' },
    { employeeId: 8n, used: '0.0', reserved: '1.0' }, // 신청 5(1.0)
    { employeeId: 9n, used: '0.0', reserved: '0.0' }, // 입사 1년 미만 — 개근 개월 수 기준 부여
  ].map((b) => ({
    ...b,
    granted: calculateAnnualLeaveGrant(hireDatesById.get(b.employeeId)!, balanceYear, AS_OF_DATE),
  }));
  for (const b of leaveBalances) {
    await prisma.leaveBalance.upsert({
      where: { employeeId_balanceYear: { employeeId: b.employeeId, balanceYear } },
      update: {},
      create: { balanceYear, ...b },
    });
  }
  // 유대 잔여(1일 단위 사용 트랙 — D-15). 신청 4(1.0)가 대기 중
  await prisma.substituteHolidayBalance.upsert({
    where: { employeeId_balanceYear: { employeeId: 7n, balanceYear: 2026 } },
    update: {},
    create: { employeeId: 7n, balanceYear: 2026, granted: '2.0', used: '0.0', reserved: '1.0' },
  });

  // --- 신청 픽스처 ---
  // approval_history는 append-only(DB 트리거가 UPDATE/DELETE 차단)라 delete-and-recreate가
  // 불가능하다. 신청 데이터가 이미 있으면 통째로 스킵(count-guard) — 완전 재시드는 로컬에서
  // `prisma migrate reset`으로만 한다(운영 금지 — CLAUDE.md).
  if ((await prisma.approvalRequest.count()) > 0) {
    console.log('approval_request에 데이터가 있어 신청 픽스처 시드를 건너뜁니다.');
    return;
  }

  const dayShift = await prisma.shiftType.findUniqueOrThrow({
    where: { facilityId_code: { facilityId, code: 'D' } },
    select: { id: true },
  });

  /** 표준 3단계 결재선의 제출 시점 스냅샷(엣지 12). step2 전결 여부만 가변 */
  const snapshotLines = (step2Delegation = false) => [
    { stepNo: 1, approverId: 3n, deputyId: 2n, delegationEnabled: false },
    { stepNo: 2, approverId: 2n, deputyId: null, delegationEnabled: step2Delegation },
    { stepNo: 3, approverId: 1n, deputyId: null, delegationEnabled: false },
  ];
  const sign = (requestId: bigint, stepNo: number, actorId: bigint) =>
    `signatures/snapshots/${requestId}/step${stepNo}-${actorId}.png`;

  const requests: Parameters<typeof prisma.approvalRequest.create>[0]['data'][] = [
    // ① 대기 — 연차 2일 다중일(US-01)
    {
      id: 1n, facilityId, requesterId: 4n, type: 'ANNUAL', leaveDays: '2.0',
      status: 'PENDING', currentStep: 0, createdAt: new Date('2026-07-15T09:12:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-21') }, { targetDate: new Date('2026-07-22') }] },
      requestLines: { create: snapshotLines() },
      histories: { create: [{ actorId: 4n, action: 'SUBMIT', actedAt: new Date('2026-07-15T09:12:00Z') }] },
    },
    // ② 대기 — 오전반차(D-1: 0.5일)
    {
      id: 2n, facilityId, requesterId: 5n, type: 'HALF_AM', leaveDays: '0.5',
      status: 'PENDING', currentStep: 0, createdAt: new Date('2026-07-16T10:30:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-24') }] },
      requestLines: { create: snapshotLines() },
      histories: { create: [{ actorId: 5n, action: 'SUBMIT', actedAt: new Date('2026-07-16T10:30:00Z') }] },
    },
    // ③ 대기 — 근무조정(사유 필수 — D-14)
    {
      id: 3n, facilityId, requesterId: 6n, type: 'SHIFT_CHANGE', desiredShiftId: dayShift.id,
      reason: '병원 진료 예약이 있어 주간 근무로 바꾸고 싶습니다.',
      status: 'PENDING', currentStep: 0, createdAt: new Date('2026-07-16T14:05:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-28') }] },
      requestLines: { create: snapshotLines() },
      histories: { create: [{ actorId: 6n, action: 'SUBMIT', actedAt: new Date('2026-07-16T14:05:00Z') }] },
    },
    // ④ 대기 — 유대, 사후 신청 라벨(D-3)
    {
      id: 4n, facilityId, requesterId: 7n, type: 'SUBSTITUTE_HOLIDAY', leaveDays: '1.0',
      isRetroactive: true,
      status: 'PENDING', currentStep: 0, createdAt: new Date('2026-07-16T18:40:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-13') }] },
      requestLines: { create: snapshotLines() },
      histories: { create: [{ actorId: 7n, action: 'SUBMIT', actedAt: new Date('2026-07-16T18:40:00Z') }] },
    },
    // ⑤ 중간승인(1차 완료) — step2 스냅샷 전결 ON: 사무국장 승인 시 전결 확정을 라이브로 시연(D-13)
    {
      id: 5n, facilityId, requesterId: 8n, type: 'ANNUAL', leaveDays: '1.0',
      status: 'INTERIM_APPROVED', currentStep: 1, createdAt: new Date('2026-07-14T08:55:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-30') }] },
      requestLines: { create: snapshotLines(true) },
      histories: {
        create: [
          { actorId: 8n, action: 'SUBMIT', actedAt: new Date('2026-07-14T08:55:00Z') },
          { actorId: 3n, action: 'APPROVE', stepNo: 1, signatureSnapshotPath: sign(5n, 1, 3n), actedAt: new Date('2026-07-14T11:20:00Z') },
        ],
      },
    },
    // ⑥ 중간승인(2차 완료) — 시설장 최종 승인 대기
    {
      id: 6n, facilityId, requesterId: 4n, type: 'HALF_PM', leaveDays: '0.5',
      status: 'INTERIM_APPROVED', currentStep: 2, createdAt: new Date('2026-07-13T16:00:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-25') }] },
      requestLines: { create: snapshotLines() },
      histories: {
        create: [
          { actorId: 4n, action: 'SUBMIT', actedAt: new Date('2026-07-13T16:00:00Z') },
          { actorId: 3n, action: 'APPROVE', stepNo: 1, signatureSnapshotPath: sign(6n, 1, 3n), actedAt: new Date('2026-07-14T09:10:00Z') },
          { actorId: 2n, action: 'APPROVE', stepNo: 2, signatureSnapshotPath: sign(6n, 2, 2n), actedAt: new Date('2026-07-15T10:45:00Z') },
        ],
      },
    },
    // ⑦ 승인 — 3단계 정상 종결(US-05)
    {
      id: 7n, facilityId, requesterId: 5n, type: 'ANNUAL', leaveDays: '1.0',
      status: 'APPROVED', currentStep: 3, createdAt: new Date('2026-07-03T09:00:00Z'),
      finalizedAt: new Date('2026-07-04T15:30:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-10') }] },
      requestLines: { create: snapshotLines() },
      histories: {
        create: [
          { actorId: 5n, action: 'SUBMIT', actedAt: new Date('2026-07-03T09:00:00Z') },
          { actorId: 3n, action: 'APPROVE', stepNo: 1, signatureSnapshotPath: sign(7n, 1, 3n), actedAt: new Date('2026-07-03T13:20:00Z') },
          { actorId: 2n, action: 'APPROVE', stepNo: 2, signatureSnapshotPath: sign(7n, 2, 2n), actedAt: new Date('2026-07-04T09:40:00Z') },
          { actorId: 1n, action: 'APPROVE', stepNo: 3, signatureSnapshotPath: sign(7n, 3, 1n), actedAt: new Date('2026-07-04T15:30:00Z') },
        ],
      },
    },
    // ⑧ 승인 — 전결 종결("전결" 표기 근거 — D-13)
    {
      id: 8n, facilityId, requesterId: 6n, type: 'ANNUAL', leaveDays: '1.0',
      status: 'APPROVED', currentStep: 2, isFinalByDelegation: true,
      createdAt: new Date('2026-07-06T10:00:00Z'), finalizedAt: new Date('2026-07-07T11:15:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-08') }] },
      requestLines: { create: snapshotLines(true) },
      histories: {
        create: [
          { actorId: 6n, action: 'SUBMIT', actedAt: new Date('2026-07-06T10:00:00Z') },
          { actorId: 3n, action: 'APPROVE', stepNo: 1, signatureSnapshotPath: sign(8n, 1, 3n), actedAt: new Date('2026-07-06T14:30:00Z') },
          { actorId: 2n, action: 'APPROVE', stepNo: 2, isDelegatedFinal: true, signatureSnapshotPath: sign(8n, 2, 2n), actedAt: new Date('2026-07-07T11:15:00Z') },
        ],
      },
    },
    // ⑨ 반려 — 근무조정 1차 반려(사유 필수 — US-04)
    {
      id: 9n, facilityId, requesterId: 7n, type: 'SHIFT_CHANGE', desiredShiftId: dayShift.id,
      reason: '가족 행사가 있어 야간 대신 주간 근무를 희망합니다.',
      status: 'REJECTED', currentStep: 0, createdAt: new Date('2026-07-11T09:30:00Z'),
      finalizedAt: new Date('2026-07-11T17:00:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-18') }] },
      requestLines: { create: snapshotLines() },
      histories: {
        create: [
          { actorId: 7n, action: 'SUBMIT', actedAt: new Date('2026-07-11T09:30:00Z') },
          { actorId: 3n, action: 'REJECT', stepNo: 1, comment: '해당일 야간 인력이 부족해 조정이 어렵습니다.', actedAt: new Date('2026-07-11T17:00:00Z') },
        ],
      },
    },
    // ⑩ 반려 — 연차 2차(사무국장) 반려: 선행 승인 이력이 남는 케이스
    {
      id: 10n, facilityId, requesterId: 8n, type: 'ANNUAL', leaveDays: '1.0',
      status: 'REJECTED', currentStep: 1, createdAt: new Date('2026-07-09T08:20:00Z'),
      finalizedAt: new Date('2026-07-10T13:50:00Z'),
      targetDates: { create: [{ targetDate: new Date('2026-07-11') }] },
      requestLines: { create: snapshotLines() },
      histories: {
        create: [
          { actorId: 8n, action: 'SUBMIT', actedAt: new Date('2026-07-09T08:20:00Z') },
          { actorId: 3n, action: 'APPROVE', stepNo: 1, signatureSnapshotPath: sign(10n, 1, 3n), actedAt: new Date('2026-07-09T15:10:00Z') },
          { actorId: 2n, action: 'REJECT', stepNo: 2, comment: '월말 인력 배치 확정 후 다시 신청해 주세요.', actedAt: new Date('2026-07-10T13:50:00Z') },
        ],
      },
    },
  ];

  for (const data of requests) {
    await prisma.approvalRequest.create({ data });
  }
  console.log(`결재 픽스처 시드 완료: 신청 ${requests.length}건`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
