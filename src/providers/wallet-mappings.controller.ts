import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletMappingsService } from './wallet-mappings.service';
import { CreateWalletMappingDto } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';

@ApiTags('Wallet Mappings')
@ApiBearerAuth('bearer')
@Controller('providers/:providerId/wallet-mappings')
export class WalletMappingsController {
  constructor(private readonly walletMappingsService: WalletMappingsService) {}

  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a wallet mapping', description: 'Map a local wallet to a provider external wallet ID (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Wallet mapping created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'Provider or wallet not found' })
  @ApiResponse({ status: 409, description: 'Mapping already exists for this wallet' })
  async create(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: CreateWalletMappingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.walletMappingsService.create(providerId, dto, user.accountId);
  }

  @Get()
  @Roles('ADMIN', 'OPERATIONAL')
  @ApiOperation({ summary: 'List wallet mappings', description: 'Returns all wallet mappings for a provider' })
  @ApiResponse({ status: 200, description: 'List of wallet mappings' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot list mappings' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async list(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.walletMappingsService.list(providerId, user.accountId);
  }

  @Delete(':mappingId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a wallet mapping', description: 'Remove a wallet mapping (ADMIN only)' })
  @ApiResponse({ status: 204, description: 'Wallet mapping deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'Mapping not found' })
  async delete(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('mappingId', ParseUUIDPipe) mappingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.walletMappingsService.delete(providerId, mappingId, user.accountId);
  }
}
