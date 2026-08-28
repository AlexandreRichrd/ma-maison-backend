import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class UpdateMemberOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  memberOrder!: string[];
}
