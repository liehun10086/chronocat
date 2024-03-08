import h from '@satorijs/element'
import styles from 'ansi-styles'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { initServers } from './server'
import { api } from './services/api'
import { getAuthData } from './services/authData'
import { baseDir } from './services/baseDir'
import { getConfig } from './services/config'
import type { ChronocatLogCurrentConfig } from './services/config/configEntity'
import { emitter } from './services/emitter'
import { l } from './services/logger'
import { getSelfProfile, setSelfProfile } from './services/selfProfile'
import { uix } from './services/uix'
import { validate } from './services/validate'
import type { ChronocatContext, Engine } from './types'
import { PLATFORM } from './utils/consts'
import { exists } from './utils/fs'
import { sleep, timeout } from './utils/time'

export * from './satori/types'
export * from './services/config/configEntity'
export * from './types'

declare const __DEFINE_CHRONO_VERSION__: string

interface EngineInfo {
  name: string
  filename: string
  type: string
  path: string
  hidden: boolean
}

export const chronocat = async () => {
  l.info(`Chronocat v${__DEFINE_CHRONO_VERSION__}`)

  let ready: () => void
  const readyPromise = new Promise<void>((res) => {
    ready = res
  })

  const ctx: ChronocatContext = {
    chronocat: {
      api,
      baseDir,
      emit: emitter.emit,
      exists,
      getAuthData,
      getConfig,
      getSelfProfile,
      h,
      l,
      platform: PLATFORM,
      sleep,
      styles,
      timeout,
      uix,
      validate,
      whenReady: () => readyPromise,
    },
  }

  const engines: EngineInfo[] = []

  const externalEnginesPath = join(baseDir, 'engines')

  mkdirSync(externalEnginesPath, {
    recursive: true,
  })

  readdirSync(externalEnginesPath)
    .map((filename) => {
      let valid = false
      let name = filename
      let type = 'js'

      if (name.endsWith('.engine.jsc')) {
        valid = true
        name = name.slice(0, name.length - 11)
        type = 'jsc'
      }

      if (name.endsWith('.engine.js')) {
        valid = true
        name = name.slice(0, name.length - 10)
      }

      if (!valid) return undefined

      return {
        name,
        filename,
        type,
        path: join(externalEnginesPath, filename),
        hidden: false,
      }
    })
    .filter(
      Boolean as unknown as (x: EngineInfo | undefined) => x is EngineInfo,
    )
    .forEach((x) => engines.push(x))

  // if (!engines.length)
  readdirSync(__dirname)
    .map((filename) => {
      let valid = false
      let name = filename
      let type = 'js'

      if (name.endsWith('.engine.jsc')) {
        valid = true
        name = name.slice(0, name.length - 11)
        type = 'jsc'
      }

      if (name.endsWith('.engine.js')) {
        valid = true
        name = name.slice(0, name.length - 10)
      }

      if (!valid) return undefined

      return {
        name,
        filename,
        type,
        path: join(__dirname, filename),
        hidden: true,
      }
    })
    .filter(
      Boolean as unknown as (x: EngineInfo | undefined) => x is EngineInfo,
    )
    .forEach((x) => engines.push(x))

  if (!engines.length)
    l.warn('没有找到任何引擎。Chronocat 服务仍将启动。', { code: 2156 })

  for (const engineInfo of engines) {
    try {
      l.debug(
        `加载引擎：${styles.green.open}${engineInfo.filename}${styles.green.close}`,
      )

      if (engineInfo.type === 'jsc') require('bytenode')

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const engine = require(engineInfo.path) as unknown as Engine
      l.info(
        `使用引擎 ${styles.green.open}${engine.name}${styles.green.close} v${engine.version}${engineInfo.hidden ? '' : `${styles.grey.open}，来自 ${engineInfo.filename}${styles.grey.close}`}`,
      )
      engine.apply(ctx)
    } catch (e) {
      setTimeout(() => process.exit(1), 2000)
      l.error(
        new Error(`加载引擎 ${engineInfo.filename} 失败`, {
          cause: e,
        }),
        {
          code: 2155,
          throw: true,
        },
      )
    }
  }

  emitter.register(setSelfProfile)

  // getConfig() 包含用户配置，因此会先等待登录
  // 这是首个等待登录的位置
  // 所有在登录前就需要启动的服务均应在此之前
  l.debug('等待登录')
  const config = await getConfig()
  if (!config.enable) {
    l.info('根据配置文件要求，退出 Chronocat')
    return
  }

  const log: ChronocatLogCurrentConfig = config.log!
  // 预处理 self_url
  if (!log.self_url || log.self_url === 'https://chronocat.vercel.app')
    log.self_url = `http://127.0.0.1:5500`
  if (log.self_url.endsWith('/'))
    log.self_url = log.self_url.slice(0, log.self_url.length - 1)

  // Log satori message
  emitter.register(async (m) => {
    if (m.type !== 'satori') return
    ;(await m.toSatori(ctx, log)).forEach((e) => l.parse(e))
  })

  emitter.register((await initServers(ctx)).emit)

  l.info('中身はあんまりないよ～ (v0.x)', { code: 560 })

  ready!()
}
