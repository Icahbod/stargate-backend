import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(statusFn: jest.Mock, jsonFn: jest.Mock, headers: Record<string, string> = {}) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusFn, json: jsonFn }),
      getRequest: () => ({ headers }),
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  });

  it('maps HttpException to envelope', () => {
    const host = makeHost(statusMock, jsonMock);
    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), host);
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'Not found', code: 'NOT_FOUND' }),
    );
  });

  it('maps unknown error to 500 envelope', () => {
    const host = makeHost(statusMock, jsonMock);
    filter.catch(new Error('boom'), host);
    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL_ERROR' }),
    );
  });

  it('includes traceId from request header', () => {
    const host = makeHost(statusMock, jsonMock, { 'x-correlation-id': 'test-trace-123' });
    filter.catch(new HttpException('Bad request', HttpStatus.BAD_REQUEST), host);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'test-trace-123' }),
    );
  });

  it('joins array validation messages', () => {
    const host = makeHost(statusMock, jsonMock);
    filter.catch(
      new HttpException({ message: ['field is required', 'must be string'], statusCode: 400 }, 400),
      host,
    );
    const call = jsonMock.mock.calls[0][0];
    expect(call.message).toBe('field is required; must be string');
  });
});
