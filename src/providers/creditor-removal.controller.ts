import { Body, Controller, HttpCode, HttpStatus, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Preview creditor-owned contracts for cancellation' })
  preview(@UploadedFile() file: Express.Multer.File, @Body('columnMapping') mapping: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.service.preview(file, mapping, user.accountId, user.creditorId);
  }

  @Post('confirm')
  @Roles('VIEWER')
  @CreditorPortalAccess()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @Audit({ action: 'CREDITOR_BULK_CONTRACT_CANCEL', resourceType: 'Contract' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cancel matched creditor-owned contracts and queue removal from active channels' })
  confirm(@UploadedFile() file: Express.Multer.File, @Body('columnMapping') mapping: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.service.confirm(file, mapping, user.accountId, user.id, user.creditorId);
  }
}
