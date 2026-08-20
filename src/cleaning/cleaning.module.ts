import { Module } from '@nestjs/common';

import { ChoreSubtasksService } from './chore-subtasks.service';
import { ChoresController } from './chores.controller';
import { ChoresService } from './chores.service';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { HouseholdMembersService } from './household-members.service';
import { RotationService } from './rotation.service';

@Module({
  controllers: [CleaningController, ChoresController],
  providers: [
    RotationService,
    CleaningService,
    HouseholdMembersService,
    ChoresService,
    ChoreSubtasksService,
  ],
  exports: [RotationService, HouseholdMembersService],
})
export class CleaningModule {}
