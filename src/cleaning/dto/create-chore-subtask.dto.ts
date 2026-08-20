import { IsNotEmpty } from 'class-validator';

// position is not settable here — a new subtask always appends at the end
// (see ChoreSubtasksService.add). Reordering is a separate endpoint.
export class CreateChoreSubtaskDto {
  @IsNotEmpty()
  label!: string;
}
