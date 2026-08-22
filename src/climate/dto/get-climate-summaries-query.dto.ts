import { IsNotEmpty } from 'class-validator';

import { IsIsoDate } from '../../cleaning/dto/is-iso-date.decorator';

// Reuses cleaning's IsIsoDate ('YYYY-MM-DD', a real calendar date) rather
// than a second copy of the same check — see iso-date.util.ts's comment on
// why this app never uses date-fns's parseISO for a bare date string.
export class GetClimateSummariesQueryDto {
  @IsNotEmpty()
  deviceName!: string;

  @IsIsoDate()
  from!: string;

  @IsIsoDate()
  to!: string;
}
