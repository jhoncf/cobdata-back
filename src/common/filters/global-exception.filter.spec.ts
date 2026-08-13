import { HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockRequest = {
      requestId: 'test-request-id-123',
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  describe('HttpException handling', () => {
    it('should handle HttpException with string response', () => {
      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          error: 'Not Found',
          message: 'Not Found',
          requestId: 'test-request-id-123',
        }),
      );
    });

    it('should handle HttpException with object response (validation errors)', () => {
      const exception = new HttpException(
        { message: ['email must be an email', 'name should not be empty'], error: 'Bad Request', statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          error: 'Bad Request',
          message: ['email must be an email', 'name should not be empty'],
          requestId: 'test-request-id-123',
        }),
      );
    });

    it('should handle HttpException with single message object', () => {
      const exception = new HttpException(
        { message: 'Forbidden resource', statusCode: 403 },
        HttpStatus.FORBIDDEN,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Forbidden resource',
          requestId: 'test-request-id-123',
        }),
      );
    });
  });

  describe('Prisma error handling', () => {
    it('should handle P2002 (unique constraint) as 409 Conflict', () => {
      const prismaError = {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      };

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          error: 'Conflict',
          message: 'Resource already exists',
          requestId: 'test-request-id-123',
        }),
      );
    });

    it('should handle P2025 (record not found) as 404 Not Found', () => {
      const prismaError = {
        code: 'P2025',
        clientVersion: '5.0.0',
        meta: {},
      };

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          error: 'Not Found',
          message: 'Resource not found',
          requestId: 'test-request-id-123',
        }),
      );
    });

    it('should handle other Prisma errors as 500', () => {
      const prismaError = {
        code: 'P2003',
        clientVersion: '5.0.0',
        meta: {},
      };

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Internal server error',
        }),
      );
    });
  });

  describe('Unknown exception handling', () => {
    it('should handle unknown errors as 500', () => {
      const exception = new Error('Something broke');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Internal server error',
          requestId: 'test-request-id-123',
        }),
      );
    });

    it('should not expose stack traces in the response', () => {
      const exception = new Error('Internal DB connection failed');

      filter.catch(exception, mockHost);

      const jsonCall = mockResponse.json.mock.calls[0][0];
      expect(jsonCall.message).toBe('Internal server error');
      expect(jsonCall).not.toHaveProperty('stack');
      expect(JSON.stringify(jsonCall)).not.toContain('DB connection');
    });
  });

  describe('Response format', () => {
    it('should include timestamp in ISO 8601 format', () => {
      const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const jsonCall = mockResponse.json.mock.calls[0][0];
      expect(jsonCall.timestamp).toBeDefined();
      expect(new Date(jsonCall.timestamp).toISOString()).toBe(jsonCall.timestamp);
    });

    it('should use "unknown" when requestId is not available', () => {
      mockRequest.requestId = undefined;
      const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'unknown',
        }),
      );
    });
  });
});
