import { Global, Module } from '@nestjs/common';
import { DomainEventBus } from './domain-event-bus';

/// 도메인 이벤트 버스를 전역 제공. 발행자(ApprovalsService)와 구독자(RosterReflectionService)가
/// 모듈 경계를 넘어 같은 버스 인스턴스를 주입받는다.
@Global()
@Module({
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class EventsModule {}
