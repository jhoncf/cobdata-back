import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;

  const mockUsersService = {
    invite: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
    resendInvite: jest.fn(),
    forceReset: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get(UsersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('invite', () => {
    it('should call usersService.invite with dto and accountId', async () => {
      const dto = { email: 'test@example.com', role: Role.OPERATIONAL };
      const accountId = 'account-uuid';
      const expectedResult = {
        id: 'user-id',
        email: 'test@example.com',
        role: Role.OPERATIONAL,
        status: 'PENDING',
      };

      mockUsersService.invite.mockResolvedValue(expectedResult);

      const result = await controller.invite(dto, accountId);

      expect(mockUsersService.invite).toHaveBeenCalledWith(dto, accountId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('resendInvite', () => {
    it('should call usersService.resendInvite with user id', async () => {
      const expectedResult = {
        message: 'Invite resent successfully',
        userId: 'user-id-1',
        email: 'pending@example.com',
      };

      mockUsersService.resendInvite.mockResolvedValue(expectedResult);

      const result = await controller.resendInvite('user-id-1');

      expect(mockUsersService.resendInvite).toHaveBeenCalledWith('user-id-1');
      expect(result).toEqual(expectedResult);
    });
  });

  describe('forceReset', () => {
    it('should call usersService.forceReset with user id', async () => {
      const expectedResult = {
        message: 'Password reset forced successfully',
        userId: 'user-id-1',
        email: 'active@example.com',
      };

      mockUsersService.forceReset.mockResolvedValue(expectedResult);

      const result = await controller.forceReset('user-id-1');

      expect(mockUsersService.forceReset).toHaveBeenCalledWith('user-id-1');
      expect(result).toEqual(expectedResult);
    });
  });
});
