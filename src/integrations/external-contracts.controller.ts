import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyScopes } from './api-key-scopes.decorator';
import { CreateContractPixDto } from './dto/create-contract-pix.dto';
import { ExternalContractQueryDto } from './dto/external-contract-query.dto';
import { UpdateContractContactsDto } from './dto/update-contract-contacts.dto';
import { ExternalContractsService } from './external-contracts.service';

@ApiTags('External API - contracts')
@ApiSecurity('apiKey')
@ApiHeader({ name: 'X-API-Key', required: true, description: 'Chave de integração CobCom' })
@Public()
@UseGuards(ApiKeyGuard)
@Controller('v1/contracts')
export class ExternalContractsController {
  constructor(private readonly contracts: ExternalContractsService) {}

  @Get()
  @ApiKeyScopes('CONTRACTS_READ')
  @ApiOperation({ summary: 'Consultar contratos pendentes por CPF/CNPJ', description: 'Usa a mesma regra de elegibilidade da página pública: contrato ativo, não pago, carteira ativa e valor atualizado positivo.' })
  @ApiResponse({ status: 200, description: 'Contratos pendentes e elegíveis para cobrança.' })
  list(@Query() query: ExternalContractQueryDto, @Req() req: any) {
    return this.contracts.list(req.integration.accountId, query);
  }

  @Post(':contractNumber/contacts')
  @HttpCode(HttpStatus.OK)
  @ApiKeyScopes('CONTRACT_CONTACTS_WRITE')
  @ApiOperation({ summary: 'Atualizar contatos de um contrato específico', description: 'Atualiza somente telefone e/ou e-mail após validar CPF/CNPJ e número do contrato.' })
  updateContacts(@Param('contractNumber') contractNumber: string, @Query('debtorDocument') debtorDocument: string, @Body() dto: UpdateContractContactsDto, @Req() req: any) {
    return this.contracts.updateContacts(req.integration.accountId, contractNumber, debtorDocument, dto);
  }

  @Post(':contractNumber/pix')
  @HttpCode(HttpStatus.CREATED)
  @ApiKeyScopes('PIX_CREATE')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Chave única por tentativa. Repetições retornam a mesma cobrança.' })
  @ApiOperation({ summary: 'Gerar ou reutilizar Pix para um contrato', description: 'Recebe CPF/CNPJ e número do contrato. Retorna código copia e cola e URL do QR Code quando disponível.' })
  createPix(@Param('contractNumber') contractNumber: string, @Body() dto: CreateContractPixDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Req() req: any) {
    if (!idempotencyKey) {
      throw new BadRequestException('O cabeçalho Idempotency-Key é obrigatório.');
    }
    return this.contracts.createPix(req.integration.accountId, contractNumber, dto.debtorDocument, idempotencyKey, req.requestId ?? 'external-api');
  }
}
