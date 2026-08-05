import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  message: string | string[];
  error?: string;
  [key: string]: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let body: ErrorBody;
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      body =
        typeof exceptionResponse === 'string'
          ? { message: exceptionResponse }
          : (exceptionResponse as ErrorBody);
    } else {
      body = { message: 'An unexpected error occurred. Please try again later.' };
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`Unhandled error for ${request.method} ${request.originalUrl}`, stack);
    }

    response.status(status).json({
      statusCode: status,
      ...body,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }
}
