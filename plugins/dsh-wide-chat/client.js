window.__ModuleLoader__.load({
  id: '@local/dsh-wide-chat',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    const STYLE_ID = '@local/dsh-wide-chat/client.css'

    function installStyle() {
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-wide-chat'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = `
/* Hybrid width: the text column keeps upstream width (748px, readable prose),
   only wide content — code blocks, tables — expands symmetrically beyond the
   column, centered on it, capped at 1152px (Open WebUI widescreen empirical
   cap) with horizontal scroll inside. No width jumps: the cap is fixed per
   viewport, content wider than the cap scrolls inside the block. */

/* Wide blocks only on wide viewports; laptops keep the upstream layout. */
@media (min-width: 1281px) {
  [data-chat-flow-kind="assistant-step"] pre,
  [data-chat-flow-kind="assistant-step"] table {
    /* W = min(1152px, viewport minus sidebar+margins). Negative side margins
       center the block on the prose column while letting it overflow both
       sides equally. */
    --dsh-wide-block-w: min(1152px, calc(100vw - 380px));
    width: var(--dsh-wide-block-w);
    max-width: none;
    margin-left: calc((100% - var(--dsh-wide-block-w)) / 2);
    margin-right: calc((100% - var(--dsh-wide-block-w)) / 2);
    overflow-x: auto;
  }

  /* Tables are inline-block-ish in some renderers; force block so margins work. */
  [data-chat-flow-kind="assistant-step"] table {
    display: block;
  }
}
`
      document.head.appendChild(tag)
    }

    function mount() {
      if (typeof document === 'undefined') return () => {}
      installStyle()
      return () => {
        document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)?.remove()
      }
    }

    function apply(ctx) {
      if (ctx?.effect) {
        ctx.effect(mount, 'dsh-wide-chat: hybrid width style')
        return
      }
      mount()
    }

    exports.apply = apply
    return module.exports
  }
})
