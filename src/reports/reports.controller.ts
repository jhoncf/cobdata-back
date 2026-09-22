import { Controller, Get, Header, Query } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Acordos pagos pela Serasa no período' })
  serasaAgreements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.reportsService.serasaAgreements(user.accountId, user.creditorId ?? creditorId, startDate, endDate, page, limit, walletId);
  }

  @Get('serasa-agreements/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="acordos-pagos-serasa.csv"')
  @ApiOperation({ summary: 'Exporta os acordos pagos pela Serasa no período' })
  exportSerasaAgreements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.reportsService.exportSerasaAgreements(user.accountId, user.creditorId ?? creditorId, startDate, endDate, walletId);
  }

  @Get('filters')
  @ApiOperation({ summary: 'Opções de filtros para relatórios' })
  filters(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.filters(user.accountId, user.creditorId ?? undefined);
  }

  @Get('pix-payments')
  @ApiOperation({ summary: 'Pagamentos Pix diretos para a CobCom no período' })
  pixPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.reportsService.pixPayments(user.accountId, user.creditorId ?? creditorId, startDate, endDate, page, limit, walletId);
  }

  @Get('complaints')
  @ApiOperation({ summary: 'Contratos removidos por reclamação ou contestação no período' })
  complaints(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.reportsService.complaints(user.accountId, user.creditorId ?? creditorId, startDate, endDate, page, limit, walletId);
  }

  @Get('pix-payments/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pagamentos-pix-cobcom.csv"')
  @ApiOperation({ summary: 'Exporta os pagamentos Pix diretos para a CobCom no período' })
  exportPixPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.reportsService.exportPixPayments(user.accountId, user.creditorId ?? creditorId, startDate, endDate, walletId);
  }

  @Get('communications')
  @ApiOperation({ summary: 'Comunicações visualizadas ou atendidas no período' })
  communications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('creditorId') creditorId?: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.reportsService.communications(user.accountId, user.creditorId ?? creditorId, startDate, endDate, page, limit, walletId);
  }
}
