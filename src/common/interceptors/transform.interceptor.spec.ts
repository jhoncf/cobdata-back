import { TransformInterceptor } from './transform.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
  });

  function createMockContext(requestId?: string) {
    const mockRequest = { requestId } as any;
    const mockResponse = {
      setHeader: jest.fn(),
    } as any;

    const context: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getClass: jest.fn(),
      getHandler: jest.fn(),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as any;

    return { context, mockRequest, mockResponse };
  }

  function createMockHandler(data: any): CallHandler {
    return { handle: () => of(data) };
  }

  it('should set X-Request-Id header from request.requestId', (done) => {
    const { context, mockResponse } = createMockContext('test-request-id-123');
    const handler = createMockHandler({ message: 'hello' });

    interceptor.intercept(context, handler).subscribe(() => {
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Request-Id',
        'test-request-id-123',
      );
      done();
    });
  });

  it('should not set X-Request-Id header if requestId is missing', (done) => {
    const { context, mockResponse } = createMockContext(undefined);
    const handler = createMockHandler({ message: 'hello' });

    interceptor.intercept(context, handler).subscribe(() => {
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
      done();
    });
  });

  it('should pass through paginated responses (data + meta) unchanged', (done) => {
    const { context } = createMockContext('req-id');
    const paginatedData = {
      data: [{ id: '1' }, { id: '2' }],
      meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
    };
    const handler = createMockHandler(paginatedData);

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toEqual(paginatedData);
      expect(result.data).toEqual([{ id: '1' }, { id: '2' }]);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 10, totalPages: 1 });
      done();
    });
  });

  it('should pass through non-paginated responses unchanged', (done) => {
    const { context } = createMockContext('req-id');
    const simpleData = { id: '1', name: 'Test' };
    const handler = createMockHandler(simpleData);

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toEqual(simpleData);
      done();
    });
  });

  it('should pass through null responses unchanged', (done) => {
    const { context } = createMockContext('req-id');
    const handler = createMockHandler(null);

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toBeNull();
      done();
    });
  });

  it('should pass through array responses unchanged', (done) => {
    const { context } = createMockContext('req-id');
    const arrayData = [{ id: '1' }, { id: '2' }];
    const handler = createMockHandler(arrayData);

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toEqual(arrayData);
      done();
    });
  });

  it('should pass through string responses unchanged', (done) => {
    const { context } = createMockContext('req-id');
    const handler = createMockHandler('simple string');

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toBe('simple string');
      done();
    });
  });
});
