import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators';
import { GeneratePixResponseDto } from './dto';
import { PublicDebtLookupDto, PublicPixRequestDto } from './dto/public-debt.dto';
import { PublicDebtRateLimitService } from './public-debt-rate-limit.service';
import { PublicDebtService } from './public-debt.service';

@ApiTags('Public debt consultation')
@Public()
@Controller('public/debts')
export class PublicDebtController {
  constructor(
    private readonly debts: PublicDebtService,
    private readonly rateLimit: PublicDebtRateLimitService,
  ) {}

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find pending debts by CPF/CNPJ' })
  async lookup(@Body() dto: PublicDebtLookupDto, @Req() req: Request) {
    await this.rateLimit.consume('lookup', req.ip ?? req.socket.remoteAddress ?? 'unknown', dto.debtorDocument);
    return { contracts: await this.debts.lookup(dto.debtorDocument) };
  }

  @Post('pix')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate Pix for a debt returned by lookup' })
  async generatePix(@Body() dto: PublicPixRequestDto, @Req() req: Request): Promise<GeneratePixResponseDto> {
    await this.rateLimit.consume('pix', req.ip ?? req.socket.remoteAddress ?? 'unknown', dto.debtorDocument);
    const charge = await this.debts.generatePix(dto.contractId, dto.debtorDocument, (req as any).id ?? 'public');
    return GeneratePixResponseDto.fromEntity(charge);
  }

  @Get('charges/:chargeId')
  @ApiOperation({ summary: 'Check the public Pix charge payment status' })
  async chargeStatus(
    @Param('chargeId') chargeId: string,
    @Query() dto: PublicDebtLookupDto,
  ) {
    return this.debts.getChargeStatus(chargeId, dto.debtorDocument);
  }
}
