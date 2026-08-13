import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsUUID,
} from 'class-validator';

export class CreateReminderDto {
  @IsNotEmpty()
  title!: string;

  @IsISO8601()
  dueAt!: string;

  // 0-2 assignees — see prisma/schema.prisma's Reminder.assigneeIds comment.
  @IsArray()
  @ArrayMaxSize(2)
  @IsUUID(undefined, { each: true })
  assigneeIds!: string[];
}
