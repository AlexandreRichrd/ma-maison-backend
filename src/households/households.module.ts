import { Module } from '@nestjs/common';

import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';

// Owns: GET /households/me (users + member_order). Creation/growth of the
// household itself is still auth's concern (invites, register) — see
// auth.module.ts.
@Module({
  controllers: [HouseholdsController],
  providers: [HouseholdsService],
})
export class HouseholdsModule {}
