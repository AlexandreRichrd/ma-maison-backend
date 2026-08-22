import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CreateReminderDto } from './dto/create-reminder.dto';
import { GetRemindersQueryDto } from './dto/get-reminders-query.dto';
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

  // from/to are optional — the flat list view still asks for everything.
  // The week/month calendar views pass both, so only ~7 or ~42 days of
  // reminders are fetched instead of the household's whole history.
  @Get('reminders')
  list(@Query() query: GetRemindersQueryDto) {
    return this.reminders.list(query.from, query.to);
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
