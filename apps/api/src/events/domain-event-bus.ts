import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/// 프로세스 내(in-process) 도메인 이벤트 버스.
/// 외부 큐/브로커 없이 Node 내장 EventEmitter만 감싼다(신규 의존성 없음 — CLAUDE.md).
/// 발행자(결재)와 구독자(근무표 반영)를 느슨히 결합해, 결재 코드 수정 없이 구독자를 늘릴 수 있게 한다(§2.3).
/// 핸들러는 발행 트랜잭션 커밋 이후에 호출되어야 한다(발행부가 $transaction 밖에서 publish).
/// payload 타입은 event 이름별로 다를 수 있어(ApprovalReflectionPayload/ApprovalRevertPayload)
/// 호출부 제네릭으로 지정한다 — 버스 자체는 이벤트 이름과 타입을 묶어 검증하지 않는다.
@Injectable()
export class DomainEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // 구독자가 늘어도 경고가 나지 않도록 여유를 둔다(누수 감시 자체는 유지)
    this.emitter.setMaxListeners(50);
  }

  publish<T>(event: string, payload: T): void {
    this.emitter.emit(event, payload);
  }

  subscribe<T>(
    event: string,
    handler: (payload: T) => void | Promise<void>,
  ): void {
    // 핸들러 내부에서 자체적으로 예외를 처리한다(구독자 실패가 다른 구독자·발행자에 전파되지 않도록)
    this.emitter.on(event, (payload: T) => {
      void handler(payload);
    });
  }
}
