import { Module } from '@nestjs/common';
import { RosterController } from './roster.controller';
import { RosterReflectionService } from './roster-reflection.service';
import { RosterStateService } from './roster-state.service';
import { RosterService } from './roster.service';

@Module({
  controllers: [RosterController],
  providers: [RosterService, RosterStateService, RosterReflectionService],
})
export class RosterModule {}
