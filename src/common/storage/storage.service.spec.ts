import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

// Mock the entire @aws-sdk/client-s3 module
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn();
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    HeadBucketCommand: jest.fn().mockImplementation((input) => ({ input })),
    CreateBucketCommand: jest.fn().mockImplementation((input) => ({ input })),
    __mockSend: mockSend,
  };
});

const { __mockSend: mockSend } = jest.requireMock('@aws-sdk/client-s3');

describe('StorageService', () => {
  let service: StorageService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string | number | boolean> = {
        S3_BUCKET: 'test-bucket',
        S3_ENDPOINT: 'localhost',
        S3_PORT: 9000,
        S3_USE_SSL: false,
        S3_ACCESS_KEY: 'minioadmin',
        S3_SECRET_KEY: 'minioadmin',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should call ensureBucketExists on init', async () => {
      mockSend.mockResolvedValueOnce({});
      await service.onModuleInit();
      expect(mockSend).toHaveBeenCalled();
    });

    it('should create bucket if HeadBucket returns 404', async () => {
      const notFoundError = { $metadata: { httpStatusCode: 404 } };
      mockSend
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({});

      await service.onModuleInit();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should not fail startup if bucket creation fails', async () => {
      const notFoundError = { $metadata: { httpStatusCode: 404 } };
      mockSend
        .mockRejectedValueOnce(notFoundError)
        .mockRejectedValueOnce(new Error('Access denied'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('upload', () => {
    it('should upload a buffer and return the key', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await service.upload(
        'test-key.csv',
        Buffer.from('content'),
        'text/csv',
      );
      expect(result).toBe('test-key.csv');
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('should return a readable stream', async () => {
      const mockBody = { pipe: jest.fn() };
      mockSend.mockResolvedValueOnce({ Body: mockBody });

      const result = await service.download('test-key.csv');
      expect(result).toBe(mockBody);
    });
  });

  describe('delete', () => {
    it('should delete the object', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(service.delete('test-key.csv')).resolves.not.toThrow();
      expect(mockSend).toHaveBeenCalled();
    });
  });
});
