import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

// The full ordered list of a chore's subtask ids — position is derived
// from array index, not sent explicitly (see ChoreSubtasksService.reorder,
// which rejects a set that doesn't exactly match the chore's current
// subtasks).
export class ReorderChoreSubtasksDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  subtaskIds!: string[];
}
