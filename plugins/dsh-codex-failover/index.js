// codex-failover — коли провайдер openai-codex впирається в ліміт підписки
// ("usage limit reached"; на дроті це PI_AI_ERROR, не QUOTA — 2026-10-07),
// підміняє значення кредешела CODEX_CHATGPT_TOKEN на токен другого акаунта
// (CODEX_CHATGPT_TOKEN_2) і повертає { kind: "retry" } — цикл повторює той
// самий крок уже на другій підписці. Сесія, модель і історія не змінюються:
// account_id живе всередині JWT, а кредешел резолвиться на кожен запит.
//
// Свідомо НЕ перемикаємось на RATE_LIMIT (per-minute 429), "model at
// capacity", мережеві збої — їх обробляє dsh-llm-retry backoff-ом на тому
// самому акаунті. Ротація — тільки на реальне вичерпання квоти.
//
// Одноразово за процес (флаг failedOver): після перемикання повторні QUOTA
// летять у сесію як звичайні помилки, флип-флопу немає. Первинний токен
// відновлює scripts/sync-codex-token.mjs при наступному плановому запуску.
//
// Конфіг (cordis.patch.yml, усі поля необов'язкові):
//   provider:    роут провайдера (default "openai-codex")
//   primaryRef:  активний кредешел (default "CODEX_CHATGPT_TOKEN")
//   backupRef:   кредешел запасного акаунта (default "CODEX_CHATGPT_TOKEN_2")

export const name = "codex-failover";
export const inject = ["agents"];

export function apply(ctx, config = {}) {
  const provider = config.provider ?? "openai-codex";
  const primaryRef = config.primaryRef ?? "CODEX_CHATGPT_TOKEN";
  const backupRef = config.backupRef ?? "CODEX_CHATGPT_TOKEN_2";
  let failedOver = false;
  let switching;

  ctx.on("agent/request-error", async (payload, next) => {
    if (failedOver) return next();
    if (payload?.provider !== provider) return next();
    const failure = payload?.failure;
    const isQuota =
      failure?.code === "QUOTA" ||
      // pi-ai віддає ліміт підписки ChatGPT як PI_AI_ERROR — код ненадійний,
      // пізнаємо квоту по тексту ("usage limit reached" / "hit your ... usage limit").
      // Per-minute 429 звучить як "rate limit" і сюди не потрапляє.
      /usage limit/i.test(failure?.message ?? "");
    if (!isQuota || /rate limit|too many requests/i.test(failure?.message ?? '') || payload.signal?.aborted) return next();
    if (switching) { await switching; return { kind: 'retry' }; }

    const credentials = ctx.get("credentials");
    if (!credentials) {
      ctx.logger.warn("codex-failover: немає сервісу credentials — ротація неможлива");
      return next();
    }

    let backup;
    try {
      backup = (await credentials.resolve(backupRef))?.value;
    } catch (error) {
      ctx.logger.warn("codex-failover: не зміг прочитати %s: %s", backupRef, error?.message);
      return next();
    }
    if (!backup) {
      ctx.logger.warn(
        "codex-failover: %s вичерпано, але %s порожній — додай токен другого акаунта " +
          "(CODEX_HOME=~/.codex-acc2 codex login, потім scripts/sync-codex-token.mjs)",
        primaryRef,
        backupRef,
      );
      return next();
    }

    try {
      const current = (await credentials.resolve(primaryRef))?.value;
      if (current === backup) {
        // Уже працюємо на запасному акаунті — далі перемикати нікуди.
        failedOver = true;
        return next();
      }
      switching = credentials.set(primaryRef, backup);
      await switching;
    } catch (error) {
      ctx.logger.warn("codex-failover: не зміг записати %s: %s", primaryRef, error?.message);
      return next();
    } finally {
      switching = undefined;
    }

    failedOver = true;
    ctx.logger.warn("codex-failover: %s вичерпано (QUOTA) — %s переведено на %s, повторюю крок", provider, primaryRef, backupRef);
    // Custom session events are rejected on replay by this runtime, and
    // Session.append does not support the ignorable envelope marker.
    // Keep the diagnostic in the logger without changing durable history.
    return { kind: "retry" };
  });
}
