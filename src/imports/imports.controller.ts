import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { ImportsService } from './imports.service';
import { UploadImportDto } from './dto/upload-import.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';
import { ListErrorsQueryDto } from './dto/list-errors-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';

@ApiTags('Imports')
@ApiBearerAuth('bearer')
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @Audit({ action: 'IMPORT_UPLOAD', resourceType: 'ImportBatch' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an import file', description: 'Upload a CSV or XLSX file to create an import batch for validation' })
  @ApiResponse({ status: 201, description: 'Import batch created, file uploaded for validation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot import' })
  @ApiResponse({ status: 413, description: 'File size exceeds the maximum limit' })
  @ApiResponse({ status: 422, description: 'Invalid file format, empty file, or invalid wallet' })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.upload({
      file,
      walletId: dto.walletId,
      columnMapping: dto.columnMapping,
      userId: user.id,
      accountId: user.accountId,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List import batches', description: 'Paginated list of import batches' })
  @ApiResponse({ status: 200, description: 'Paginated list of import batches' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(
    @Query() query: ListImportsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: any,
  ) {
    const userScopes: string[] | undefined = req.userScopes;
    return this.importsService.findAll(query, user.accountId, userScopes);
  }

  @Get(':batchId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get import batch details', description: 'Returns batch status, counters and metadata' })
  @ApiResponse({ status: 200, description: 'Import batch details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  async findOne(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.findOne(batchId, user.accountId);
  }

  @Get(':batchId/errors')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List batch validation errors', description: 'Paginated list of validation errors for a batch (masked PII)' })
  @ApiResponse({ status: 200, description: 'Paginated list of errors' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  async listErrors(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query() query: ListErrorsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.findErrors(batchId, query, user.accountId);
  }

  @Post(':batchId/confirm')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'IMPORT_CONFIRM', resourceType: 'ImportBatch' })
  @ApiOperation({ summary: 'Confirm import batch', description: 'Confirm a validated batch to begin applying contracts' })
  @ApiResponse({ status: 200, description: 'Batch confirmed, application started' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot confirm' })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  @ApiResponse({ status: 409, description: 'Batch not in a confirmable state' })
  async confirm(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.confirm(batchId, user.accountId);
  }

  @Post(':batchId/cancel')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'IMPORT_CANCEL', resourceType: 'ImportBatch' })
  @ApiOperation({ summary: 'Cancel import batch', description: 'Cancel an import batch that has not yet been applied' })
  @ApiResponse({ status: 200, description: 'Batch cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot cancel' })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  @ApiResponse({ status: 409, description: 'Batch cannot be cancelled in current state' })
  async cancel(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.cancel(batchId, user.accountId);
  }
}
