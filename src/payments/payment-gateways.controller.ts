import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
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
import { PaymentGatewaysService } from './payment-gateways.service';
import { CreatePaymentGatewayDto, UpdatePaymentGatewayDto, PaymentGatewayResponseDto } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';

@ApiTags('Payment Gateways')
@ApiBearerAuth('bearer')
@Controller('payment-gateways')
export class PaymentGatewaysController {
  constructor(
    private readonly paymentGatewaysService: PaymentGatewaysService,
  ) {}

  @Get()
  @Roles('ADMIN', 'OPERATIONAL')
  @ApiOperation({
    summary: 'List payment gateways',
    description: 'Returns configured payment gateways for the account without secrets',
  })
  @ApiResponse({ status: 200, description: 'List of payment gateways', type: [PaymentGatewayResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN or OPERATIONAL only' })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<PaymentGatewayResponseDto[]> {
    return this.paymentGatewaysService.findAll(user.accountId);
  }

  @Get(':id')
  @Roles('ADMIN', 'OPERATIONAL')
  @ApiOperation({
    summary: 'Get a payment gateway',
    description: 'Returns a single payment gateway configuration without secrets',
  })
  @ApiResponse({ status: 200, description: 'Payment gateway details', type: PaymentGatewayResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN or OPERATIONAL only' })
  @ApiResponse({ status: 404, description: 'Payment gateway not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentGatewayResponseDto> {
    return this.paymentGatewaysService.findOne(id, user.accountId);
  }

  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'PAYMENT_GATEWAY_CREATED', resourceType: 'PaymentGateway' })
  @ApiOperation({
    summary: 'Create a payment gateway',
    description: 'Configure a new payment gateway integration (ADMIN only)',
  })
  @ApiResponse({ status: 201, description: 'Payment gateway created successfully', type: PaymentGatewayResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async create(
    @Body() dto: CreatePaymentGatewayDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentGatewayResponseDto> {
    return this.paymentGatewaysService.create(user.accountId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @Audit({ action: 'PAYMENT_GATEWAY_UPDATED', resourceType: 'PaymentGateway' })
  @ApiOperation({
    summary: 'Update a payment gateway',
    description: 'Update payment gateway configuration or activation state (ADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Payment gateway updated successfully', type: PaymentGatewayResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN only' })
  @ApiResponse({ status: 404, description: 'Payment gateway not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentGatewayDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentGatewayResponseDto> {
    return this.paymentGatewaysService.update(id, user.accountId, dto);
  }
}
