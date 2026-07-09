import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.upsert({
    where: { id: 1n },
    update: {},
    create: { id: 1n, name: '샘플요양원', capacity: 60 },
  });

  const shiftTypes = [
    { code: 'D', label: '주간', startTime: new Date('1970-01-01T09:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'), breakMinutes: 60, crossesMidnight: false, countsAsWork: true, recognizedHours: null, sortOrder: 1 },
    { code: 'N', label: '야간', startTime: new Date('1970-01-01T22:00:00Z'), endTime: new Date('1970-01-01T07:00:00Z'), breakMinutes: 60, crossesMidnight: true, countsAsWork: true, recognizedHours: null, sortOrder: 2 },
    { code: 'OFF', label: '휴무', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedHours: null, sortOrder: 3 },
    { code: 'AL', label: '연차', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedHours: 8.0, sortOrder: 4 },
    { code: 'HAM', label: '오전반차', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedHours: 4.0, sortOrder: 5 },
    { code: 'HPM', label: '오후반차', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedHours: 4.0, sortOrder: 6 },
    // 유급휴일대체. 공단 인정시간은 §4.4 규칙(당월 기준시간 초과분·최대 8h)으로 앱에서 별도 산정
    { code: 'SUB', label: '휴일대체', startTime: null, endTime: null, breakMinutes: 0, crossesMidnight: false, countsAsWork: false, recognizedHours: 8.0, sortOrder: 7 },
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
