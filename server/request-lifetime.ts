import type { FastifyReply, FastifyRequest } from 'fastify';

const signals = new WeakMap<FastifyRequest, AbortSignal>();

// IncomingMessage 'close' also means a POST body was fully consumed. Only an
// aborted upload, unfinished response close, or deadline cancels handler work.
export function requestLifetimeSignal(request: FastifyRequest, reply: FastifyReply): AbortSignal {
  const existing = signals.get(request);
  if (existing) return existing;
  const controller = new AbortController();
  signals.set(request, controller.signal);
  const abort = () => controller.abort();
  const close = () => {
    if (!reply.raw.writableFinished) abort();
    cleanup();
  };
  const timeout = request.routeOptions.handlerTimeout;
  const timer = timeout > 0 ? setTimeout(() => {
    if (!reply.sent) {
      abort();
      reply.code(503).send({ error: 'request_timeout', message: 'The request took too long and was stopped.' });
    }
  }, timeout) : undefined;
  timer?.unref();
  function cleanup() {
    clearTimeout(timer);
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', close);
    reply.raw.removeListener('finish', cleanup);
  }
  request.raw.once('aborted', abort);
  reply.raw.once('close', close);
  reply.raw.once('finish', cleanup);
  if (request.raw.aborted || reply.raw.destroyed && !reply.raw.writableFinished) abort();
  return controller.signal;
}
