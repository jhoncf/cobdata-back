import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  let controller: AuditController;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const mockAuditService = {
      findAll: jest.fn().mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: mockAuditService }],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    auditService = module.get(AuditService);
  });

  describe('findAll', () => {
    it('should return paginated audit logs', async () => {
      const query = { page: 1, limit: 20 };
      const result = await controller.findAll(query);

      expect(auditService.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
    });

    it('should pass filters to service', async () => {
      const query = {
        page: 1,
        limit: 10,
        action: 'AUTH_LOGIN_SUCCESS',
        userId: '550e8400-e29b-41d4-a716-446655440000',
      };

      await controller.findAll(query);

      expect(auditService.findAll).toHaveBeenCalledWith(query);
    });
  });
});
