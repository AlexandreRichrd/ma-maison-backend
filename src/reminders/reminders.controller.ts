import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { CreateReminderDto } from './dto/create-reminder.dto';
import { RemindersService } from './reminders.service';

@Controller()
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  // Before the plain GET /reminders below so it isn't ever shadowed by it —
  // same convention as shopping-lists/add-ingredients.
  @Get('reminders/due-today')
  dueToday() {
    return this.reminders.dueToday();
  }

  @Get('reminders')
  list() {
    return this.reminders.list();
  }

  @Post('reminders')
  create(@Body() dto: CreateReminderDto) {
    return this.reminders.create(dto);
  }

  @HttpCode(204)
  @Patch('reminders/:id/toggle')
  toggle(@Param('id', ParseUUIDPipe) id: string) {
    return this.reminders.toggle(id);
  }
}
