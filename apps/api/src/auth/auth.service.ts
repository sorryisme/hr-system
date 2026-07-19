import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JWT_SECRET, TOKEN_TTL_SECONDS } from './auth.constants';
import { SessionUserDto } from './dto/session-user.dto';
import { signJwt } from './jwt.util';
import { verifyPassword } from './password.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(JWT_SECRET) private readonly jwtSecret: string,
  ) {}

  /**
   * 관리자 웹 로그인. 종사자(STAFF)는 모바일 기기 등록 + PIN 인증(C-13, 별도 Phase)
   * 대상이라 여기서는 거부한다. 계정 존재 여부가 새어나가지 않도록 이메일 오류와
   * 비밀번호 오류는 같은 응답(INVALID_CREDENTIALS)으로 처리한다.
   */
  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: SessionUserDto }> {
    const employee = await this.prisma.employee.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        jobRole: true,
        systemRole: true,
        facilityId: true,
        status: true,
        passwordHash: true,
      },
    });

    const passwordOk =
      employee?.passwordHash != null &&
      (await verifyPassword(password, employee.passwordHash));
    if (!employee || !passwordOk) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '아이디 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    if (employee.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: '사용할 수 없는 계정입니다. 시설 관리자에게 문의해 주세요.',
      });
    }

    if (
      employee.systemRole !== 'ADMIN' &&
      employee.systemRole !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException({
        code: 'ADMIN_ONLY',
        message: '관리자 계정만 로그인할 수 있습니다.',
      });
    }

    const token = signJwt(
      employee.id.toString(),
      this.jwtSecret,
      TOKEN_TTL_SECONDS,
    );
    return {
      token,
      user: {
        id: employee.id.toString(),
        name: employee.name,
        // 위 분기에서 passwordHash와 함께 존재가 보장되지만 타입상 nullable
        email: employee.email ?? email,
        jobRole: employee.jobRole,
        systemRole: employee.systemRole,
        facilityId: employee.facilityId.toString(),
      },
    };
  }
}
