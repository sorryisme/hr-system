import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('throws if DATABASE_URL is not provided', () => {
    expect(() => new PrismaService(undefined)).toThrow(
      'DATABASE_URL is not set',
    );
  });

  it('constructs without connecting when DATABASE_URL is provided', () => {
    expect(
      () => new PrismaService('mysql://user:pass@localhost:3306/db'),
    ).not.toThrow();
  });
});
