import { IsNotEmpty, MinLength } from 'class-validator';

import { Match } from '../../common/match.decorator';

export class ResetPasswordDto {
  @IsNotEmpty()
  token!: string;

  @MinLength(8)
  password!: string;

  @IsNotEmpty()
  @Match('password')
  confirmPassword!: string;
}
