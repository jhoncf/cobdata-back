import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentChargesService } from './payment-charges.service';
import {
  CreatePaymentChargeDto,
  GeneratePixByDocumentDto,
  PaymentChargeResponseDto,
  GeneratePixResponseDto,
  PreflightResponseDto,
} from './dto';
import { PaymentMethod } from './enums';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';

@ApiTags('Payment Charges')
@ApiBearerAuth('bearer')
@Controller()
export class PaymentChargesController {
  constructor(
    private readonly paymentChargesService: PaymentChargesService,
  ) {}

  // ─── 5.1 — Preflight Validation ───────────────────────────────────────────

  @Post('contracts/:contractId/payment-charges/preflight')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pre-validate charge data',
    description: 'Validates contract data for charge issuance without calling the provider',
  })
  @ApiResponse({ status: 200, description: 'Validation result', type: PreflightResponseDto })
  @ApiResponse({ status: 404, description: 'Contract or gateway not found' })
  async preflight(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() body: { method: PaymentMethod; paymentGatewayId: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PreflightResponseDto> {
    const missingFields = await this.paymentChargesService.preflight(
      contractId,
      body.method,
      body.paymentGatewayId,
      user.accountId,
    );
    return PreflightResponseDto.fromMissingFields(missingFields);
  }

  // ─── 5.2 — Generic Charge Issuance ────────────────────────────────────────

  @Post('contracts/:contractId/payment-charges')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'PAYMENT_CHARGE_CREATED', resourceType: 'PaymentCharge' })
  @ApiOperation({
    summary: 'Issue a payment charge',
    description: 'Issues a payment charge for a contract (BOLETO, PIX or BOLEPIX)',
  })
  @ApiResponse({ status: 201, description: 'Charge created successfully', type: PaymentChargeResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Contract or gateway not found' })
  @ApiResponse({ status: 422, description: 'Method not supported by provider' })
  async createCharge(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() dto: CreatePaymentChargeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PaymentChargeResponseDto> {
    const requestId = (req as any).id ?? user.sessionId;
    const charge = await this.paymentChargesService.createCharge(
      contractId,
      dto,
      user.accountId,
      user.id,
      requestId,
    );
    return PaymentChargeResponseDto.fromEntity(charge);
  }

  // ─── 5.3 — Manual Pix Issuance via CRM ────────────────────────────────────

  @Post('contracts/:contractId/payment-charges/pix')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'PAYMENT_CHARGE_PIX_CREATED', resourceType: 'PaymentCharge' })
  @ApiOperation({
    summary: 'Issue a Pix charge for a contract (CRM)',
    description: 'Generates Pix charge using contract updatedValue. Reuses existing valid Pix if available.',
  })
  @ApiResponse({ status: 201, description: 'Pix charge created or reused', type: GeneratePixResponseDto })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @ApiResponse({ status: 422, description: 'Contract has no updatedValue or no active Pix gateway' })
  async createPixForContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<GeneratePixResponseDto> {
    const requestId = (req as any).id ?? user.sessionId;
    const charge = await this.paymentChargesService.createPixForContract(
      contractId,
      user.accountId,
      user.id,
      requestId,
    );
    return GeneratePixResponseDto.fromEntity(charge);
  }

  // ─── 5.4 — Pix by Debtor Document (External Channels) ─────────────────────

  @Post('payment-charges/pix/by-debtor-document')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'PAYMENT_CHARGE_PIX_BY_DOCUMENT', resourceType: 'PaymentCharge' })
  @ApiOperation({
    summary: 'Generate Pix charge by debtor document',
    description: 'Finds eligible contract by CPF/CNPJ and contract number, issues Pix charge',
  })
  @ApiResponse({ status: 201, description: 'Pix charge created or reused', type: GeneratePixResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid document format' })
  @ApiResponse({ status: 404, description: 'No eligible contract found' })
  @ApiResponse({ status: 409, description: 'Multiple contracts match — ambiguous' })
  async createPixByDocument(
    @Body() dto: GeneratePixByDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<GeneratePixResponseDto> {
    const requestId = (req as any).id ?? user.sessionId;
    const charge = await this.paymentChargesService.createPixByDocument(
      dto,
      user.accountId,
      user.id,
      requestId,
    );
    return GeneratePixResponseDto.fromEntity(charge);
  }

  // ─── 5.5 — List Charges ───────────────────────────────────────────────────

  @Get('contracts/:contractId/payment-charges')
  @Roles('ADMIN', 'OPERATIONAL', 'VIEWER')
  @ApiOperation({
    summary: 'List charges for a contract',
    description: 'Returns charges ordered by creation date (DESC), filtered by wallet access',
  })
  @ApiResponse({ status: 200, description: 'List of charges', type: [PaymentChargeResponseDto] })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async listCharges(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PaymentChargeResponseDto[]> {
    const userScopes = (req as any).userScopes as string[] | undefined;
    const charges = await this.paymentChargesService.listCharges(
      contractId,
      user.accountId,
      userScopes,
    );
    return charges.map(PaymentChargeResponseDto.fromEntity);
  }

  // ─── 5.6 — Manual Sync ────────────────────────────────────────────────────

  @Post('payment-charges/:id/sync')
  @Roles('ADMIN', 'OPERATIONAL')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYMENT_CHARGE_SYNCED', resourceType: 'PaymentCharge' })
  @ApiOperation({
    summary: 'Sync charge status with provider',
    description: 'Queries the provider for current charge status and updates accordingly',
  })
  @ApiResponse({ status: 200, description: 'Charge synced successfully', type: PaymentChargeResponseDto })
  @ApiResponse({ status: 404, description: 'Charge not found' })
  @ApiResponse({ status: 422, description: 'Provider does not support status query' })
  async syncCharge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PaymentChargeResponseDto> {
    const requestId = (req as any).id ?? user.sessionId;
    const charge = await this.paymentChargesService.syncCharge(
      id,
      user.accountId,
      user.id,
      requestId,
    );
    return PaymentChargeResponseDto.fromEntity(charge);
  }
}
