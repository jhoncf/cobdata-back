import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Audit, Public, Roles } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { LigueLeadService } from './liguelead.service';
import { SendLigueLeadCallsDto, SendLigueLeadSmsDto, UpsertLigueLeadAgentDto } from './dto';

@ApiTags('LigueLead') @ApiBearerAuth('bearer') @Controller()
export class LigueLeadController {
  constructor(private readonly service: LigueLeadService) {}
  private scopes(req: any) { return req.userScopes as string[] | undefined; }
  @Get('liguelead/voices') @Roles('ADMIN', 'OPERATIONAL') voices() { return this.service.listVoices(); }
  @Get('wallets/:walletId/liguelead-agent') agent(@Param('walletId', ParseUUIDPipe) walletId: string, @CurrentUser() u: AuthenticatedUser, @Req() req: any) { return this.service.getAgent(walletId, u.accountId, this.scopes(req)); }
  @Put('wallets/:walletId/liguelead-agent') @Roles('ADMIN', 'OPERATIONAL') @Audit({ action: 'LIGUELEAD_AGENT_UPSERT', resourceType: 'Wallet' }) upsert(@Param('walletId', ParseUUIDPipe) walletId: string, @Body() dto: UpsertLigueLeadAgentDto, @CurrentUser() u: AuthenticatedUser, @Req() req: any) { return this.service.upsertAgent(walletId, u.accountId, dto, this.scopes(req)); }
  @Post('wallets/:walletId/liguelead/sms') @Roles('ADMIN', 'OPERATIONAL') @Audit({ action: 'LIGUELEAD_SMS_DISPATCH', resourceType: 'Wallet' }) sms(@Param('walletId', ParseUUIDPipe) walletId: string, @Body() dto: SendLigueLeadSmsDto, @CurrentUser() u: AuthenticatedUser, @Req() req: any) { return this.service.sendSms(walletId, u.accountId, u.id, dto, this.scopes(req)); }
  @Post('wallets/:walletId/liguelead/calls') @Roles('ADMIN', 'OPERATIONAL') @Audit({ action: 'LIGUELEAD_CALL_DISPATCH', resourceType: 'Wallet' }) calls(@Param('walletId', ParseUUIDPipe) walletId: string, @Body() dto: SendLigueLeadCallsDto, @CurrentUser() u: AuthenticatedUser, @Req() req: any) { return this.service.sendCalls(walletId, u.accountId, u.id, dto, this.scopes(req)); }
  @Post('webhooks/liguelead') @Public() @HttpCode(200) webhook(@Body() payload: any, @Headers('authorization-token') authorizationToken?: string, @Headers('x-webhook-token') xWebhookToken?: string, @Headers('authorization') authorization?: string, @Query('token') queryToken?: string) { const bearer = authorization?.replace(/^Bearer\s+/i, ''); return this.service.processWebhook(authorizationToken ?? xWebhookToken ?? bearer ?? queryToken, payload); }
}
