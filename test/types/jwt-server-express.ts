import express4 from 'express4'
import express5 from 'express5'
import {
  createExpressRouter,
  type JwtHandlerConfig,
} from '../../src/jwt-server'

declare const config: JwtHandlerConfig

// The documented mount pattern must type-check against both @types/express majors.
express4().use('/jwt', express4.json(), createExpressRouter(config))
express4.Router().use(createExpressRouter(config))

express5().use('/jwt', express5.json(), createExpressRouter(config))
express5.Router().use(createExpressRouter(config))
