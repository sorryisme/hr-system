import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
