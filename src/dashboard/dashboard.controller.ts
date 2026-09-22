import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('today')
  @ApiOperation({ summary: 'Resumo operacional do dia' })
  today(
    @CurrentUser() user: AuthenticatedUser,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.dashboardService.today(user.accountId, user.creditorId ?? creditorId, walletId);
  }

  @Get('agreement-history')
  @ApiOperation({ summary: 'Histórico consolidado de acordos dos últimos 30 dias' })
  agreementHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.dashboardService.agreementHistory(user.accountId, user.creditorId ?? creditorId, walletId);
  }
}
