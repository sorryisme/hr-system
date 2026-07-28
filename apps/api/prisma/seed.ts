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
  await seedRosterFixtures(facility.id);
}

// =============================================================
// 결재함 수직 슬라이스용 픽스처 (기획서 v3.2 §3 — 팀/직원/결재선/잔여/신청)
// 모든 인명은 가상 인물이다.
// =============================================================

async function seedApprovalFixtures(facilityId: bigint) {
  // --- 팀 (uq_team_name upsert) ---
  const teamNames = [
    '총괄',
    '복지행정팀',
    '간호재활팀',
    '요양1팀',
    '요양2팀',
    '요양3팀',
    '요양4팀',
    '요양5팀',
    '요양6팀',
  ];
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
  // 관리자(1~2, ADMIN)는 웹 로그인 대상이라 코드를 발급하지 않는다 — 종사자(3~27, STAFF)에만 부여.
  // 등록 성공 시 서버가 소진(null)시키므로, 재테스트하려면 db:seed를 다시 실행한다.
  const staffPinCodes: Record<string, string> = {
    '3': '333333',
    '4': '123456',
    '5': '555555',
    '6': '666666',
    '7': '777777',
    '8': '888888',
    '9': '999999',
    '10': '101010',
    '11': '111111',
    '12': '121212',
    '13': '131313',
    '14': '141414',
    '15': '151515',
    '16': '161616',
    '17': '171717',
    '18': '181818',
    '19': '191919',
    '20': '202020',
    '21': '212121',
    '22': '222222',
    '23': '232323',
    '24': '242424',
    '25': '252525',
    '26': '262626',
    '27': '272727',
  };
  const staffPinCredentials: Record<string, { pinHash: string }> = {};
  for (const [id, code] of Object.entries(staffPinCodes)) {
    staffPinCredentials[id] = { pinHash: await hashPassword(code) };
  }

  // --- 직원 (고정 id upsert). 1~3 = 결재 권한자(서명 더미 필수 — D-12), 4~9 = 신청자.
  // 팀 구성은 9개 팀 × 3명(총 27명) — 총괄(관리자+사회복지사), 복지행정팀, 간호재활팀, 요양1~6팀 ---
  const employees = [
    // 총괄 (3) — 결재 권한자
    { id: 1n, name: '김평온', jobRole: 'DIRECTOR', systemRole: 'ADMIN', hireDate: new Date('2015-03-01'), canShiftWork: false, signaturePath: 'signatures/emp1.png', teamId: teams['총괄'] },
    { id: 2n, name: '박든든', jobRole: 'OFFICE_MANAGER', systemRole: 'ADMIN', hireDate: new Date('2017-05-15'), canShiftWork: false, signaturePath: 'signatures/emp2.png', teamId: teams['총괄'] },
    { id: 3n, name: '이살핌', jobRole: 'SOCIAL_WORKER', systemRole: 'STAFF', hireDate: new Date('2020-01-06'), canShiftWork: false, signaturePath: 'signatures/emp3.png', teamId: teams['총괄'] },
    // 요양1팀 (3)
    { id: 4n, name: '최정성', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2021-04-01'), teamId: teams['요양1팀'] },
    { id: 5n, name: '정보람', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2019-09-16'), teamId: teams['요양1팀'] },
    { id: 6n, name: '한슬기', jobRole: 'NURSE_AIDE', systemRole: 'STAFF', hireDate: new Date('2022-02-07'), teamId: teams['요양1팀'] },
    // 요양2팀 (3)
    { id: 7n, name: '오다정', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2018-11-12'), teamId: teams['요양2팀'] },
    { id: 8n, name: '강마루', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2023-06-19'), teamId: teams['요양2팀'] },
    // 입사 1년 미만(D-9 개근 개월 부여 케이스 확인용)
    { id: 9n, name: '윤새봄', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2026-03-02'), teamId: teams['요양2팀'] },
    // 복지행정팀 (3)
    { id: 10n, name: '임소망', jobRole: 'SOCIAL_WORKER', systemRole: 'STAFF', hireDate: new Date('2020-08-11'), teamId: teams['복지행정팀'] },
    { id: 11n, name: '서다솜', jobRole: 'SOCIAL_WORKER', systemRole: 'STAFF', hireDate: new Date('2022-05-23'), teamId: teams['복지행정팀'] },
    { id: 12n, name: '노한결', jobRole: 'CLERK', systemRole: 'STAFF', hireDate: new Date('2024-02-14'), teamId: teams['복지행정팀'] },
    // 간호재활팀 (3)
    { id: 13n, name: '문슬아', jobRole: 'NURSE', systemRole: 'STAFF', hireDate: new Date('2019-06-03'), teamId: teams['간호재활팀'] },
    { id: 14n, name: '배건강', jobRole: 'PHYSICAL_THERAPIST', systemRole: 'STAFF', hireDate: new Date('2021-11-09'), teamId: teams['간호재활팀'] },
    { id: 15n, name: '신바름', jobRole: 'OCCUPATIONAL_THERAPIST', systemRole: 'STAFF', hireDate: new Date('2023-03-27'), teamId: teams['간호재활팀'] },
    // 요양3팀 (3)
    { id: 16n, name: '조은비', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2020-04-15'), teamId: teams['요양3팀'] },
    { id: 17n, name: '남해든', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2021-09-08'), teamId: teams['요양3팀'] },
    { id: 18n, name: '백누리', jobRole: 'NURSE_AIDE', systemRole: 'STAFF', hireDate: new Date('2023-07-19'), teamId: teams['요양3팀'] },
    // 요양4팀 (3)
    { id: 19n, name: '구여울', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2019-12-02'), teamId: teams['요양4팀'] },
    { id: 20n, name: '홍바다', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2022-10-21'), teamId: teams['요양4팀'] },
    { id: 21n, name: '유하늘', jobRole: 'NURSE_AIDE', systemRole: 'STAFF', hireDate: new Date('2024-01-30'), teamId: teams['요양4팀'] },
    // 요양5팀 (3)
    { id: 22n, name: '남빛나', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2018-08-06'), teamId: teams['요양5팀'] },
    { id: 23n, name: '오소담', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2021-02-17'), teamId: teams['요양5팀'] },
    { id: 24n, name: '임온유', jobRole: 'NURSE_AIDE', systemRole: 'STAFF', hireDate: new Date('2023-05-24'), teamId: teams['요양5팀'] },
    // 요양6팀 (3)
    { id: 25n, name: '차은결', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2020-01-13'), teamId: teams['요양6팀'] },
    { id: 26n, name: '안다감', jobRole: 'CAREGIVER', systemRole: 'STAFF', hireDate: new Date('2022-07-04'), teamId: teams['요양6팀'] },
    { id: 27n, name: '표미소', jobRole: 'NURSE_AIDE', systemRole: 'STAFF', hireDate: new Date('2026-02-16'), teamId: teams['요양6팀'] },
  ] as const;
  for (const emp of employees) {
    // 로그인 계정·소속 팀은 update에도 넣는다 — 마이그레이션 이전에 만들어진 기존 행에도 반영되도록
    const credential = adminCredentials[emp.id.toString()] ?? {};
    const pinCredential = staffPinCredentials[emp.id.toString()] ?? {};
    await prisma.employee.upsert({
      where: { id: emp.id },
      update: { ...credential, ...pinCredential, teamId: emp.teamId },
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

// =============================================================
// 근무표(Phase 2) 데모 픽스처 — 2026년 7월 (docs/mock-ui/근무표 재현)
//   GET /rosters 응답 확인용. DDL v1.3 신설 필드(셀 시간 조정·유대 연동·결재 반영)를 시연한다.
//   모든 인명은 가상 인물이며, 결재 픽스처의 직원(4~9)을 그대로 사용한다.
// =============================================================

/** @db.Time(0) 매핑용 — 1970-01-01T{hhmm}:00Z Date */
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

async function seedRosterFixtures(facilityId: bigint) {
  const YEAR = 2026;
  const MONTH = 7; // 7월
  const yearMonth = `${YEAR}-${String(MONTH).padStart(2, '0')}`;
  const daysInMonth = new Date(Date.UTC(YEAR, MONTH, 0)).getUTCDate(); // 31

  // 재시드 가드: 이미 셀이 있으면 통째로 건너뛴다(로컬 완전 재시드는 migrate reset — 운영 금지)
  if ((await prisma.scheduleEntry.count()) > 0) {
    console.log('schedule_entry에 데이터가 있어 근무표 픽스처 시드를 건너뜁니다.');
    return;
  }

  // --- 월 근무표 헤더(DRAFT) ---
  const roster = await prisma.roster.upsert({
    where: { facilityId_yearMonth: { facilityId, yearMonth } },
    update: {},
    create: { facilityId, yearMonth, status: 'DRAFT' },
  });

  // --- 일별 적정 인원(§4.5, 시설 전체 기준). teamId=null은 Prisma 복합 unique upsert 불가 → findFirst 가드 ---
  const staffingRules: Array<{ period: 'DAY' | 'NIGHT'; minCount: number }> = [
    { period: 'DAY', minCount: 2 },
    { period: 'NIGHT', minCount: 1 },
  ];
  for (const rule of staffingRules) {
    const exists = await prisma.dailyStaffingRule.findFirst({
      where: { facilityId, teamId: null, period: rule.period },
    });
    if (!exists) {
      await prisma.dailyStaffingRule.create({
        data: { facilityId, teamId: null, ...rule },
      });
    }
  }

  // --- 근무유형 코드 → id 맵 ---
  const shiftTypeRows = await prisma.shiftType.findMany({
    where: { facilityId },
    select: { id: true, code: true },
  });
  const shiftId = new Map(shiftTypeRows.map((s) => [s.code, s.id]));

  // --- 유대 관리대장 1건(§4.4) — SUB 셀의 "유(이월인정시간,분)" 표기 원천(v1.3 source_ledger_id) ---
  const ledger = await prisma.substituteHolidayLedger.upsert({
    where: {
      employeeId_workedHolidayDate: {
        employeeId: 7n,
        workedHolidayDate: new Date('2026-07-06'),
      },
    },
    update: {},
    create: {
      employeeId: 7n,
      workedHolidayDate: new Date('2026-07-06'),
      workedShift: 'DAY',
      plannedUseDate: new Date('2026-07-20'),
      plannedUseShift: 'DAY',
      carryableMinutes: 150, // 유(2,30) 표기
      createdBy: 2n,
      source: 'MANUAL',
    },
  });

  // --- 교대 직원 주간 패턴(dow 0=일 … 6=토). 'N'은 직원별 야간유형(N/NF)으로 확정 ---
  const shiftEmployees = [
    { id: 4n, nightType: 'N', pattern: ['D', 'D', 'N', 'N', 'OFF', 'OFF', 'D'] },
    { id: 5n, nightType: 'N', pattern: ['N', 'N', 'OFF', 'D', 'D', 'D', 'OFF'] },
    { id: 6n, nightType: 'D', pattern: ['D', 'D', 'OFF', 'D', 'D', 'OFF', 'D'] }, // 간호조무사(주간 위주)
    { id: 7n, nightType: 'NF', pattern: ['N', 'N', 'N', 'OFF', 'OFF', 'N', 'N'] },
    { id: 8n, nightType: 'N', pattern: ['OFF', 'D', 'D', 'N', 'N', 'OFF', 'D'] },
    { id: 9n, nightType: 'NF', pattern: ['OFF', 'N', 'N', 'OFF', 'D', 'D', 'D'] },
  ] as const;

  // --- 동적 표기 예시(empId-day) — 결재 반영·시간 조정·유대 셀 시연 ---
  type Override = {
    code: string;
    source: 'MANUAL' | 'APPROVAL';
    sourceRequestId?: bigint;
    sourceLedgerId?: bigint;
    overrideStart?: string;
    overrideEnd?: string;
  };
  const overrides: Record<string, Override> = {
    // 승인된 연차(결재 #7·#8)의 근무표 확정 반영(source=APPROVAL)
    '5-10': { code: 'AL', source: 'APPROVAL', sourceRequestId: 7n },
    '6-8': { code: 'AL', source: 'APPROVAL', sourceRequestId: 8n },
    // 셀 단위 근무시간 조정(§4.8) — "주(07:30~17:00)" 표기(v1.3 override_*)
    '4-13': {
      code: 'D',
      source: 'MANUAL',
      overrideStart: '07:30',
      overrideEnd: '17:00',
    },
    // 유급휴일대체 사용 셀 — 대장 연동으로 "유(2,30)" 표기(v1.3 source_ledger_id)
    '7-20': { code: 'SUB', source: 'APPROVAL', sourceLedgerId: ledger.id },
    // 병가·결근은 관리자 직접 입력(D-18)
    '8-16': { code: 'SICK', source: 'MANUAL' },
  };

  // --- 셀 생성 ---
  let count = 0;
  for (const emp of shiftEmployees) {
    for (let day = 1; day <= daysInMonth; day++) {
      const dow = new Date(Date.UTC(YEAR, MONTH - 1, day)).getUTCDay();
      const token = emp.pattern[dow];
      let code: string = token === 'N' ? emp.nightType : token;
      const ov = overrides[`${emp.id}-${day}`];
      if (ov) code = ov.code;

      const shiftTypeId = shiftId.get(code);
      if (!shiftTypeId) throw new Error(`shift_type 코드 없음: ${code}`);

      const workDate = new Date(
        `${YEAR}-${String(MONTH).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      );
      await prisma.scheduleEntry.upsert({
        where: { employeeId_workDate: { employeeId: emp.id, workDate } },
        update: {},
        create: {
          rosterId: roster.id,
          employeeId: emp.id,
          workDate,
          shiftTypeId,
          source: ov?.source ?? 'PRESET',
          sourceRequestId: ov?.sourceRequestId ?? null,
          sourceLedgerId: ov?.sourceLedgerId ?? null,
          overrideStartTime: ov?.overrideStart ? time(ov.overrideStart) : null,
          overrideEndTime: ov?.overrideEnd ? time(ov.overrideEnd) : null,
        },
      });
      count++;
    }
  }
  console.log(`근무표 픽스처 시드 완료: ${yearMonth} 셀 ${count}건`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
