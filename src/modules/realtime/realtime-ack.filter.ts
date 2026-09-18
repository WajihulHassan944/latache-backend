import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

/**
 * NestJS's default WsExceptionFilter only ever emits a separate 'exception' event on
 * failure - it never resolves the client's ack callback, so a socket.emit(event, payload,
 * ack) call from the client hangs until its own client-side timeout even though the server
 * already knows the request failed. When the original event included an ack callback (the
 * third positional arg the socket.io adapter always forwards through, regardless of Nest's
 * own @MessageBody/@ConnectedSocket parameter decorators), resolve it with
 * { error: { statusCode, message } } instead. Falls back to the default 'exception' emit
 * for events sent without an ack.
 */
@Catch()
export class RealtimeAckExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ack = host.getArgByIndex(1);
    if (typeof ack === 'function') {
      const { statusCode, message } = this.normalize(exception);
      ack({ error: { statusCode, message } });
      return;
    }
    super.catch(exception, host);
  }

  private normalize(exception: unknown): { statusCode: number; message: string } {
    if (exception instanceof WsException) {
      const value = exception.getError();
      if (typeof value === 'string') return { statusCode: 400, message: value };
      if (value && typeof value === 'object') {
        const object = value as { statusCode?: unknown; message?: unknown };
        return {
          statusCode: Number.isInteger(object.statusCode) ? Number(object.statusCode) : 400,
          message: String(object.message ?? 'Request failed'),
        };
      }
      return { statusCode: 400, message: exception.message };
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      let message = exception.message;
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object' && 'message' in response) {
        const value = (response as { message?: unknown }).message;
        message = Array.isArray(value) ? value.map(String).join(', ') : String(value ?? message);
      }
      return { statusCode: exception.getStatus(), message };
    }
    return { statusCode: 500, message: 'Request failed' };
  }
}
