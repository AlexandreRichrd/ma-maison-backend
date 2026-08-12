import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Health-check-style root route — reasonably public (e.g. for a load
  // balancer), not just an oversight of the global auth guard.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
