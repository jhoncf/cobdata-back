import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { CreateWalletDto, UpdateWalletDto, ListWalletsQueryDto } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Wallets')
@ApiBearerAuth('bearer')
@Controller()
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly prisma: PrismaService,
  ) {}

  private async assertWallet(id: string, accountId: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, accountId, deletedAt: null },
      select: { id: true },
    });
    if (!wallet) throw new NotFoundException('Carteira não encontrada');
  }

  @Get('wallets/:id/communication/templates')
  async communicationTemplates(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertWallet(id, user.accountId);
    return this.prisma.communicationTemplate.findMany({
      where: { accountId: user.accountId, OR: [{ walletId: id }, { walletId: null, isDefault: true }] },
      orderBy: [{ channel: 'asc' }, { createdAt: 'desc' }],
    });
  }

  @Post('wallets/:id/communication/templates')
  @Roles('ADMIN', 'OPERATIONAL')
  @Audit({ action: 'COMMUNICATION_TEMPLATE_CREATE', resourceType: 'Wallet' })
  async createCommunicationTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { channel: string; name: string; content: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertWallet(id, user.accountId);
    if (!['SMS', 'EMAIL', 'AI_VOICE_CALL'].includes(body.channel) || !body.name?.trim() || !body.content?.trim()) {
      throw new BadRequestException('Canal, nome e conteúdo são obrigatórios');
    }
    return this.prisma.communicationTemplate.create({
      data: { accountId: user.accountId, walletId: id, channel: body.channel, name: body.name.trim().slice(0, 120), content: body.content.trim() },
    });
  }

  @Post('wallets/:id/communication/templates/:templateId/export-default')
  @Roles('ADMIN', 'OPERATIONAL')
  async exportCommunicationTemplate(@Param('id', ParseUUIDPipe) id: string, @Param('templateId', ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertWallet(id, user.accountId);
    const template = await this.prisma.communicationTemplate.findFirst({ where: { id: templateId, accountId: user.accountId, walletId: id } });
    if (!template) throw new NotFoundException('Template não encontrado');
    return this.prisma.communicationTemplate.create({ data: { accountId: user.accountId, channel: template.channel, name: `${template.name} (padrão)`, content: template.content, isDefault: true } });
  }

  @Get('wallets/:id/communication/rules')
  async communicationRules(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertWallet(id, user.accountId);
    return this.prisma.communicationRule.findMany({ where: { accountId: user.accountId, walletId: id }, include: { template: true }, orderBy: { createdAt: 'desc' } });
  }

  @Post('wallets/:id/communication/rules')
  @Roles('ADMIN', 'OPERATIONAL')
  @Audit({ action: 'COMMUNICATION_RULE_CREATE', resourceType: 'Wallet' })
  async createCommunicationRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; schedule: Record<string, unknown>; conditions: Array<Record<string, unknown>>; templateId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertWallet(id, user.accountId);
    const frequency = String(body.schedule?.frequency);
    const time = String(body.schedule?.time);
    if (!body.name?.trim() || !['DAILY', 'WEEKLY'].includes(frequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Array.isArray(body.conditions) || body.conditions.length > 20) {
      throw new BadRequestException('A regra de comunicação está inválida');
    }
    for (const condition of body.conditions) {
      if (!['paymentStatus', 'offerValue', 'agingDays'].includes(String(condition.field)) || !['eq', 'gt', 'lt'].includes(String(condition.operator)) || condition.value === undefined || condition.value === null) throw new BadRequestException('Condição de comunicação inválida');
      if (condition.field === 'paymentStatus' && !['OPEN', 'IN_AGREEMENT', 'INSTALLMENT', 'AGREEMENT_BREACHED', 'PAID'].includes(String(condition.value))) throw new BadRequestException('Status financeiro inválido');
      if (condition.field !== 'paymentStatus' && (!Number.isFinite(Number(condition.value)) || Number(condition.value) < 0)) throw new BadRequestException('Condições numéricas devem ser positivas');
    }
    // The template is the source of truth for the communication channel.
    // This prevents a rule from declaring SMS while using an e-mail model.
    const template = await this.prisma.communicationTemplate.findFirst({ where: { id: body.templateId, accountId: user.accountId, OR: [{ walletId: id }, { walletId: null, isDefault: true }] } });
    if (!template) throw new BadRequestException('Escolha um modelo válido para esta carteira');
    return this.prisma.communicationRule.create({ data: { accountId: user.accountId, walletId: id, createdByUserId: user.id, name: body.name.trim().slice(0, 120), schedule: body.schedule as Prisma.InputJsonValue, conditions: body.conditions as Prisma.InputJsonValue, channel: template.channel, templateId: template.id }, include: { template: true } });
  }

  @Patch('wallets/:id/communication/rules/:ruleId')
  @Roles('ADMIN', 'OPERATIONAL')
  async updateCommunicationRule(@Param('id', ParseUUIDPipe) id: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() body: { active?: boolean; name?: string }, @CurrentUser() user: AuthenticatedUser) {
    await this.assertWallet(id, user.accountId);
    const rule = await this.prisma.communicationRule.findFirst({ where: { id: ruleId, accountId: user.accountId, walletId: id } });
    if (!rule) throw new NotFoundException('Regra não encontrada');
    return this.prisma.communicationRule.update({ where: { id: ruleId }, data: { ...(body.active !== undefined ? { active: body.active } : {}), ...(body.name ? { name: body.name.trim().slice(0, 120) } : {}) }, include: { template: true } });
  }

  @Delete('wallets/:id/communication/rules/:ruleId')
  @Roles('ADMIN', 'OPERATIONAL')
  async deleteCommunicationRule(@Param('id', ParseUUIDPipe) id: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertWallet(id, user.accountId);
    const rule = await this.prisma.communicationRule.findFirst({ where: { id: ruleId, accountId: user.accountId, walletId: id } });
    if (!rule) throw new NotFoundException('Regra não encontrada');
    await this.prisma.communicationRule.delete({ where: { id: ruleId } });
    return { deleted: true };
  }

  @Post('creditors/:creditorId/wallets')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'WALLET_CREATE', resourceType: 'Wallet' })
  @ApiOperation({ summary: 'Create a wallet', description: 'Create a new wallet under a creditor' })
  @ApiResponse({ status: 201, description: 'Wallet created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot create wallets' })
  @ApiResponse({ status: 404, description: 'Creditor not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async create(
    @Param('creditorId', ParseUUIDPipe) creditorId: string,
    @Body() dto: CreateWalletDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.walletsService.create(creditorId, dto, user.accountId);
  }

  @Get('wallets')
  @ApiOperation({ summary: 'List wallets', description: 'Paginated list of wallets with optional name search' })
  @ApiResponse({ status: 200, description: 'Paginated list of wallets' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(
    @Query() query: ListWalletsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const userScopes = (req as any).userScopes as string[] | undefined;
    return this.walletsService.list(query, user.accountId, userScopes);
  }

  @Get('wallets/:id')
  @ApiOperation({ summary: 'Get wallet by ID', description: 'Returns wallet details with aggregated contract summary' })
  @ApiResponse({ status: 200, description: 'Wallet details with summary' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER scope mismatch' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const userScopes = (req as any).userScopes as string[] | undefined;
    return this.walletsService.findById(id, user.accountId, userScopes);
  }

  @Patch('wallets/:id')
  @Roles('ADMIN', 'OPERATIONAL')
  @Audit({ action: 'WALLET_UPDATE', resourceType: 'Wallet' })
  @ApiOperation({ summary: 'Update a wallet', description: 'Update wallet name or status (ACTIVE/INACTIVE)' })
  @ApiResponse({ status: 200, description: 'Wallet updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot update wallets' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWalletDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.walletsService.update(id, dto, user.accountId);
  }

  @Post('wallets/:id/recalculate-offers')
  @Roles('ADMIN', 'OPERATIONAL')
  @Audit({ action: 'WALLET_OFFERS_RECALCULATED', resourceType: 'Wallet' })
  @ApiOperation({ summary: 'Recalculate wallet offers', description: 'Persists the current wallet offer rules on every unpaid active contract.' })
  async recalculateOffers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.walletsService.recalculateOffers(id, user.accountId);
  }

  @Delete('wallets/:id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'WALLET_DELETE', resourceType: 'Wallet' })
  @ApiOperation({ summary: 'Delete a wallet and its contracts', description: 'Logically deletes the wallet and all local contracts. Blocked while there are active or pending Serasa synchronizations.' })
  @ApiResponse({ status: 200, description: 'Wallet deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 409, description: 'Wallet has active or pending Serasa contracts that must be removed first' })
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.walletsService.softDelete(id, user.accountId);
    return { message: 'Wallet deleted successfully' };
  }
}
