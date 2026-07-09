declare global {
  interface BigInt {
    toJSON(): string;
  }
}

/**
 * Prisma의 BigInt(id 등)는 기본 JSON.stringify가 직렬화하지 못해 응답 시 예외를 던진다.
 * 컨트롤러가 Prisma 엔티티를 그대로 반환할 때 필요.
 */
export function patchBigIntJson(): void {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}
