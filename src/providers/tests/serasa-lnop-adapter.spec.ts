import { SerasaLnopAdapter } from '../adapters/serasa-lnop.adapter';
import { ProviderType } from '@prisma/client';
import { createHmac } from 'crypto';

describe('SerasaLnopAdapter', () => {
  let adapter: SerasaLnopAdapter;

  beforeEach(() => {
    adapter = new SerasaLnopAdapter();
  });

  describe('type', () => {
    it('should have type SERASA_LNOP', () => {
      expect(adapter.type).toBe(ProviderType.SERASA_LNOP);
    });
  });

  describe('validateWebhookSignature', () => {
    const secret = 'test-webhook-secret';

    it('should return true for valid HMAC signature', () => {
      const body = Buffer.from('{"event":"test"}');
      const signature = createHmac('sha256', secret).update(body).digest('hex');

      const result = adapter.validateWebhookSignature(
        { 'x-serasa-signature': signature },
        body,
        secret,
      );

      expect(result).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const body = Buffer.from('{"event":"test"}');
      const wrongSignature = createHmac('sha256', 'wrong-secret')
        .update(body)
        .digest('hex');

      const result = adapter.validateWebhookSignature(
        { 'x-serasa-signature': wrongSignature },
        body,
        secret,
      );

      expect(result).toBe(false);
    });

    it('should return false when signature header is missing', () => {
      const body = Buffer.from('{"event":"test"}');

      const result = adapter.validateWebhookSignature({}, body, secret);

      expect(result).toBe(false);
    });

    it('should return false for tampered body', () => {
      const originalBody = Buffer.from('{"event":"test"}');
      const tamperedBody = Buffer.from('{"event":"hacked"}');
      const signature = createHmac('sha256', secret)
        .update(originalBody)
        .digest('hex');

      const result = adapter.validateWebhookSignature(
        { 'x-serasa-signature': signature },
        tamperedBody,
        secret,
      );

      expect(result).toBe(false);
    });
  });
});
