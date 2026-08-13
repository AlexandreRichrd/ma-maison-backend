import { Module } from '@nestjs/common';

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
  ],
  exports: [RotationService, HouseholdMembersService],
})
export class CleaningModule {}
