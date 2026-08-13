import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { OperationsService } from './operations.service';
import { CreateOperationDto, ListOperationsDto, PreviewOperationDto } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';

@ApiTags('Operations')
@ApiBearerAuth('bearer')
@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Post()
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'OPERATION_CREATE', resourceType: 'Operation' })
  @ApiOperation({ summary: 'Create a provider operation', description: 'Select eligible contracts from a wallet and create a bulk operation to send/remove from provider' })
  @ApiResponse({ status: 201, description: 'Operation created with items queued for processing' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot create operations' })
  @ApiResponse({ status: 422, description: 'Validation error or no eligible contracts' })
  async create(
    @Body() dto: CreateOperationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.operationsService.create({
      walletId: dto.walletId,
      action: dto.action,
      userId: user.id,
      accountId: user.accountId,
    });
  }

  @Get()
  @Roles('ADMIN', 'OPERATIONAL', 'VIEWER')
  @ApiOperation({ summary: 'List operations', description: 'Paginated list of provider operations with optional filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of operations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @Query() query: ListOperationsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const scopes = (req as any).userScopes as string[] | undefined;
    return this.operationsService.findAll(
      { page: query.page, limit: query.limit, walletId: query.walletId, status: query.status },
      user.accountId,
      scopes,
    );
  }

  @Get('preview')
  @Roles('ADMIN', 'OPERATIONAL')
  @ApiOperation({ summary: 'Preview eligible contracts', description: 'Returns a count of contracts eligible for a provider operation without creating one' })
  @ApiResponse({ status: 200, description: 'Preview of eligible contracts count' })
  @ApiResponse({ status: 422, description: 'Wallet not found or not mapped' })
  async preview(
    @Query() query: PreviewOperationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.operationsService.preview(query.walletId, query.action, user.accountId);
  }

  @Get(':id')
  @Roles('ADMIN', 'OPERATIONAL', 'VIEWER')
  @ApiOperation({ summary: 'Get operation by ID', description: 'Returns operation details with item statuses' })
  @ApiResponse({ status: 200, description: 'Operation details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Operation not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const scopes = (req as any).userScopes as string[] | undefined;
    return this.operationsService.findOne(id, user.accountId, scopes);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'OPERATION_CANCEL', resourceType: 'Operation' })
  @ApiOperation({ summary: 'Cancel an operation', description: 'Cancel a pending or in-progress operation' })
  @ApiResponse({ status: 200, description: 'Operation cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot cancel operations' })
  @ApiResponse({ status: 404, description: 'Operation not found' })
  @ApiResponse({ status: 409, description: 'Operation cannot be cancelled in current state' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.operationsService.cancel(id, user.accountId);
  }
}
