import { IsNotEmpty } from 'class-validator';

export class UpdateChoreSubtaskDto {
  @IsNotEmpty()
  label!: string;
}
