import { IsNotEmpty, MinLength } from 'class-validator';

import { Match } from '../../common/match.decorator';

export class RegisterDto {
  @IsNotEmpty()
  token!: string;

  @IsNotEmpty()
  name!: string;

  @MinLength(8)
  password!: string;

  @IsNotEmpty()
  @Match('password')
  confirmPassword!: string;
}
