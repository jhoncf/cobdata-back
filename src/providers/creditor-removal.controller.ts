import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CreditorPortalAccess, CurrentUser, Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { CreditorRemovalService } from './creditor-removal.service';

@ApiTags('Creditor removals')
@ApiBearerAuth('bearer')
@Controller('creditor-removals')
export class CreditorRemovalController {
  constructor(private readonly service: CreditorRemovalService) {}

  @Post('preview')
  @Roles('VIEWER')
  @CreditorPortalAccess()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a creditor removal file and queue its background validation' })
  preview(@UploadedFile() file: Express.Multer.File, @Body('columnMapping') mapping: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createPreview(file, mapping, user.accountId, user.id, user.creditorId);
  }

  @Get('batches')
  @Roles('VIEWER')
  @CreditorPortalAccess()
  @ApiOperation({ summary: 'List background validation and removal batches for the creditor' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.accountId, user.creditorId);
  }

  @Post(':batchId/confirm')
  @Roles('VIEWER')
  @CreditorPortalAccess()
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'CREDITOR_BULK_CONTRACT_CANCEL', resourceType: 'Contract' })
  @ApiOperation({ summary: 'Confirm a validated batch and queue cancellation in the background' })
  confirm(@Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.confirm(batchId, user.accountId, user.creditorId);
  }
}
