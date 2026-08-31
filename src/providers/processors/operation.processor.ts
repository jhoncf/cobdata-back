import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto.service';
import { SerasaLnopAdapter } from '../adapters/serasa-lnop.adapter';
import { QUEUES } from '../../common/constants/queues';
import { OperationAction, OperationStatus } from '@prisma/client';
import {
  DebtPayload,
  RemovePayload,
  ProviderConfig,
} from '../adapters/provider-adapter.interface';
import { OperationBatchJobData } from '../operations.service';

const SERASA_BASE_URLS = {
  HOMOLOGATION: 'https://api.serasa.dev/partnerportal/integration-gateway/v1',
  PRODUCTION: 'https://api.serasa.com.br/partnerportal/integration-gateway/v1',
} as const;

@Processor(QUEUES.PROVIDER_OPERATION)
export class OperationProcessor extends WorkerHost {
  private readonly logger = new Logger(OperationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly adapter: SerasaLnopAdapter,
  ) {
    super();
  }

  async process(job: Job<OperationBatchJobData>): Promise<void> {
    const { operationId, batchIndex, providerId, action } = job.data;
    this.logger.log(
      `Processing operation ${operationId} batch ${batchIndex}`,
    );

    try {
      // Update operation status to PROCESSING if it's still PENDING
      await this.prisma.providerOperation.updateMany({
        where: { id: operationId, status: 'PENDING' },
        data: { status: OperationStatus.PROCESSING },
      });

      // Check if operation was cancelled
      const operation = await this.prisma.providerOperation.findUnique({
        where: { id: operationId },
        select: { status: true },
      });

      if (operation?.status === 'CANCELLED') {
        this.logger.log(`Operation ${operationId} was cancelled, skipping batch ${batchIndex}`);
        return;
      }

      // Get the batch items
      const items = await this.prisma.providerOperationItem.findMany({
        where: { operationId, batchIndex, status: 'PENDING' },
        include: {
          contract: {
            select: {
              id: true,
              walletId: true,
              debtorDocument: true,
              contractNumber: true,
              debtType: true,
              occurrenceDate: true,
              originalValue: true,
              updatedValue: true,
              debtOrigin: true,
              debtId: true,
              wallet: { select: { creditor: { select: { name: true, cnpj: true } } } },
            },
          },
        },
      });

      if (items.length === 0) {
        this.logger.log(`No pending items for operation ${operationId} batch ${batchIndex}`);
        await this.updateOperationStatusIfComplete(operationId);
        return;
      }

      // Get provider config (items[0] is safe since we checked length > 0 above)
      const firstItem = items[0]!;
      const config = await this.getProviderConfig(providerId, firstItem.contract.id);

      // Build payloads and call adapter
      if (action === OperationAction.CREATE_OR_UPDATE) {
        await this.processCreateBatch(items, config, operationId);
      } else {
        await this.processRemoveBatch(items, config, operationId);
      }

      // Update operation status after batch completes
      await this.updateOperationStatusIfComplete(operationId);
    } catch (error) {
      this.logger.error(
        `Failed to process operation ${operationId} batch ${batchIndex}`,
        error,
      );

      // Mark all items in this batch as FAILED
      await this.prisma.providerOperationItem.updateMany({
        where: { operationId, batchIndex, status: 'PENDING' },
        data: {
          status: 'FAILED',
          errorCode: 'PROCESSING_ERROR',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      await this.updateOperationStatusIfComplete(operationId);
    }
  }

  private async processCreateBatch(
    items: any[],
    config: ProviderConfig,
    operationId: string,
  ): Promise<void> {
    const payloads: DebtPayload[] = items.map((item) => {
      const wallet = config.walletMappings.get(item.contract.walletId);
      if (!wallet) throw new Error(`Carteira Serasa não configurada para o contrato ${item.contract.id}`);
      return {
        operationItemId: item.id,
        document: item.contract.debtorDocument,
        contractNumber: item.contract.contractNumber,
        wallet,
        debtType: item.contract.debtType,
        occurrenceDate: item.contract.occurrenceDate.toISOString().slice(0, 10),
        // Serasa must receive the principal/original debt value. The updated
        // value remains available for CobCom's own payment channels.
        debtValue: Number(item.contract.originalValue),
      };
    });

    const result = await this.adapter.sendDebts(payloads, config);

    if (result.httpStatus === 202) {
      // Success: mark items as WAITING_PROVIDER_EVENT
      await this.prisma.providerOperationItem.updateMany({
        where: {
          operationId,
          id: { in: items.map((i) => i.id) },
        },
        data: {
          status: 'WAITING_PROVIDER_EVENT',
          transactionId: result.transactionId || null,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      // Update contract serasaStatus to SENT
      await this.prisma.contract.updateMany({
        where: { id: { in: items.map((i) => i.contractId) } },
        data: { serasaStatus: 'SENT' },
      });

      // The v3 API returns debtIds synchronously. Persist them immediately so
      // later webhook events can be correlated even when transactionId is absent.
      await Promise.all(items.map((item, index) => {
        const debtId = result.items?.[index]?.debtId;
        if (!debtId) return Promise.resolve();
        return this.prisma.contract.update({ where: { id: item.contractId }, data: { debtId } });
      }));
    } else {
      // Error: mark items as FAILED
      await this.prisma.providerOperationItem.updateMany({
        where: {
          operationId,
          id: { in: items.map((i) => i.id) },
        },
        data: {
          status: 'FAILED',
          errorCode: result.error?.code || `HTTP_${result.httpStatus}`,
          errorMessage: result.error?.message || 'Provider request failed',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      // The list is optimistically changed to SENT when the operation is
      // queued. Revert that projection when Serasa rejects the request.
      await this.prisma.contract.updateMany({
        where: { id: { in: items.map((i) => i.contractId) } },
        data: { serasaStatus: 'FAILED' },
      });
    }
  }

  private async processRemoveBatch(
    items: any[],
    config: ProviderConfig,
    operationId: string,
  ): Promise<void> {
    const payloads: RemovePayload[] = items.map((item) => ({
      operationItemId: item.id,
      id: item.contract.debtId!,
    }));

    const result = await this.adapter.removeDebts(payloads, config);

    if (result.httpStatus === 202) {
      // Success: mark items as WAITING_PROVIDER_EVENT
      await this.prisma.providerOperationItem.updateMany({
        where: {
          operationId,
          id: { in: items.map((i) => i.id) },
        },
        data: {
          status: 'WAITING_PROVIDER_EVENT',
          transactionId: result.transactionId || null,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      // Update contract serasaStatus to REMOVING
      await this.prisma.contract.updateMany({
        where: { id: { in: items.map((i) => i.contractId) } },
        data: { serasaStatus: 'REMOVING' },
      });
    } else {
      // Error: mark items as FAILED
      await this.prisma.providerOperationItem.updateMany({
        where: {
          operationId,
          id: { in: items.map((i) => i.id) },
        },
        data: {
          status: 'FAILED',
          errorCode: result.error?.code || `HTTP_${result.httpStatus}`,
          errorMessage: result.error?.message || 'Provider request failed',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });
    }
  }

  /**
   * After processing a batch, check if all batches are done and update
   * the operation's overall status.
   */
  private async updateOperationStatusIfComplete(operationId: string): Promise<void> {
    const pendingItems = await this.prisma.providerOperationItem.count({
      where: { operationId, status: 'PENDING' },
    });

    // If there are still pending items, other batch jobs will handle them
    if (pendingItems > 0) {
      return;
    }

    const failedItems = await this.prisma.providerOperationItem.count({
      where: { operationId, status: 'FAILED' },
    });

    const totalItems = await this.prisma.providerOperationItem.count({
      where: { operationId },
    });

    let newStatus: OperationStatus;
    if (failedItems === 0) {
      newStatus = OperationStatus.COMPLETED;
    } else if (failedItems === totalItems) {
      newStatus = OperationStatus.FAILED;
    } else {
      newStatus = OperationStatus.PARTIALLY_FAILED;
    }

    await this.prisma.providerOperation.update({
      where: { id: operationId },
      data: { status: newStatus },
    });

    this.logger.log(`Operation ${operationId} status updated to ${newStatus}`);
  }

  /**
   * Build the ProviderConfig from the provider's encrypted credentials
   * and wallet mappings.
   */
  private async getProviderConfig(
    providerId: string,
    _contractId: string,
  ): Promise<ProviderConfig> {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: { walletMappings: true },
    });

    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // Decrypt credentials
    const credentialsJson = this.cryptoService.decrypt(provider.credentials);
    const credentials = JSON.parse(credentialsJson);

    // Build wallet mappings map
    const walletMappings = new Map<string, string>();
    for (const mapping of provider.walletMappings) {
      walletMappings.set(mapping.walletId, mapping.externalWalletId);
    }

    const environment = provider.environment as 'HOMOLOGATION' | 'PRODUCTION';
    const apiKey = credentials.apiKey || credentials.token;

    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('API Key da Serasa não configurada para este canal');
    }

    return {
      apiKey,
      baseUrl: SERASA_BASE_URLS[environment],
      environment,
      walletMappings,
    };
  }
}
