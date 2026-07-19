import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('해시한 비밀번호는 원문으로 검증된다', async () => {
    const stored = await hashPassword('secret-1234');
    expect(stored.startsWith('scrypt:')).toBe(true);
    await expect(verifyPassword('secret-1234', stored)).resolves.toBe(true);
  });

  it('다른 비밀번호는 거부한다', async () => {
    const stored = await hashPassword('secret-1234');
    await expect(verifyPassword('secret-12345', stored)).resolves.toBe(false);
  });

  it('같은 비밀번호라도 솔트가 달라 해시가 매번 다르다', async () => {
    const a = await hashPassword('secret-1234');
    const b = await hashPassword('secret-1234');
    expect(a).not.toBe(b);
  });

  it('저장 형식이 깨진 값은 거부한다', async () => {
    await expect(verifyPassword('x', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt:a:b')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });
});
