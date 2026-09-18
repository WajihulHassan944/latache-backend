import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

/**
 * NestJS's default WsExceptionFilter only ever emits a separate 'exception' event on
 * failure - it never resolves the client's ack callback, so a socket.emit(event, payload,
 * ack) call from the client hangs until its own client-side timeout even though the server
 * already knows the request failed. When the original event included an ack callback,
 * resolve it with { error: { statusCode, message } } instead. Falls back to the default
 * 'exception' emit for events sent without an ack.
 *
 * Argument order here is NestJS's own: WebSocketsController.subscribeMessages binds each
 * proxied handler as callback.bind(instance, client), and the io-adapter then invokes
 * boundCallback(data, ack) - so the underlying WsProxy-wrapped function actually runs as
 * (client, data, ack), and ExecutionContextHost's switchToWs() confirms the mapping:
 * getClient() = arg 0, getData() = arg 1, so the ack callback is arg 2 (getPattern() is
 * always the last arg, appended by WsProxy itself). Verified against @nestjs/websockets and
 * @nestjs/core source directly, not guessed - getArgByIndex(1) looks tempting but is `data`.
 */
@Catch()
export class RealtimeAckExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ack = host.getArgByIndex(2);
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
