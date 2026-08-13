import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hash()', () => {
    it('should produce a valid argon2id hash', async () => {
      const password = 'Admin@123';
      const hash = await service.hash(password);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      // Argon2id hashes start with $argon2id$
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('should produce different hashes for the same password (salted)', async () => {
      const password = 'Admin@123';
      const hash1 = await service.hash(password);
      const hash2 = await service.hash(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verify()', () => {
    it('should return true for correct password', async () => {
      const password = 'Admin@123';
      const hash = await service.hash(password);

      const result = await service.verify(hash, password);

      expect(result).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'Admin@123';
      const hash = await service.hash(password);

      const result = await service.verify(hash, 'WrongPassword1');

      expect(result).toBe(false);
    });
  });

  describe('validateComplexity()', () => {
    it('should accept a valid password', () => {
      const result = service.validateComplexity('Admin@123');
      expect(result).toBeNull();
    });

    it('should accept a password with exactly 8 characters', () => {
      const result = service.validateComplexity('Abcdef1x');
      expect(result).toBeNull();
    });

    it('should reject a password shorter than 8 characters', () => {
      const result = service.validateComplexity('Ab1cdef');
      expect(result).toBe('Password must be at least 8 characters long');
    });

    it('should reject a password without uppercase letter', () => {
      const result = service.validateComplexity('admin@123');
      expect(result).toBe('Password must contain at least one uppercase letter');
    });

    it('should reject a password without lowercase letter', () => {
      const result = service.validateComplexity('ADMIN@123');
      expect(result).toBe('Password must contain at least one lowercase letter');
    });

    it('should reject a password without digit', () => {
      const result = service.validateComplexity('Admin@abc');
      expect(result).toBe('Password must contain at least one digit');
    });

    it('should accept a password with unicode characters', () => {
      // Unicode chars alongside meeting all complexity requirements
      const result = service.validateComplexity('Adm1n@ção');
      expect(result).toBeNull();
    });

    it('should reject an empty password', () => {
      const result = service.validateComplexity('');
      expect(result).toBe('Password must be at least 8 characters long');
    });
  });
});
