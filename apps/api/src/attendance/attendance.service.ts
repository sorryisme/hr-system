import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AttendanceMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceTodayResponseDto } from './dto/attendance-today.dto';
import { ClockTagRequestDto } from './dto/clock-tag-request.dto';
import { ClockTagResponseDto } from './dto/clock-tag-response.dto';
import { AttendanceShiftSummaryDto } from './dto/shift-summary.dto';

const EARTH_RADIUS_M = 6371000;
const DEFAULT_GPS_RADIUS_M = 100;

type ScheduleEntryWithShift = Prisma.ScheduleEntryGetPayload<{
  include: { shiftType: true };
}>;

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function toHm(t: Date | null): string | null {
  return t ? t.toISOString().slice(11, 16) : null;
}

/// Haversine 공식 — 두 좌표 사이 직선거리(m)
function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getToday(
    employeeId: bigint,
    facilityId: bigint,
  ): Promise<AttendanceTodayResponseDto> {
    const [openRecord, facility] = await Promise.all([
      this.findOpenRecord(employeeId),
      this.prisma.facility.findUnique({ where: { id: facilityId } }),
    ]);

    // 열린 기록이 있으면 그 근무(귀속일 기준)를, 없으면 오늘 배정된 근무를 보여준다
    const shiftDate = openRecord
      ? openRecord.workDate
      : startOfUtcDay(new Date());
    const entry = await this.findScheduleEntry(employeeId, shiftDate);

    return {
      status: openRecord ? 'CLOCKED_IN' : 'CLOCKED_OUT',
      clockInAt: openRecord ? openRecord.clockInAt!.toISOString() : null,
      shift: entry ? this.toShiftSummary(entry) : null,
      adminCallPhone: facility?.adminCallPhone ?? null,
    };
  }

  /// GPS 반경 안이면 출근 태그. workDate는 태그 시점의 달력일 — 야간근무는 시작일에 태그하므로
  /// 별도 보정 없이 자연히 "귀속일=시작일"이 된다(퇴근은 workDate가 아닌 열린 기록으로 찾는다).
  async clockIn(
    employeeId: bigint,
    facilityId: bigint,
    dto: ClockTagRequestDto,
  ): Promise<ClockTagResponseDto> {
    await this.assertWithinRadius(facilityId, dto.lat, dto.lng);

    const openRecord = await this.findOpenRecord(employeeId);
    if (openRecord) {
      throw new ConflictException({
        code: 'ALREADY_CLOCKED_IN',
        message: '이미 출근 처리되었어요.',
      });
    }

    const now = new Date();
    try {
      const created = await this.prisma.attendanceRecord.create({
        data: {
          employeeId,
          workDate: startOfUtcDay(now),
          clockInAt: now,
          inLat: dto.lat,
          inLng: dto.lng,
          method: AttendanceMethod.GPS,
        },
      });
      return { clockAt: created.clockInAt!.toISOString() };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'ALREADY_TAGGED_TODAY',
          message: '오늘 근무 기록이 이미 있어요.',
        });
      }
      throw error;
    }
  }

  async clockOut(
    employeeId: bigint,
    facilityId: bigint,
    dto: ClockTagRequestDto,
  ): Promise<ClockTagResponseDto> {
    await this.assertWithinRadius(facilityId, dto.lat, dto.lng);

    const openRecord = await this.findOpenRecord(employeeId);
    if (!openRecord) {
      throw new ConflictException({
        code: 'NOT_CLOCKED_IN',
        message: '출근 기록이 없어요.',
      });
    }

    const now = new Date();
    const entry = await this.findScheduleEntry(employeeId, openRecord.workDate);
    const breakMinutes = entry?.shiftType.breakMinutes ?? 0;
    const rawMinutes = Math.max(
      0,
      Math.round((now.getTime() - openRecord.clockInAt!.getTime()) / 60000),
    );
    const actualMinutes = Math.max(0, rawMinutes - breakMinutes);
    const holiday = await this.prisma.publicHoliday.findUnique({
      where: { holidayDate: openRecord.workDate },
    });

    const updated = await this.prisma.attendanceRecord.update({
      where: { id: openRecord.id },
      data: {
        clockOutAt: now,
        outLat: dto.lat,
        outLng: dto.lng,
        actualMinutes,
        isHolidayWork: Boolean(holiday),
      },
    });

    return { clockAt: updated.clockOutAt!.toISOString() };
  }

  // ---------------------------------------------------------------
  // 내부 유틸
  // ---------------------------------------------------------------

  private findOpenRecord(employeeId: bigint) {
    return this.prisma.attendanceRecord.findFirst({
      where: { employeeId, clockOutAt: null },
      orderBy: { clockInAt: 'desc' },
    });
  }

  private findScheduleEntry(
    employeeId: bigint,
    workDate: Date,
  ): Promise<ScheduleEntryWithShift | null> {
    return this.prisma.scheduleEntry.findFirst({
      where: { employeeId, workDate },
      include: { shiftType: true },
    });
  }

  private toShiftSummary(
    entry: ScheduleEntryWithShift,
  ): AttendanceShiftSummaryDto {
    return {
      label: entry.shiftType.label,
      startTime: toHm(entry.overrideStartTime ?? entry.shiftType.startTime),
      endTime: toHm(entry.overrideEndTime ?? entry.shiftType.endTime),
      crossesMidnight: entry.shiftType.crossesMidnight,
    };
  }

  /// GPS 미설정 시설은 태그를 막는다 — 임의 허용보다는 관리자 설정 확인을 유도하는 쪽을 택함
  private async assertWithinRadius(
    facilityId: bigint,
    lat: number,
    lng: number,
  ): Promise<void> {
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
    });
    if (!facility?.gpsLat || !facility.gpsLng) {
      throw new BadRequestException({
        code: 'FACILITY_GPS_NOT_CONFIGURED',
        message: '시설 위치가 설정되어 있지 않아요. 관리자에게 문의하세요.',
      });
    }

    const distance = distanceMeters(
      Number(facility.gpsLat),
      Number(facility.gpsLng),
      lat,
      lng,
    );
    const radius = facility.gpsRadiusM ?? DEFAULT_GPS_RADIUS_M;
    if (distance > radius) {
      throw new BadRequestException({
        code: 'OUT_OF_RANGE',
        message: '요양원에서 너무 멀리 있어요. 건물 근처에서 다시 눌러주세요.',
      });
    }
  }
}
