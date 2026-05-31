import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getCorrelationId } from '../logger/correlation.context';

export interface ErrorEnvelope {
  statusCode: number;
  message: string;
  code: string;
  traceId: string | undefined;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = Array.isArray(b['message'])
          ? (b['message'] as string[]).join('; ')
          : String(b['message'] ?? exception.message);
        if (typeof b['code'] === 'string') code = b['code'];
      }
      code = code === 'INTERNAL_ERROR' ? toCode(statusCode) : code;
    }

    const traceId =
      getCorrelationId() ??
      (req.headers['x-correlation-id'] as string | undefined);

    const body: ErrorEnvelope = { statusCode, message, code, traceId };
    res.status(statusCode).json(body);
  }
}

function toCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'TOO_MANY_REQUESTS',
    500: 'INTERNAL_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
  };
  return map[status] ?? 'INTERNAL_ERROR';
}
