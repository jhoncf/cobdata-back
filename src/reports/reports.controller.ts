import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('bearer')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('serasa-agreements')
  @ApiOperation({ summary: 'Acordos fechados pela Serasa no período' })
  serasaAgreements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.serasaAgreements(user.accountId, user.creditorId ?? undefined, startDate, endDate);
  }

  @Get('pix-payments')
  @ApiOperation({ summary: 'Pagamentos Pix diretos para a CobCom no período' })
  pixPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.pixPayments(user.accountId, user.creditorId ?? undefined, startDate, endDate);
  }

  @Get('communications')
  @ApiOperation({ summary: 'Comunicações visualizadas ou atendidas no período' })
  communications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.communications(user.accountId, user.creditorId ?? undefined, startDate, endDate);
  }
}
