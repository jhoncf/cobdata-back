import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('test-jwt-secret-for-encryption'),
          },
        },
      ],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should encrypt and decrypt a string correctly', () => {
    const plaintext = '{"apiKey":"secret-key","baseUrl":"https://api.example.com"}';
    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same input (random IV)', () => {
    const plaintext = 'same-input';
    const encrypted1 = service.encrypt(plaintext);
    const encrypted2 = service.encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should produce base64 output', () => {
    const encrypted = service.encrypt('test');
    expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    // Verify it's valid base64 by re-encoding
    const buf = Buffer.from(encrypted, 'base64');
    expect(buf.toString('base64')).toBe(encrypted);
  });

  it('should throw on tampered ciphertext', () => {
    const encrypted = service.encrypt('test');
    const buf = Buffer.from(encrypted, 'base64');
    // Tamper with the ciphertext (byte after iv + tag)
    const byteVal = buf[29] as number;
    buf[29] = byteVal ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('should handle JSON objects as credentials', () => {
    const credentials = {
      apiKey: 'my-api-key',
      baseUrl: 'https://serasa.api.com',
      clientId: 'client-123',
    };
    const json = JSON.stringify(credentials);
    const encrypted = service.encrypt(json);
    const decrypted = service.decrypt(encrypted);
    expect(JSON.parse(decrypted)).toEqual(credentials);
  });
});
