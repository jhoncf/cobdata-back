import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockRequest: any;
  let mockResponse: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    mockRequest = {};
    mockResponse = {
      setHeader: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('should attach a requestId to the request object', () => {
    middleware.use(mockRequest, mockResponse, mockNext);
    expect(mockRequest.requestId).toBeDefined();
    expect(typeof mockRequest.requestId).toBe('string');
  });

  it('should set X-Request-Id response header', () => {
    middleware.use(mockRequest, mockResponse, mockNext);
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      mockRequest.requestId,
    );
  });

  it('should generate a valid UUID v4', () => {
    middleware.use(mockRequest, mockResponse, mockNext);
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(mockRequest.requestId).toMatch(uuidV4Regex);
  });

  it('should call next()', () => {
    middleware.use(mockRequest, mockResponse, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should generate unique requestIds for different requests', () => {
    const req1: any = {};
    const req2: any = {};
    middleware.use(req1, mockResponse, mockNext);
    middleware.use(req2, mockResponse, mockNext);
    expect(req1.requestId).not.toBe(req2.requestId);
  });
});
