import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { AddTagsDto } from './dto/add-tags.dto';
import { RemoveTagsDto } from './dto/remove-tags.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';

@ApiTags('Tags')
@ApiBearerAuth('bearer')
@Controller('contracts')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post(':id/tags')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'CONTRACT_TAG_ADD', resourceType: 'Contract' })
  @ApiOperation({ summary: 'Add tags to a contract', description: 'Add one or more tags to a contract (max 20 tags per contract)' })
  @ApiResponse({ status: 200, description: 'Tags added successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot add tags' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @ApiResponse({ status: 422, description: 'Validation error or tag limit exceeded' })
  async addTags(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTagsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tagsService.addTags(id, dto.tags, user.accountId);
  }

  @Delete(':id/tags')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'CONTRACT_TAG_REMOVE', resourceType: 'Contract' })
  @ApiOperation({ summary: 'Remove tags from a contract', description: 'Remove specified tags from a contract' })
  @ApiResponse({ status: 204, description: 'Tags removed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - VIEWER cannot remove tags' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async removeTags(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveTagsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.tagsService.removeTags(id, dto.tags, user.accountId);
  }

  @Get('/tags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all distinct tags', description: 'Returns the list of distinct tags with contract count (VIEWER filtered by scopes)' })
  @ApiResponse({ status: 200, description: 'List of tags with counts' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listTags(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: any,
  ) {
    const userScopes: string[] | undefined = req.userScopes;
    return this.tagsService.listDistinctTags(user.accountId, user.role, userScopes);
  }
}
