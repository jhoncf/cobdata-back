import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
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
import { CreditorsService } from './creditors.service';
import { CreateCreditorDto, UpdateCreditorDto, ListCreditorsQueryDto, UpsertCommercialRulesDto } from './dto';
import { InviteCreditorUserDto } from '../users/dto';
import { UsersService } from '../users/users.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { Request } from 'express';

@ApiTags('Creditors')
@ApiBearerAuth('bearer')
@Controller('creditors')
export class CreditorsController {
  constructor(private readonly creditorsService: CreditorsService, private readonly usersService: UsersService) {}

  @Get(':id/users')
  @Roles('ADMIN')
  async listPortalUsers(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listCreditorUsers(id, user.accountId);
  }

  @Post(':id/users/invite')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async invitePortalUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InviteCreditorUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.inviteCreditorUser(id, dto, user.accountId);
  }

  @Post()
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREDITOR_CREATE', resourceType: 'Creditor' })
  @ApiOperation({ summary: 'Create a creditor', description: 'Register a new creditor with name, CNPJ, contacts and address' })
  @ApiResponse({ status: 201, description: 'Creditor created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot create creditors' })
  @ApiResponse({ status: 409, description: 'CNPJ already in use' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async create(
    @Body() dto: CreateCreditorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.creditorsService.create(dto, user.accountId);
  }

  @Get()
  @ApiOperation({ summary: 'List creditors', description: 'Paginated list of creditors with optional search by name/CNPJ' })
  @ApiResponse({ status: 200, description: 'Paginated list of creditors' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(
    @Query() query: ListCreditorsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    // Task 6.4: Pass userScopes for VIEWER filtering
    const userScopes = (req as any).userScopes as string[] | undefined;
    return this.creditorsService.list(query, user.accountId, userScopes);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get creditor by ID', description: 'Returns creditor details including name, CNPJ, contacts and address' })
  @ApiResponse({ status: 200, description: 'Creditor details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Creditor not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.creditorsService.findById(id, user.accountId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATIONAL')
  @Audit({ action: 'CREDITOR_UPDATE', resourceType: 'Creditor' })
  @ApiOperation({ summary: 'Update a creditor', description: 'Update creditor name, CNPJ, contacts or address' })
  @ApiResponse({ status: 200, description: 'Creditor updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot update creditors' })
  @ApiResponse({ status: 404, description: 'Creditor not found' })
  @ApiResponse({ status: 409, description: 'CNPJ already in use' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreditorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.creditorsService.update(id, dto, user.accountId);
  }

  @Get(':id/commercial-rules')
  @ApiOperation({ summary: 'Get creditor discount and commission bands' })
  async getCommercialRules(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.creditorsService.getCommercialRules(id, user.accountId);
  }

  @Put(':id/commercial-rules')
  @Roles('ADMIN', 'OPERATIONAL')
  @Audit({ action: 'CREDITOR_COMMERCIAL_RULES_UPDATE', resourceType: 'Creditor' })
  @ApiOperation({ summary: 'Replace creditor discount and commission bands' })
  async upsertCommercialRules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertCommercialRulesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.creditorsService.upsertCommercialRules(id, dto, user.accountId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'CREDITOR_DELETE', resourceType: 'Creditor' })
  @ApiOperation({ summary: 'Soft-delete a creditor', description: 'Logically delete a creditor and cascade to wallets (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Creditor deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'Creditor not found' })
  @ApiResponse({ status: 409, description: 'Creditor has wallets with contracts' })
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.creditorsService.softDelete(id, user.accountId);
    return { message: 'Creditor deleted successfully' };
  }
}
