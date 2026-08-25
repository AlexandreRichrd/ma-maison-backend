import { IsNotEmpty } from 'class-validator';

export class RecipeStepInputDto {
  @IsNotEmpty()
  text!: string;
}
