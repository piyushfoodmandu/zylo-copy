import pino from 'pino'
import { config } from './config.ts'

export const logger = pino({
  name: 'arro-api',
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'request.headers.authorization',
      'request.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.paymentToken',
      '*.paymentInstrument',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.password',
      '*.secret',
      '*.privateKey',
      '*.rawPaymentCredential',
      '*.rawPrivateKey',
      '*.rawTranscript',
      '*.rawAudio',
      '*.identityLinkingToken',
      '*.externalSubjectRef',
      '*.externalTaskRef'
    ],
    remove: true
  }
})
