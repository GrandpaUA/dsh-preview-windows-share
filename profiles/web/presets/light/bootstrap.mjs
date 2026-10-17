/**
 * light-bootstrap: first-request tool-catalog narrowing for the `light` preset.
 *
 * Adapted from the MIT-licensed anchored-minimal bootstrap
 * (my-dsh-plugin/dsh-presets, itself based on xiaobright/dsh-anchored-standard).
 *
 * Difference from anchored-minimal: we do NOT chase DeepSeek-V4 anchoring and
 * do NOT touch the persona or injected context. Goal is pure token economy:
 * the first model request carries only the cheap everyday tools
 * (shell + filesystem), the heavy schemas (workflow, recall, subagent, goal,
 * jobs, web, ...) appear from the second request on, right after the first
 * tool/call or assistant/message. Durable events drive the phase, so resume
 * and reload keep it.
 */

export const name = 'light-bootstrap'

export const inject = []

const PROMOTE_EVENTS = new Set(['tool/call', 'assistant/message'])

const ALLOWED_KEYS = new Set(['bootstrapTools'])

// Native 0.2 exposes edit instead of the retired str_replace_editor alias.
const DEFAULT_BOOTSTRAP_TOOLS = ['pwsh', 'read', 'glob', 'grep', 'edit', 'write']

function stringList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be a non-empty array of non-empty strings`)
  }
  return [...new Set(value)]
}

export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(source).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) {
    throw new TypeError(`${name}: unknown config key(s) ${unknown.join(', ')} — allowed: bootstrapTools`)
  }
  const bootstrapTools = stringList(source.bootstrapTools ?? DEFAULT_BOOTSTRAP_TOOLS, 'bootstrapTools')

  const promotedFor = new Map()
  const isPromoted = (session) => {
    if (session === undefined) return true
    const cached = promotedFor.get(session.id)
    if (cached !== undefined) return cached
    let promoted = false
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
    if (Array.isArray(events)) {
      for (const event of events) {
        if (PROMOTE_EVENTS.has(event.type)) {
          promoted = true
          break
        }
      }
    }
    if (promoted) promotedFor.set(session.id, true)
    return promoted
  }

  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable — avoid spamming.
    }
  }

  const keepBootstrapTools = (assembled) => {
    const available = new Set(assembled.tools.map((tool) => tool.name))
    const missing = bootstrapTools.filter((toolName) => !available.has(toolName))
    if (missing.length > 0) {
      warnOnce(
        `${name}: bootstrap tools ${JSON.stringify(missing)} missing from the assembled catalog — `
        + 'bootstrap disabled, full catalog exposed',
      )
      return assembled
    }
    return {
      ...assembled,
      tools: assembled.tools.filter((tool) => bootstrapTools.includes(tool.name)),
    }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    try {
      if (isPromoted(context.agent?.session)) return assembled
      return keepBootstrapTools(assembled)
    } catch (error) {
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${String((error && error.message) || error)}`)
      return assembled
    }
  })
}
