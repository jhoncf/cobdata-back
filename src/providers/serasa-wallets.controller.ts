import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { CreateSerasaWalletDto, UpdateSerasaWalletDto } from './dto/serasa-wallet.dto';
import { SerasaWalletsService } from './serasa-wallets.service';

@ApiTags('Serasa Wallets')
@ApiBearerAuth('bearer')
@Controller('serasa-wallets')
export class SerasaWalletsController {
  constructor(private readonly service: SerasaWalletsService) {}

  @Get()
  @Roles('ADMIN', 'OPERATIONAL')
  list(@CurrentUser() user: AuthenticatedUser) { return this.service.list(user.accountId); }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateSerasaWalletDto, @CurrentUser() user: AuthenticatedUser) { return this.service.create(user.accountId, dto); }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSerasaWalletDto, @CurrentUser() user: AuthenticatedUser) { return this.service.update(id, user.accountId, dto); }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { await this.service.remove(id, user.accountId); }
}
