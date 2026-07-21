import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JWT_SECRET } from '../auth/auth.constants';
import { SessionUserDto } from '../auth/dto/session-user.dto';
import { signJwt } from '../auth/jwt.util';
import { verifyPassword } from '../auth/password.util';
import { DEVICE_SESSION_TTL_SECONDS } from './devices.constants';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(JWT_SECRET) private readonly jwtSecret: string,
  ) {}

  /**
   * 관리자 발급 코드(employee.pinHash)로 기기를 등록하고 즉시 로그인시킨다(C-13/N-10).
   * 모바일 화면은 코드 6자리만 입력받고 이메일·사번을 받지 않으므로, 코드만으로 대상
   * 직원을 특정해야 한다 — ACTIVE·pinHash 보유 후보를 조회해 순서대로 scrypt 검증한다
   * (시설 1곳 규모의 대기 코드 수를 전제로 한 설계. 대량화 시 재검토 필요).
   * 코드 발급 자체(관리자 화면)는 이번 범위 밖 — Phase 0 별도 작업.
   */
  async registerDevice(
    code: string,
    deviceUid: string,
    deviceLabel: string | undefined,
  ): Promise<{ token: string; user: SessionUserDto }> {
    const candidates = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE', pinHash: { not: null } },
      select: {
        id: true,
        name: true,
        email: true,
        jobRole: true,
        systemRole: true,
        facilityId: true,
        pinHash: true,
      },
    });

    const matched = await this.findByCode(candidates, code);
    if (!matched) {
      throw new UnauthorizedException({
        code: 'INVALID_CODE',
        message: '등록 코드가 맞지 않아요. 관리자에게 다시 확인해주세요.',
      });
    }

    const existingDevice = await this.prisma.userDevice.findUnique({
      where: { deviceUid },
      select: { employeeId: true },
    });
    if (existingDevice && existingDevice.employeeId !== matched.id) {
      throw new ConflictException({
        code: 'DEVICE_ALREADY_REGISTERED',
        message: '이미 다른 직원에게 등록된 기기입니다.',
      });
    }

    const device = await this.prisma.$transaction(async (tx) => {
      // 코드로 (재)등록하면 직원의 다른 활성 기기는 해제한다 — 직원당 활성 기기 1대 원칙(엣지 7)
      await tx.userDevice.updateMany({
        where: {
          employeeId: matched.id,
          revokedAt: null,
          NOT: { deviceUid },
        },
        data: { revokedAt: new Date() },
      });

      const row = await tx.userDevice.upsert({
        where: { deviceUid },
        update: {
          deviceLabel: deviceLabel ?? null,
          revokedAt: null,
          registeredAt: new Date(),
        },
        create: { employeeId: matched.id, deviceUid, deviceLabel },
        select: { id: true },
      });

      // 코드 소진(1회용) — 재등록도 관리자가 새로 발급한 코드로만(C-13/엣지 7)
      await tx.employee.update({
        where: { id: matched.id },
        data: { pinHash: null },
      });

      return row;
    });

    const token = signJwt(
      matched.id.toString(),
      this.jwtSecret,
      DEVICE_SESSION_TTL_SECONDS,
      Date.now(),
      device.id.toString(),
    );

    return {
      token,
      user: {
        id: matched.id.toString(),
        name: matched.name,
        email: matched.email,
        jobRole: matched.jobRole,
        systemRole: matched.systemRole,
        facilityId: matched.facilityId.toString(),
      },
    };
  }

  private async findByCode<T extends { pinHash: string | null }>(
    candidates: T[],
    code: string,
  ): Promise<T | null> {
    for (const candidate of candidates) {
      if (
        candidate.pinHash &&
        (await verifyPassword(code, candidate.pinHash))
      ) {
        return candidate;
      }
    }
    return null;
  }
}
