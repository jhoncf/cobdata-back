import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';

@ApiTags('Contracts')
@ApiBearerAuth('bearer')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CONTRACT_CREATE', resourceType: 'Contract' })
  @ApiOperation({ summary: 'Create or update a contract', description: 'Create a new contract or update existing one via deduplication key' })
  @ApiResponse({ status: 201, description: 'Contract created or updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot create contracts' })
  @ApiResponse({ status: 409, description: 'Contract exists in another wallet' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async create(
    @Body() dto: CreateContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contractsService.createOrUpdate(dto, user.accountId);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List contracts', description: 'Paginated list of contracts with filters (wallet, creditor, status, date range, document)' })
  @ApiResponse({ status: 200, description: 'Paginated list of contracts' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(
    @Query() query: ListContractsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: any,
  ) {
    // Extract user scopes from request (set by ScopeGuard for VIEWERs)
    const userScopes: string[] | undefined = req.userScopes;
    return this.contractsService.list(query, user.accountId, user.role, userScopes);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a contract by ID', description: 'Retrieve a single contract with wallet and creditor data' })
  @ApiResponse({ status: 200, description: 'Contract found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: any,
  ) {
    const userScopes: string[] | undefined = req.userScopes;
    return this.contractsService.findById(id, user.accountId, user.role, userScopes);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'CONTRACT_UPDATE', resourceType: 'Contract' })
  @ApiOperation({ summary: 'Update a contract', description: 'Update editable contract fields (only when serasaStatus is PENDING, FAILED or REMOVED)' })
  @ApiResponse({ status: 200, description: 'Contract updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot update contracts' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @ApiResponse({ status: 409, description: 'Contract must be removed from provider before editing' })
  @ApiResponse({ status: 422, description: 'Validation error (invalid wallet or fields)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contractsService.update(id, dto, user.accountId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'CONTRACT_DELETE', resourceType: 'Contract' })
  @ApiOperation({ summary: 'Soft-delete a contract', description: 'Logically delete a contract (only when serasaStatus is PENDING, FAILED or REMOVED)' })
  @ApiResponse({ status: 200, description: 'Contract deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot delete contracts' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @ApiResponse({ status: 409, description: 'Contract must be removed from provider before deletion' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contractsService.softDelete(id, user.accountId);
  }
}
