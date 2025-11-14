import pino from 'pino';
import { isDevelopment } from '@singr/config';

const baseOptions: pino.LoggerOptions = {
  level: isDevelopment ? 'debug' : 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  redact: {
    paths: [
      'password',
      'passwordHash',
      'apiKey',
      'apiKeyHash',
      'accessToken',
      'refreshToken',
      'token',
      'authorization',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    remove: true,
  },
};

const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const logger = pino(baseOptions, transport ? pino.transport(transport) : undefined);

export function createLogger(name: string) {
  return logger.child({ module: name });
}
