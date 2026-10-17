/**
 * Real Kompress-v2-base ONNX scorer for dsh-headroom.
 *
 * Wraps the exported ONNX graph of `chopratejas/kompress-v2-base`
 * (a dual-head ModernBERT exported with a fused `final_scores` output:
 * one keep-score in [0, 1] per token position) behind the WordScorer
 * contract used by the Kompress pipeline:
 *
 *   (words: string[], ctx: { start, freq }) => Float64Array   (async)
 *
 * Word↔token alignment uses incremental prefix encoding: encoding every
 * word-boundary prefix of the joined chunk text and diffing lengths gives
 * exact sub-token counts per word on the very stream the model sees,
 * independent of offset-mapping support in the tokenizer backend.
 *
 * Because ONNX inference is asynchronous while part of the compression
 * pipeline is synchronous, callers must use the async pipeline twins
 * (`compressKompressTextAsync` → `compressContentBlocksAsync`) with this
 * scorer. Every initialization failure is reported through `{ ok: false }`
 * so the plugin can degrade to the deterministic heuristic scorer.
 *
 * Dependencies (`onnxruntime-node`, `@huggingface/transformers`) are OPTIONAL
 * dev-time dependencies and are imported lazily.
 *
 * Model files are expected on local disk (no network access at runtime):
 *
 *   modelDir/onnx_kompress-int8-wo.onnx      (or custom modelFile)
 *   hfLocalDir/kompress-v2-base/tokenizer.json (+ config.json …)
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

export const KOMPRESS_ONNX_DEFAULTS = Object.freeze({
  /** Directory holding the downloaded ONNX file(s). */
  modelDir: '',
  /** ONNX file name inside modelDir. */
  modelFile: 'onnx_kompress-int8-wo.onnx',
  /** transformers.js local-model root containing <modelName>/. */
  hfLocalDir: '',
  /** Local model folder name under hfLocalDir. */
  modelName: 'kompress-v2-base',
  /** Hard cap on encoded sequence length fed to the graph. */
  maxLength: 8192
})

function toBigInt64(values) {
  const out = new BigInt64Array(values.length)
  for (let i = 0; i < values.length; i += 1) out[i] = BigInt(values[i])
  return out
}

/**
 * Build the real-model scorer.
 *
 * @returns {Promise<{ ok: boolean, scorer?: Function, info?: object, error?: string }>}
 */
export async function createOnnxScorer(options = {}) {
  const opts = { ...KOMPRESS_ONNX_DEFAULTS, ...options }
  if (!opts.modelDir || !opts.hfLocalDir) {
    return { ok: false, error: 'kompress-onnx: modelDir and hfLocalDir are required' }
  }

  let ort
  let tf
  try {
    ort = await import('onnxruntime-node')
    tf = await import('@huggingface/transformers')
  } catch (error) {
    return { ok: false, error: `kompress-onnx: optional deps unavailable (${String(error && error.message)})` }
  }

  try {
    tf.env.allowRemoteModels = false
    tf.env.allowLocalModels = true
    if (!tf.env.localModelPath || opts.hfLocalDir) tf.env.localModelPath = opts.hfLocalDir

    const tokenizer = await (
      tf.AutoTokenizer.from_pretrained ?? tf.AutoTokenizer.fromPretrained
    ).call(tf.AutoTokenizer, opts.modelName)

    const rust = tokenizer._tokenizer && typeof tokenizer._tokenizer.encode === 'function'
      ? tokenizer._tokenizer
      : null
    if (!rust) {
      return { ok: false, error: 'kompress-onnx: underlying rust tokenizer binding not found' }
    }

    const modelPath = path.join(opts.modelDir, opts.modelFile)
    const session = await ort.InferenceSession.create(modelPath, { graphOptimizationLevel: 'all' })
    const scoreKey = session.outputNames.includes('final_scores') ? 'final_scores' : session.outputNames[0]

    /**
     * Async contextual scorer for one chunk of words.
     */
    const pieceCache = new Map()
    /** Decode one token id back to its raw piece text ('Ġ' decodes to a space). */
    function pieceTextOf(id) {
      let piece = pieceCache.get(id)
      if (piece === undefined) {
        try {
          piece = rust.decode([id], false) ?? ''
        } catch {
          piece = ''
        }
        if (piece === '') piece = '\u0000'
        pieceCache.set(id, piece)
      }
      return piece
    }

    async function scoreWordsOnnx(words) {
      const n = words.length
      if (n === 0) return new Float64Array(0)
      const text = words.join(' ')

      const full = rust.encode(text, true)
      // The rust binding exposes snake_case fields.
      const attn = full.attention_mask ?? full.attentionMask
      const ids = full.ids
      const total = ids.length
      if (total > opts.maxLength) {
        throw new Error(`chunk too long for the ONNX graph (${total} > ${opts.maxLength} tokens)`)
      }

      const outputs = await session.run({
        input_ids: new ort.Tensor('int64', toBigInt64(full.ids), [1, total]),
        attention_mask: new ort.Tensor('int64', toBigInt64(attn), [1, total])
      })
      const tensor = outputs[scoreKey]
      const perToken = Float32Array.from(tensor.data)

      // Exact word↔token alignment for GPT-2-style byte-level BPE: the
      // pre-tokenizer never merges across a space, so every output token
      // belongs wholly to one joined word. Assign tokens greedily by
      // decoding them back to text until the concatenation matches the word
      // (a leading decoded space marks the start of the next word).
      const scores = new Float64Array(n)
      let pos = 0
      while (pos < total && attn[pos] === 0) pos += 1
      pos += 1 // skip the leading special token ([CLS])
      for (let i = 0; i < n && pos < total; i += 1) {
        const word = words[i]
        let acc = ''
        let best = 0
        const start = pos
        while (pos < total && attn[pos] !== 0) {
          acc += pieceTextOf(ids[pos])
          pos += 1
          const norm = acc.replace(/^\s+/, '')
          if (norm === word || norm.length >= word.length || !word.startsWith(norm)) break
        }
        for (let k = start; k < pos; k += 1) {
          if (perToken[k] > best) best = perToken[k]
        }
        scores[i] = best
      }
      return scores
    }

    return {
      ok: true,
      scorer: scoreWordsOnnx,
      info: { modelFile: opts.modelFile, inputs: [...session.inputNames], output: scoreKey }
    }
  } catch (error) {
    return { ok: false, error: `kompress-onnx: init failed (${String(error && error.message)})` }
  }
}

/** Read a small JSON file from the model dir, tolerating absence. */
export function readModelJson(modelDir, fileName) {
  try {
    return JSON.parse(readFileSync(path.join(modelDir, fileName), 'utf8'))
  } catch {
    return null
  }
}
