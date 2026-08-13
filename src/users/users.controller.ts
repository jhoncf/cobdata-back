import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Roles, CurrentUser } from '../common/decorators';
import { UsersService } from './users.service';
import { InviteUserDto, ListUsersQueryDto, UpdateUserDto } from './dto';

@ApiTags('Users')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('ADMIN')
  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a new user', description: 'Send an invitation email to a new user with a predefined role and optional scopes' })
  @ApiResponse({ status: 201, description: 'User invited successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async invite(
    @Body() dto: InviteUserDto,
    @CurrentUser('accountId') accountId: string,
  ) {
    return this.usersService.invite(dto, accountId);
  }

  @Roles('ADMIN')
  @Get()
  @ApiOperation({ summary: 'List users', description: 'Returns a paginated list of all users with their status' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  async list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update user', description: 'Update role, status or scopes of a user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Cannot deactivate last ADMIN' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend invitation', description: 'Generate a new invitation token and resend the activation email' })
  @ApiResponse({ status: 200, description: 'Invitation resent' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async resendInvite(@Param('id') id: string) {
    return this.usersService.resendInvite(id);
  }

  @Roles('ADMIN')
  @Post(':id/force-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force password reset', description: 'Invalidate user password, terminate sessions and force password reset on next login' })
  @ApiResponse({ status: 200, description: 'Password reset forced' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async forceReset(@Param('id') id: string) {
    return this.usersService.forceReset(id);
  }
}
