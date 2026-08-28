// dsh-mcp-live-status — BROWSER half.
//
// Registers one entry into `conversation.input.left`: the tool row INSIDE the
// composer card, right after the resident chrome (access mode, plan, attach).
//
// Why that seat. The row already holds "Full access" and the model selector —
// both answers to "what does the agent have in hand this turn". MCP is where
// tool capability comes from, so it belongs to the same mental category and the
// same decision moment. It is also the one place the user is already looking at
// the instant the information matters: just before pressing send.
//
// House rule for this file: the pill is a guest in someone else's composer.
// Every failure mode renders as ABSENCE, never as an error. A broken status
// plugin must not put a red box in the user's input area.
//
// The loader serves this file at /plugins/dsh-mcp-live-status/client.js and
// runs the factory lazily. `require` resolves the official client packages —
// bare ESM `import` does not work here.
//
window.__ModuleLoader__.load({
  id: 'dsh-mcp-live-status',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback } = React
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const NS = 'mcp-live-status'
    /** Host route registered by src/index.ts. */
    const STATUS_URL = '/dsh-mcp-live-status/status'
    /** Used until the host payload reports the configured interval. */
    const DEFAULT_POLL_MS = 10000

    // ---------------------------------------------------------------- i18n

    const zh = {
      pill: 'MCP',
      pillTitle: '{connected}/{configured} 个 MCP 服务器已连接',
      panel: 'MCP 服务器',
      refresh: '刷新',
      connected: '已连接',
      starting: '启动中',
      noTools: '已启动，未连接',
      failed: '挂载失败',
      disabled: '已停用',
      unmounted: '未挂载',
      tools: '{count} 工具',
      footer: '{configured} 个已配置 · {connected} 个已连接',
      toolsUnavailable: '工具注册表不可读，连接状态无法确认',
    }

    const en = {
      pill: 'MCP',
      pillTitle: '{connected} of {configured} MCP servers connected',
      panel: 'MCP servers',
      refresh: 'Refresh',
      connected: 'Connected',
      starting: 'Starting',
      noTools: 'Up, not connected',
      failed: 'Mount failed',
      disabled: 'Disabled',
      unmounted: 'Not mounted',
      tools: '{count} tools',
      footer: '{configured} configured · {connected} connected',
      toolsUnavailable: 'Tool registry unreadable; connectivity unconfirmed',
    }

    /** Dictionary key per host-reported state. */
    const STATE_LABEL = {
      connected: 'connected',
      starting: 'starting',
      'no-tools': 'noTools',
      failed: 'failed',
      disabled: 'disabled',
      unmounted: 'unmounted',
    }

    /** Design-token colour per state, so light and dark both read correctly. */
    const STATE_COLOR = {
      connected: 'var(--dsw-alias-state-success-primary, #3fb950)',
      starting: 'var(--dsw-alias-state-business-primary, #58a6ff)',
      'no-tools': 'var(--dsw-alias-state-warn-primary, #d29922)',
      failed: 'var(--dsw-alias-state-error-primary, #f85149)',
      disabled: 'var(--dsw-alias-label-tertiary, #8b949e)',
      unmounted: 'var(--dsw-alias-label-tertiary, #8b949e)',
    }

    /**
     * Severity order for collapsing many servers into one dot. Worst wins, so
     * the pill never looks healthier than its unhealthiest member.
     */
    const SEVERITY = { failed: 4, 'no-tools': 3, unmounted: 2, starting: 1, connected: 0, disabled: 0 }

    // --------------------------------------------------------------- store
    //
    // One poller for the whole page rather than one per mounted session body:
    // several conversation views can be mounted at once, and they would
    // otherwise each hit the host on their own schedule.

    const store = {
      /** Last successful payload, or null before the first success. */
      data: null,
      /** True once a fetch has failed; keeps the pill hidden. */
      failed: false,
      listeners: new Set(),
      timer: null,
      inflight: false,
    }

    const notify = () => { for (const fn of store.listeners) fn() }

    const pollMs = () => {
      const configured = store.data && store.data.pollIntervalMs
      return typeof configured === 'number' ? configured : DEFAULT_POLL_MS
    }

    async function refresh() {
      if (store.inflight) return
      store.inflight = true
      try {
        const res = await fetch(STATUS_URL, { cache: 'no-store' })
        if (!res.ok) throw new Error('status ' + res.status)
        const data = await res.json()
        store.data = data
        store.failed = false
      } catch {
        // The host half may simply not be installed. Hide, do not complain.
        store.failed = true
      } finally {
        store.inflight = false
        notify()
      }
    }

    function stopTimer() {
      if (store.timer !== null) {
        clearInterval(store.timer)
        store.timer = null
      }
    }

    /** Poll only while the tab is visible; a background tab learns nothing. */
    function syncTimer() {
      stopTimer()
      if (store.listeners.size === 0) return
      if (document.visibilityState !== 'visible') return
      const interval = pollMs()
      if (interval > 0) store.timer = setInterval(refresh, interval)
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') refresh()
      syncTimer()
    }

    function subscribe(fn) {
      const first = store.listeners.size === 0
      store.listeners.add(fn)
      if (first) {
        document.addEventListener('visibilitychange', onVisibility)
        refresh()
      }
      syncTimer()
      return () => {
        store.listeners.delete(fn)
        if (store.listeners.size === 0) {
          document.removeEventListener('visibilitychange', onVisibility)
          stopTimer()
        }
      }
    }

    /** Subscribe to the shared store and re-render on every change. */
    function useMcpStatus() {
      const [, force] = useState(0)
      useEffect(() => subscribe(() => force((n) => n + 1)), [])
      return { data: store.data, failed: store.failed }
    }

    // -------------------------------------------------------------- styles
    //
    // One stylesheet for states inline styles cannot express (:hover, :focus).
    // Everything else stays inline so the component has no class-name contract
    // with the shell.

    const STYLE_ID = 'dsh-mcp-live-status-style'
    const CSS = `
.dsh-mls-pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 8px; margin: 0;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; cursor: pointer;
  font: inherit; font-size: 12px; line-height: 1;
  color: var(--dsw-alias-label-secondary, #8b949e);
  white-space: nowrap; -webkit-appearance: none; appearance: none;
}
.dsh-mls-pill:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-mls-pill[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.25));
}
.dsh-mls-pill:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #58a6ff); outline-offset: 1px; }
.dsh-mls-icon { display: inline-flex; border: 0; background: transparent; padding: 2px; margin: 0;
  border-radius: 4px; cursor: pointer; color: var(--dsw-alias-label-tertiary, #8b949e); line-height: 0; }
.dsh-mls-icon:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-primary, inherit); }
.dsh-mls-spin { animation: dsh-mls-spin .7s linear infinite; }
@keyframes dsh-mls-spin { to { transform: rotate(360deg); } }
@keyframes dsh-mls-pulse { 50% { opacity: .35; } }
.dsh-mls-dot-starting { animation: dsh-mls-pulse 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .dsh-mls-spin, .dsh-mls-dot-starting { animation: none; }
}
`

    function installStyle() {
      if (document.getElementById(STYLE_ID)) return () => {}
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
      return () => el.remove()
    }

    // ----------------------------------------------------------- fragments

    const dot = (state, size) =>
      h('span', {
        className: state === 'starting' ? 'dsh-mls-dot-starting' : undefined,
        style: {
          width: size, height: size, borderRadius: '50%', flex: '0 0 auto',
          background: STATE_COLOR[state] || STATE_COLOR.unmounted,
        },
      })

    const refreshIcon = (spinning) =>
      h('svg', {
        className: spinning ? 'dsh-mls-spin' : undefined,
        width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true',
      }, h('path', { d: 'M13.6 7.2a5.6 5.6 0 1 0-.9 4' }), h('path', { d: 'M13.4 7.6V4.2M13.4 7.6h-3.2' }))

    /** One server row inside the popover. */
    function ServerRow({ server, t }) {
      const label = t(STATE_LABEL[server.state] || 'unmounted')
      const healthy = server.state === 'connected'
      // The right-hand column carries the tool count when it means something,
      // and the reason when it does not — one column, never both.
      const trailing = healthy && typeof server.toolCount === 'number'
        ? t('tools', { count: server.toolCount })
        : label

      return h('div', {
        style: { display: 'flex', alignItems: 'baseline', gap: '8px', padding: '5px 0' },
      },
        h('span', { style: { display: 'flex', alignItems: 'center', height: '16px' } }, dot(server.state, '7px')),
        h('span', {
          style: {
            flex: '1 1 auto', minWidth: 0, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: 'var(--dsw-alias-label-primary, inherit)',
          },
          title: server.target || server.entryId,
        }, server.serverName),
        h('span', {
          style: { flex: '0 0 auto', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #8b949e)' },
        }, server.transport),
        h('span', {
          style: {
            flex: '0 0 auto', fontSize: '11px', minWidth: '62px', textAlign: 'right',
            color: healthy
              ? 'var(--dsw-alias-label-secondary, #8b949e)'
              : (STATE_COLOR[server.state] || 'var(--dsw-alias-label-tertiary, #8b949e)'),
          },
        }, trailing),
      )
    }

    function Popover({ data, t, onRefresh, busy }) {
      return h('div', {
        role: 'dialog',
        'aria-label': t('panel'),
        style: {
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 60,
          minWidth: '286px', maxWidth: '380px', padding: '10px 12px',
          borderRadius: '10px',
          background: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, #161b22))',
          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
          boxShadow: 'var(--dsw-shadow-lv3, 0 8px 28px rgba(0,0,0,.35))',
          fontSize: '12px', lineHeight: 1.5, cursor: 'default',
          color: 'var(--dsw-alias-label-secondary, #8b949e)',
        },
        onClick: (e) => e.stopPropagation(),
      },
        h('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
        },
          h('span', {
            style: { fontSize: '11px', letterSpacing: '.02em', color: 'var(--dsw-alias-label-tertiary, #8b949e)' },
          }, t('panel')),
          h('button', {
            type: 'button', className: 'dsh-mls-icon', onClick: onRefresh,
            title: t('refresh'), 'aria-label': t('refresh'),
          }, refreshIcon(busy)),
        ),

        h('div', {
          style: { margin: '6px 0 0', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))', paddingTop: '2px' },
        }, data.servers.map((s) => h(ServerRow, { key: s.entryId, server: s, t }))),

        data.toolsUnavailable
          ? h('div', {
              style: {
                marginTop: '6px', paddingTop: '6px', fontSize: '11px',
                borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))',
                color: 'var(--dsw-alias-state-warn-primary, #d29922)',
              },
            }, t('toolsUnavailable'))
          : null,

        h('div', {
          style: {
            marginTop: '6px', paddingTop: '6px', fontSize: '11px',
            borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))',
            color: 'var(--dsw-alias-label-tertiary, #8b949e)',
          },
        }, t('footer', { configured: data.configured, connected: data.connected })),
      )
    }

    /**
     * The composer-row entry.
     *
     * `t` arrives from the framework because the registration declares a locale
     * namespace; the owner share (session/input) is deliberately unused — this
     * readout is profile-wide, not per-session.
     */
    function McpStatusPill(props) {
      const { t } = props
      const { data, failed } = useMcpStatus()
      const [open, setOpen] = useState(false)
      const rootRef = useRef(null)

      // Dismiss on outside click or Escape. Bound only while open, so a closed
      // pill costs the page nothing.
      useEffect(() => {
        if (!open) return undefined
        const onDocClick = (e) => {
          if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
        }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDocClick)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDocClick)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const toggle = useCallback(() => {
        setOpen((wasOpen) => {
          if (!wasOpen) refresh()
          return !wasOpen
        })
      }, [])

      // Absence over noise: no data yet, host half missing, or nothing
      // configured all render the same — nothing at all.
      if (failed || !data || !data.servers || data.servers.length === 0) return null

      const servers = data.servers
      const configured = servers.length
      const connected = data.connected
      const worst = servers.reduce(
        (acc, s) => ((SEVERITY[s.state] || 0) > (SEVERITY[acc] || 0) ? s.state : acc),
        'connected',
      )

      // The denominator appears only when it carries information. In the happy
      // path "MCP 4" is enough; showing "4/4" would make every glance a
      // comparison of two numbers instead of a check for one slash.
      const degraded = connected < configured
      const count = degraded ? `${connected}/${configured}` : String(configured)

      return h('div', { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button',
          className: 'dsh-mls-pill',
          'aria-expanded': open ? 'true' : 'false',
          'aria-haspopup': 'dialog',
          title: t('pillTitle', { connected, configured }),
          onClick: toggle,
        },
          dot(worst, '6px'),
          h('span', null, t('pill')),
          h('span', {
            style: {
              fontVariantNumeric: 'tabular-nums',
              color: degraded
                ? (STATE_COLOR[worst] || 'inherit')
                : 'var(--dsw-alias-label-primary, inherit)',
            },
          }, count),
        ),
        open ? h(Popover, { data, t, busy: store.inflight, onRefresh: refresh }) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(installStyle, 'dsh-mcp-live-status: styles')
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-live-status: dictionaries')

          // `slots.inject` follows late declaration and teardown of the owning
          // conversation entry, so load order against ui-conversation is a
          // non-issue.
          ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
            name: 'conversation.input.left',
            id: 'mcp-live-status',
            order: 20,
            locale: NS,
          }, McpStatusPill))
        } catch (e) {
          console.error('[dsh-mcp-live-status] apply failed:', e)
        }
      },
    }
  },
})
