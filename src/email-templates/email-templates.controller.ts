import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { EmailTemplatesService } from './email-templates.service';

@ApiTags('Templates de e-mail') @ApiBearerAuth('bearer') @Controller()
export class EmailTemplatesController {
  constructor(private readonly service: EmailTemplatesService) {}
  @Get('wallets/:walletId/email-templates') list(@Param('walletId', ParseUUIDPipe) walletId: string, @CurrentUser() u: AuthenticatedUser) { return this.service.list(walletId, u.accountId); }
  @Post('wallets/:walletId/email-templates') @Roles('ADMIN', 'OPERATIONAL') create(@Param('walletId', ParseUUIDPipe) walletId: string, @Body() dto: any, @CurrentUser() u: AuthenticatedUser) { return this.service.save(walletId, u.accountId, dto); }
  @Put('wallets/:walletId/email-templates/:id') @Roles('ADMIN', 'OPERATIONAL') update(@Param('walletId', ParseUUIDPipe) walletId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @CurrentUser() u: AuthenticatedUser) { return this.service.save(walletId, u.accountId, dto, id); }
  @Delete('wallets/:walletId/email-templates/:id') @Roles('ADMIN', 'OPERATIONAL') remove(@Param('walletId', ParseUUIDPipe) walletId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.service.remove(walletId, u.accountId, id); }
  @Post('wallets/:walletId/email-templates/:templateId/send') @Roles('ADMIN', 'OPERATIONAL') send(@Param('walletId', ParseUUIDPipe) walletId: string, @Param('templateId', ParseUUIDPipe) templateId: string, @Body() dto: { contractIds: string[] }, @CurrentUser() u: AuthenticatedUser) { return this.service.sendBatch(walletId, u.accountId, templateId, dto.contractIds); }
  @Post('wallets/:walletId/email-templates/:templateId/send-filtered') @Roles('ADMIN', 'OPERATIONAL') sendFiltered(@Param('walletId', ParseUUIDPipe) walletId: string, @Param('templateId', ParseUUIDPipe) templateId: string, @Body() dto: { filters?: Record<string, unknown> }, @CurrentUser() u: AuthenticatedUser) { return this.service.sendFiltered(walletId, u.accountId, templateId, dto.filters as Record<string, any>); }
  @Post('wallets/:walletId/email-templates/:templateId/send-test') @Roles('ADMIN', 'OPERATIONAL') sendTest(@Param('walletId', ParseUUIDPipe) walletId: string, @Param('templateId', ParseUUIDPipe) templateId: string, @Body() dto: { destinationEmail: string }, @CurrentUser() u: AuthenticatedUser) { return this.service.sendTest(walletId, u.accountId, templateId, dto.destinationEmail); }
  @Get('email/tracking/open/:token.gif') @Public() @HttpCode(200) async open(@Param('token') token: string, @Res() response: Response) { await this.service.mark(token, 'OPEN').catch(() => undefined); response.type('gif').send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')); }
  @Get('email/tracking/click/:token') @Public() async click(@Param('token') token: string, @Query('to') to: string, @Res() response: Response) { await this.service.mark(token, 'CLICK').catch(() => undefined); return response.redirect(to); }
}
