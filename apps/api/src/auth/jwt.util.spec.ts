import { signJwt, verifyJwt } from './jwt.util';

describe('jwt.util', () => {
  const secret = 'test-secret';

  it('서명한 토큰을 검증하면 페이로드가 복원된다', () => {
    const now = 1_760_000_000_000;
    const token = signJwt('42', secret, 3600, now);
    const payload = verifyJwt(token, secret, now + 1000);
    expect(payload).toEqual({
      sub: '42',
      iat: 1_760_000_000,
      exp: 1_760_003_600,
    });
  });

  it('만료된 토큰은 거부한다', () => {
    const now = 1_760_000_000_000;
    const token = signJwt('42', secret, 3600, now);
    expect(verifyJwt(token, secret, now + 3600_001)).toBeNull();
  });

  it('다른 시크릿으로 서명된 토큰은 거부한다', () => {
    const token = signJwt('42', 'other-secret', 3600);
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it('페이로드가 변조된 토큰은 거부한다', () => {
    const token = signJwt('42', secret, 3600);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: '1', iat: 0, exp: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyJwt(`${header}.${forged}.${signature}`, secret)).toBeNull();
  });

  it('형식이 잘못된 토큰은 거부한다', () => {
    expect(verifyJwt('not-a-jwt', secret)).toBeNull();
    expect(verifyJwt('a.b', secret)).toBeNull();
    expect(verifyJwt('', secret)).toBeNull();
  });
});
