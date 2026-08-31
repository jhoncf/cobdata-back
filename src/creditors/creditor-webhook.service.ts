import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CreditorWebhookService {
  private readonly logger = new Logger(CreditorWebhookService.name);
  private readonly key: Buffer;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.key = createHash('sha256').update(config.getOrThrow<string>('JWT_SECRET')).digest().subarray(0, 32);
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }

  private decrypt(value: string): string {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return decipher.update(data.subarray(28)) + decipher.final('utf8');
  }

  /** Fire-and-forget notification. A recipient failure never blocks a CRM status update. */
  async notifyContractStatusChanged(contractId: string, previous: { status: string; paymentStatus: string; serasaStatus: string }) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { wallet: { include: { creditor: true } } },
    });
    if (!contract?.wallet.creditor.webhookUrl) return;
    const current = { status: contract.status, paymentStatus: contract.paymentStatus, serasaStatus: contract.serasaStatus };
    if (current.status === previous.status && current.paymentStatus === previous.paymentStatus && current.serasaStatus === previous.serasaStatus) return;

    const creditor = contract.wallet.creditor;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'CobCom-CRM-Webhook/1.0',
      'X-CobCom-Event': 'contract.status.updated',
    };
    if (creditor.webhookAuthKeyEncrypted) headers.Authorization = `Bearer ${this.decrypt(creditor.webhookAuthKeyEncrypted)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(creditor.webhookUrl!, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({
          event: 'contract.status.updated', occurredAt: new Date().toISOString(),
          data: {
            contract: { id: contract.id, number: contract.contractNumber, document: contract.debtorDocument, originalValue: contract.originalValue.toString(), updatedValue: contract.updatedValue.toString() },
            wallet: { id: contract.wallet.id, name: contract.wallet.name },
            status: current, previousStatus: previous,
          },
        }),
      });
      if (!response.ok) this.logger.warn(`Webhook do credor ${creditor.id} respondeu HTTP ${response.status}`);
    } catch (error) {
      this.logger.warn(`Falha ao entregar webhook do credor ${creditor.id}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    } finally { clearTimeout(timeout); }
  }
}
