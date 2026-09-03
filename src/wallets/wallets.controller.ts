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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { CreateWalletDto, UpdateWalletDto, ListWalletsQueryDto } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { Request } from 'express';

@ApiTags('Wallets')
@ApiBearerAuth('bearer')
@Controller()
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

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
  @ApiOperation({ summary: 'Soft-delete a wallet', description: 'Logically delete a wallet (ADMIN only, must have no contracts)' })
  @ApiResponse({ status: 200, description: 'Wallet deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 409, description: 'Wallet has contracts that must be removed first' })
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.walletsService.softDelete(id, user.accountId);
    return { message: 'Wallet deleted successfully' };
  }
}
