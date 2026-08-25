import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { IntegrationKeysService } from './integration-keys.service';

@ApiTags('Integration keys')
@ApiBearerAuth('bearer')
@Controller('integrations/api-keys')
@Roles('ADMIN')
export class IntegrationsController {
  constructor(private readonly keys: IntegrationKeysService) {}

  @Get()
  @ApiOperation({ summary: 'Listar chaves de integração', description: 'O token completo nunca é retornado nesta listagem.' })
  list(@CurrentUser() user: AuthenticatedUser) { return this.keys.list(user.accountId); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar chave de integração', description: 'O token é exibido uma única vez nesta resposta. Guarde-o em local seguro.' })
  @ApiResponse({ status: 201, description: 'Chave criada; contém o token apenas nesta resposta.' })
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: AuthenticatedUser) { return this.keys.create(user.accountId, dto); }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revogar chave de integração' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.keys.revoke(id, user.accountId); }
}
