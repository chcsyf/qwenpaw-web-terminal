(function () {
  'use strict';

  if (!window.QwenPaw || !window.QwenPaw.host) {
    console.error("[qwenpaw-web-terminal] QwenPaw not ready");
    return;
  }

  var QP = window.QwenPaw;
  var React = QP.host.React;
  var h = React.createElement;

  var PLUGIN_ID = "qwenpaw-web-terminal";
  var API_BASE = "/api/qwenpaw-web-terminal";
  var FILES_BASE = "/api/plugins/" + PLUGIN_ID + "/files/ui/vendor";
  var VERSION = "0.1.0";

  // ============ 样式（GitHub Dark） ============
  var S = {
    container: {
      display: 'flex', flexDirection: 'column', position: 'relative',
      // 跟随 QwenPaw console 宿主面板高度（#root/body 为 height:100% + overflow:hidden 的固定视口布局），
      // 不使用 100vh，避免叠加 console header 后超出视口产生滚动条
      height: '100%', minHeight: 0, boxSizing: 'border-box',
      background: '#0d1117',
      color: '#c9d1d9', fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
      fontSize: '13px', padding: '16px'
    },
    header: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' },
    title: { fontSize: '18px', fontWeight: 'bold', color: '#58a6ff' },
    badge: { padding: '4px 10px', borderRadius: '12px', fontSize: '12px', background: 'rgba(88,166,255,0.15)', color: '#58a6ff', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    badgeGreen: { background: 'rgba(63,185,80,0.15)', color: '#3fb950' },
    tab: {
      padding: '6px 14px', borderRadius: '6px', border: '1px solid #30363d',
      background: '#21262d', color: '#c9d1d9', cursor: 'pointer', fontSize: '13px'
    },
    tabActive: { background: '#1f6feb', borderColor: '#1f6feb', color: '#fff' },
    tabbar: { display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' },
    tabItem: {
      display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '6px',
      border: '1px solid #30363d', background: '#21262d', color: '#c9d1d9', cursor: 'pointer', fontSize: '12px'
    },
    tabItemActive: { background: '#1f6feb', borderColor: '#1f6feb', color: '#fff' },
    tabClose: { cursor: 'pointer', fontSize: '15px', lineHeight: '1', padding: '0 2px', opacity: 0.75 },
    button: {
      padding: '6px 12px', borderRadius: '6px', border: '1px solid #30363d',
      background: '#21262d', color: '#c9d1d9', cursor: 'pointer', fontSize: '12px'
    },
    buttonAccent: { background: 'rgba(88,166,255,0.15)', borderColor: '#1f6feb', color: '#58a6ff' },
    body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: '200px' },
    termWrap: {
      flex: 1, background: '#010409', border: '1px solid #30363d', borderRadius: '8px',
      padding: '10px', overflow: 'hidden', minHeight: '0'
    },
    hint: {
      color: '#8b949e', fontSize: '11px', lineHeight: '1.4',
      marginTop: '4px', flexShrink: 0, whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis'
    },
    wsStatus: { fontSize: '12px', padding: '4px 10px', borderRadius: '12px' },
    toast: {
      position: 'absolute', top: '58px', right: '16px', zIndex: 100,
      background: 'rgba(22,27,34,0.94)', color: '#c9d1d9',
      border: '1px solid #30363d', borderRadius: '6px',
      padding: '6px 12px', fontSize: '12px', maxWidth: '340px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
    },
    // 会话管理面板
    modalOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(1,4,9,0.65)', zIndex: 200,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '24px', overflow: 'auto'
    },
    modal: {
      background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px',
      maxWidth: '900px', width: '100%', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      fontSize: '12px'
    },
    modalHeader: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: '1px solid #30363d', flexWrap: 'wrap', gap: '6px'
    },
    mgrTable: { width: '100%', borderCollapse: 'collapse' },
    mgrTh: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #30363d', color: '#8b949e', fontWeight: 600 },
    mgrTd: { padding: '6px 10px', borderBottom: '1px solid #21262d', verticalAlign: 'top' },
    mgrBtn: {
      padding: '3px 8px', borderRadius: '4px', border: '1px solid #30363d',
      background: '#21262d', color: '#c9d1d9', cursor: 'pointer', fontSize: '11px', marginRight: '4px'
    },
    mgrBtnDanger: { background: 'rgba(248,81,73,0.12)', borderColor: '#f85149', color: '#f85149' },
    mgrBtnOk: { background: 'rgba(63,185,80,0.12)', borderColor: '#3fb950', color: '#3fb950' },
    mgrEmpty: { padding: '14px', color: '#8b949e', textAlign: 'center' }
  };

  // ============ xterm.js 加载 ============
  function loadVendor(onReady) {
    // CSS
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = FILES_BASE + '/xterm.css';
    document.head.appendChild(css);
    // JS（xterm.js 与 fit addon 同步加载）
    function loadScript(src, next) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { next(); };
      s.onerror = function () { next(); };
      document.head.appendChild(s);
    }
    if (window.Terminal) { onReady(); return; }
    loadScript(FILES_BASE + '/xterm.js', function () {
      if (!window.Terminal) { console.error('[qwenpaw-web-terminal] xterm.js 加载失败'); return; }
      if (window.FitAddon) { onReady(); return; }
      loadScript(FILES_BASE + '/xterm-addon-fit.js', onReady);
    });
  }

  // ============ 工具函数 ============
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 从输出流中提取 OSC 7 cwd 序列，返回 { clean, paths }
  function extractOsc7(text) {
    var paths = [];
    var clean = text.replace(/\x1b\]7;file:\/\/[^\x07]*?\x07/g, function (full) {
      var p = full.slice(8, -1); // 去掉 ESC]7; 与 ST
      var slash = p.indexOf('/');
      if (slash >= 0) paths.push(p.slice(slash));
      return '';
    });
    return { clean: clean, paths: paths };
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // 读取 console 当前选中的智能体 id（与主前端一致：qwenpaw-agent-storage.state.selectedAgent）
  function agentHeaders() {
    var h = {};
    try {
      var i = sessionStorage.getItem('qwenpaw-agent-storage') || localStorage.getItem('qwenpaw-agent-storage');
      if (i) {
        var n = JSON.parse(i);
        var o = n && n.state && n.state.selectedAgent;
        if (o) h['X-Agent-Id'] = o;
      }
    } catch (e) { /* ignore */ }
    return h;
  }

  // 标签布局持久化（localStorage）：刷新页面后恢复上次打开的标签；
  // 后端会话全量放「会话管理」面板查看，标签栏只保留用户主动打开过的会话
  var LS_TABS = 'qwenpaw-web-terminal.tabs.v1';
  function loadSavedTabs() {
    try {
      var raw = localStorage.getItem(LS_TABS);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (x) { return typeof x === 'string' && x; });
    } catch (e) { return []; }
  }
  function saveTabs(ids) {
    try { localStorage.setItem(LS_TABS, JSON.stringify(ids)); } catch (e) { /* ignore */ }
  }

  // ============ 终端组件（多标签） ============
  function TerminalComponent() {
    var tabsRef = React.useRef(new Map());   // id -> tab 实例 {id, term, fit, ws, buf, cwd, wsState, reconnectCount, reconnectTimer, pending}
    var mountsRef = React.useRef({});        // id -> 挂载 DOM
    var tabOrderRef = React.useRef([]);      // 有序 id 数组（镜像 state，供闭包同步读取）
    var activeIdRef = React.useRef(null);    // 当前激活 id（镜像 state）
    var modeRef = React.useRef('pty');
    var vendorReadyRef = React.useRef(false);
    var toastTimerRef = React.useRef(null);

    var [tabOrder, setTabOrder] = React.useState([]);
    var [activeId, setActiveId] = React.useState(null);
    var [mode, setMode] = React.useState('pty');
    var [version, setVersion] = React.useState('');
    var [vendorReady, setVendorReady] = React.useState(false);
    var [wsStates, setWsStates] = React.useState({});  // id -> closed|connecting|open
    var [cwdMap, setCwdMap] = React.useState({});      // id -> cwd
    var [toast, setToast] = React.useState(null);      // 右上角临时提示（不写入终端，避免打断内容）
    var [showMgr, setShowMgr] = React.useState(false); // 会话管理面板
    var [mgrData, setMgrData] = React.useState(null);  // {sessions:[...]} 或 {error}
    var [mgrLoading, setMgrLoading] = React.useState(false);

    // ---- tab 实例管理 ----
    function getTab(id) {
      if (!tabsRef.current.has(id)) {
        tabsRef.current.set(id, {
          id: id,
          term: null, fit: null, ws: null, buf: '',
          cwd: '', wsState: 'closed', pending: '',
          reconnectCount: 0, reconnectTimer: null
        });
      }
      return tabsRef.current.get(id);
    }

    function setTabWsState(id, s) {
      var t = getTab(id);
      t.wsState = s;
      setWsStates(function (prev) { var n = Object.assign({}, prev); n[id] = s; return n; });
    }

    function setTabCwd(id, cwd) {
      var t = getTab(id);
      t.cwd = cwd;
      setCwdMap(function (prev) { var n = Object.assign({}, prev); n[id] = cwd; return n; });
    }

    function activateTab(id) {
      activeIdRef.current = id;
      setActiveId(id);
    }

    // ---- 基础写入 ----
    function writeTo(tab, text) {
      if (tab.term) {
        try { tab.term.write(text); } catch (e) { /* ignore */ }
      } else {
        tab.pending += text;
      }
    }

    function writePromptTo(tab) {
      writeTo(tab, '\x1b[92m' + (tab.cwd || '~') + ' $ \x1b[0m');
    }

    // 右上角临时提示（toast）：不写入终端流，避免打断当前内容
    function showToast(text) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ text: text, ts: Date.now() });
      toastTimerRef.current = setTimeout(function () { setToast(null); }, 2500);
    }

    // ---- exec 模式：提交命令 ----
    function runExec(tab, cmd) {
      cmd = cmd.trim();
      if (!cmd) return;
      writeTo(tab, '\r\n\x1b[92m$ ' + cmd + '\x1b[0m\r\n');
      tab.buf = '';
      fetch(API_BASE + '/exec', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, agentHeaders()),
        body: JSON.stringify({ cmd: cmd, session_id: tab.id })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) {
            if (d.stdout) writeTo(tab, d.stdout.replace(/\n$/, '') + '\r\n');
            if (d.stderr) writeTo(tab, '\x1b[91m' + d.stderr.replace(/\n$/, '') + '\x1b[0m\r\n');
            if (d.exit_code !== 0) {
              writeTo(tab, '\x1b[91m[退出码 ' + d.exit_code + ']\x1b[0m\r\n');
            }
            if (d.cwd) setTabCwd(tab.id, d.cwd);
          } else {
            writeTo(tab, '\x1b[91m' + escapeHtml((d && d.error) || '执行失败') + '\x1b[0m\r\n');
          }
          writePromptTo(tab);
        })
        .catch(function (err) {
          writeTo(tab, '\x1b[91m请求失败: ' + escapeHtml(err.message) + '\x1b[0m\r\n');
          writePromptTo(tab);
        });
    }

    // ---- 模式切换（全局；影响当前激活标签） ----
    function switchMode(m) {
      if (m === modeRef.current) return;
      modeRef.current = m;
      setMode(m);
      var tab = activeIdRef.current ? getTab(activeIdRef.current) : null;
      if (!tab) return;
      if (m === 'pty') {
        tab.buf = '';
        if (tab.term) tab.term.clear();
        ensureConnected(tab);
      } else {
        closeWsFor(tab);
        tab.buf = '';
        if (tab.term) {
          tab.term.clear();
          writePromptTo(tab);
        }
      }
    }

    // ---- WebSocket（每个标签独立） ----
    function closeWsFor(tab) {
      if (tab.reconnectTimer) {
        clearTimeout(tab.reconnectTimer);
        tab.reconnectTimer = null;
      }
      tab.reconnectCount = 0;
      tab.pendingInput = '';
      if (tab.ws) {
        try { tab.ws.close(); } catch (e) { /* ignore */ }
        tab.ws = null;
      }
      setTabWsState(tab.id, 'closed');
    }

    function openWsFor(tab) {
      if (tab.reconnectTimer) {
        clearTimeout(tab.reconnectTimer);
        tab.reconnectTimer = null;
      }
      tab.reconnectCount = 0;
      if (tab.ws) {
        try { tab.ws.close(); } catch (e) { /* ignore */ }
        tab.ws = null;
      }
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      var url = proto + location.host + API_BASE + '/ws?session=' + encodeURIComponent(tab.id);
      setTabWsState(tab.id, 'connecting');
      var ws = new WebSocket(url);
      tab.ws = ws;
      ws.onopen = function () {
        if (tab.ws !== ws) return; // 已被替换/主动关闭的旧连接
        tab.reconnectCount = 0;
        setTabWsState(tab.id, 'open');
        showToast('已连接交互式终端（' + tab.id + '）');
        // 清除未连接提示行（bash 输出在 onopen 之后才到达，清屏不影响后续输出）
        if (tab.term) {
          try { tab.term.clear(); } catch (e) { /* ignore */ }
        }
        // 补发连接期间暂存的输入（输入触发的连接不丢首字符）
        if (tab.pendingInput) {
          try { ws.send(tab.pendingInput); } catch (e) { /* ignore */ }
          tab.pendingInput = '';
        }
        sendResizeFor(tab);
      };
      ws.onmessage = function (ev) {
        if (tab.ws !== ws) return; // 旧连接的迟到帧一律丢弃
        var data = ev.data || '';
        if (data === '\x00pong') return;
        if (data.indexOf('\x00') === 0) return; // 其他控制帧忽略
        var parsed = extractOsc7(data);
        if (parsed.paths.length) setTabCwd(tab.id, parsed.paths[parsed.paths.length - 1]);
        if (parsed.clean) writeTo(tab, parsed.clean);
      };
      ws.onclose = function () {
        if (tab.ws !== ws) return; // 被替换/主动关闭的旧连接：不触发重连
        setTabWsState(tab.id, 'closed');
        showToast('连接已关闭（' + tab.id + '）');
        if (modeRef.current === 'pty' && tab.reconnectCount < 5) {
          tab.reconnectCount++;
          var delay = tab.reconnectCount * 1500;
          showToast('将在 ' + (delay / 1000) + ' 秒后自动重连（' + tab.reconnectCount + '/5）...');
          tab.reconnectTimer = setTimeout(function () { openWsFor(tab); }, delay);
        }
      };
      ws.onerror = function () {
        if (tab.ws !== ws) return;
        // 只提示；重连统一由 onclose 驱动
        setTabWsState(tab.id, 'closed');
        showToast('连接错误（' + tab.id + '）');
      };
    }

    function ensureConnected(tab) {
      if (modeRef.current !== 'pty') return;
      if (tab.ws && (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING)) return;
      openWsFor(tab);
    }

    function sendResizeFor(tab) {
      if (!tab.ws || tab.ws.readyState !== WebSocket.OPEN) return;
      if (!tab.term) return;
      try { tab.ws.send('\x00resize:' + tab.term.cols + ':' + tab.term.rows); } catch (e) { /* ignore */ }
    }

    function fitFor(tab) {
      if (!tab.fit || !tab.term) return;
      if (tab.id !== activeIdRef.current) return; // 只对可见标签 fit
      try { tab.fit.fit(); sendResizeFor(tab); } catch (e) { /* ignore */ }
    }

    // ---- 标签初始化 ----
    function initTermIfNeeded(tab) {
      if (tab.term || !vendorReadyRef.current) return;
      var mount = mountsRef.current[tab.id];
      if (!mount) return;
      var t = new window.Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
        scrollback: 5000,
        theme: {
          background: '#010409', foreground: '#c9d1d9', cursor: '#58a6ff', cursorAccent: '#010409',
          selectionBackground: 'rgba(56,139,253,0.4)',
          black: '#484f58', red: '#f85149', green: '#3fb950', yellow: '#d29922',
          blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#c9d1d9',
          brightBlack: '#6e7681', brightRed: '#ff7b72', brightGreen: '#3fb950', brightYellow: '#d29922',
          brightBlue: '#58a6ff', brightMagenta: '#bc8cff', brightCyan: '#39c5cf', brightWhite: '#f0f6fc'
        }
      });
      var FitAddonClass = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
      if (FitAddonClass) {
        var fit = new FitAddonClass();
        t.loadAddon(fit);
        tab.fit = fit;
      }
      tab.term = t;
      t.open(mount);
      try { tab.fit && tab.fit.fit(); } catch (e) { /* ignore */ }
      // 补发 WS 连接期间暂存的输出
      if (tab.pending) {
        try { t.write(tab.pending); } catch (e) { /* ignore */ }
        tab.pending = '';
      }
      if (modeRef.current === 'exec') writePromptTo(tab);

      // pty 且未连接：显示灰色提示行；连接成功（onopen）后自动清除
      var wsActive = tab.ws && (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING);
      if (modeRef.current === 'pty' && !wsActive) {
        writeTo(tab, '\x1b[90m○ 未连接 — 输入任意字符或点击「重连」开始交互\x1b[0m\r\n');
      }

      // 输入处理：路由到本标签的 ws / buf
      t.onData(function (data) {
        if (modeRef.current === 'pty') {
          if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
            tab.ws.send(data);
          } else if (tab.ws && tab.ws.readyState === WebSocket.CONNECTING) {
            // 连接中：暂存输入，onopen 后补发
            tab.pendingInput = (tab.pendingInput || '') + data;
          } else {
            // 未连接：输入即触发连接，首字符不丢
            tab.pendingInput = (tab.pendingInput || '') + data;
            ensureConnected(tab);
          }
          return;
        }
        // exec 模式：本地输入缓冲
        for (var i = 0; i < data.length; i++) {
          var ch = data.charAt(i);
          if (ch === '\r' || ch === '\n') {
            var cmd = tab.buf;
            tab.buf = '';
            runExec(tab, cmd);
          } else if (ch === '\x7f') { // Backspace
            if (tab.buf.length) {
              tab.buf = tab.buf.slice(0, -1);
              writeTo(tab, '\b \b');
            }
          } else if (ch === '\x03') { // Ctrl+C
            tab.buf = '';
            writeTo(tab, '^C\r\n');
            writePromptTo(tab);
          } else if (ch >= ' ' || ch === '\t') {
            tab.buf += ch;
            writeTo(tab, ch);
          }
        }
      });
      t.onResize(function () { sendResizeFor(tab); });
    }

    // ---- 标签操作 ----
    function createTab(id) {
      // 已存在且已在标签栏 → 仅切换；否则补齐 tabOrder（修复：newTab 先 getTab 导致
      // 误判已存在而走 switchTab，新标签从不进入 tabOrder 的 bug）
      if (tabsRef.current.has(id) && tabOrderRef.current.indexOf(id) >= 0) {
        switchTab(id);
        return;
      }
      getTab(id);
      if (tabOrderRef.current.indexOf(id) < 0) {
        var order = tabOrderRef.current.concat([id]);
        tabOrderRef.current = order;
        setTabOrder(order);
        saveTabs(order);
      }
      activateTab(id);
      // 渲染后由 useEffect 完成 init + connect
    }

    function switchTab(id) {
      if (id === activeIdRef.current) return;
      // 保险：id 若不在标签栏（例如被初始化恢复覆盖过），先补回
      if (tabOrderRef.current.indexOf(id) < 0) {
        var order = tabOrderRef.current.concat([id]);
        tabOrderRef.current = order;
        setTabOrder(order);
      }
      activateTab(id);
      var tab = getTab(id);
      initTermIfNeeded(tab);
      ensureConnected(tab);
      setTimeout(function () { fitFor(tab); }, 30);
    }

    function newTab() {
      var name = window.prompt('新会话 ID（字母/数字/中划线）：', 's' + Math.floor(Date.now() / 1000).toString(36));
      if (!name) return;
      name = String(name).trim().replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!name) return;
      fetch(API_BASE + '/sessions', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, agentHeaders()),
        body: JSON.stringify({ id: name })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) {
            var tab = getTab(name);
            tab.cwd = d.cwd || '';
            createTab(name);
            ensureConnected(tab);
          } else {
            window.alert((d && d.error) || '创建失败');
          }
        });
    }

    function closeTab(id) {
      var tab = tabsRef.current.get(id);
      if (tab) {
        closeWsFor(tab);          // 前端主动断开 → 后端 killpg 结束该终端 bash
        if (tab.term) {
          try { tab.term.dispose(); } catch (e) { /* ignore */ }
          tab.term = null;
          tab.fit = null;
        }
      }
      tabsRef.current.delete(id);
      delete mountsRef.current[id];
      // 清理后端会话状态（兜底杀活跃 PTY）
      fetch(API_BASE + '/sessions/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function () {});
      var idx = tabOrderRef.current.indexOf(id);
      var order = tabOrderRef.current.filter(function (x) { return x !== id; });
      tabOrderRef.current = order;
      setTabOrder(order);
      saveTabs(order);
      setWsStates(function (prev) { var n = Object.assign({}, prev); delete n[id]; return n; });
      setCwdMap(function (prev) { var n = Object.assign({}, prev); delete n[id]; return n; });
      if (activeIdRef.current === id) {
        if (order.length) {
          var next = order[Math.min(Math.max(idx, 0), order.length - 1)]; // 优先右侧邻居
          activateTab(next);
        } else {
          activeIdRef.current = null;
          setActiveId(null);
          createTab('default'); // 全关完自动开 default
        }
      }
    }

    // ---- 复制 / 粘贴（作用于激活标签） ----
    function activeTab() {
      return activeIdRef.current ? getTab(activeIdRef.current) : null;
    }

    function copySelection() {
      var tab = activeTab();
      var sel = tab && tab.term && tab.term.getSelection();
      if (!sel) { showToast('请先用鼠标选择文本'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sel).then(function () { showToast('已复制'); });
      } else {
        window.prompt('复制以下文本：', sel);
      }
    }

    function pasteClipboard() {
      var tab = activeTab();
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) {
          if (t && tab && tab.term) tab.term.paste(t);
        }).catch(function () { showToast('浏览器未授权剪贴板读取，请用 Ctrl+V'); });
      } else {
        showToast('请使用 Ctrl+Shift+V 粘贴');
      }
    }

    // ---- 会话管理面板 ----
    function fmtBytes(n) {
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1048576).toFixed(1) + ' MB';
    }
    function fmtTime(t) {
      if (!t) return '—';
      return new Date(t * 1000).toLocaleTimeString();
    }
    function ptyBadge(s) {
      if (!s || !s.pty) return h('span', { style: { color: '#8b949e' } }, '—');
      var p = s.pty;
      if (!p.running) return h('span', { style: { color: '#8b949e' } }, '空闲');
      if (p.connected) return h('span', { style: { color: '#3fb950' } }, '● 运行中·已连接');
      return h('span', { style: { color: '#d29922' } },
        '◉ 后台运行' + (p.buffered ? '（缓冲 ' + fmtBytes(p.buffered) + '）' : ''));
    }
    function refreshMgr() {
      setMgrLoading(true);
      fetch(API_BASE + '/sessions')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          setMgrData((d && d.ok) ? d : { sessions: [], error: (d && d.error) || '加载失败' });
          setMgrLoading(false);
        })
        .catch(function () { setMgrData({ sessions: [], error: '请求失败' }); setMgrLoading(false); });
    }
    function openMgr() { refreshMgr(); setShowMgr(true); }
    function closeMgr() { setShowMgr(false); }
    function mgrOpenSession(id) {
      var tab = getTab(id);
      if (tabOrderRef.current.indexOf(id) < 0) createTab(id);
      else switchTab(id);
      ensureConnected(getTab(id));
      setShowMgr(false);
      showToast('已打开会话：' + id + '（后台进程将自动 attach）');
    }
    function mgrKillSession(id) {
      fetch(API_BASE + '/sessions/' + encodeURIComponent(id) + '/kill', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) { refreshMgr(); showToast('已结束进程：' + id + (d && d.killed ? '' : '（无运行进程）')); });
    }
    function mgrDeleteSession(id) {
      fetch(API_BASE + '/sessions/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function () {
          // 若该会话是打开的标签，一并关掉
          if (tabsRef.current.has(id)) closeTab(id);
          refreshMgr();
          showToast('已删除会话：' + id);
        });
    }
    function mgrKillAllIdle() {
      var list = (mgrData && mgrData.sessions) || [];
      var idle = list.filter(function (s) { return s.pty && s.pty.detached; });
      if (!idle.length) { showToast('没有后台空闲会话'); return; }
      var ids = idle.map(function (s) { return s.id; });
      var p = Promise.resolve();
      ids.forEach(function (id) {
        p = p.then(function () {
          return fetch(API_BASE + '/sessions/' + encodeURIComponent(id) + '/kill', { method: 'POST' });
        });
      });
      p.then(function () { refreshMgr(); showToast('已结束 ' + ids.length + ' 个后台会话'); });
    }
    function mgrCreateSession() {
      var name = window.prompt('新会话 ID（字母/数字/中划线）：', 's' + Math.floor(Date.now() / 1000).toString(36));
      if (!name) return;
      name = String(name).trim().replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!name) return;
      fetch(API_BASE + '/sessions', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, agentHeaders()),
        body: JSON.stringify({ id: name })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) { refreshMgr(); showToast('已创建会话：' + name); }
          else { window.alert((d && d.error) || '创建失败'); }
        });
    }

    // ---- 初始化：加载 vendor ----
    React.useEffect(function () {
      loadVendor(function () {
        vendorReadyRef.current = true;
        setVendorReady(true);
      });
      return function () {};
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 初始化：数据 + 恢复已有会话为标签 ----
    React.useEffect(function () {
      fetch(API_BASE + '/status')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) setVersion(d.version || VERSION);
        })
        .catch(function () {});
      fetch(API_BASE + '/sessions')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var list = (d && d.ok && d.sessions) ? d.sessions : [];
          var sessMap = {};
          list.forEach(function (s) { sessMap[s.id] = s; });
          var agentId = agentHeaders()['X-Agent-Id'] || 'default';
          // 标签 = 上次打开的（localStorage）；首次进入 = 当前智能体会话（或 default）
          var saved = loadSavedTabs();
          var ids;
          if (saved.length) {
            ids = saved;
          } else {
            ids = [];
            if (sessMap[agentId]) ids.push(agentId);
            if (ids.indexOf('default') < 0) ids.push('default');
          }
          var cwdInit = {};
          var order = [];
          ids.forEach(function (id) {
            if (!id) return;
            var tab = getTab(id);
            if (sessMap[id]) {
              tab.cwd = sessMap[id].cwd || '';
              cwdInit[id] = sessMap[id].cwd || '';
            }
            if (order.indexOf(id) < 0) order.push(id);
          });
          if (order.length) {
            tabOrderRef.current = order;
            setTabOrder(order);
            setCwdMap(function (prev) { return Object.assign({}, prev, cwdInit); });
            if (activeIdRef.current === null) {
              var target = order.indexOf(agentId) >= 0 ? agentId : order[0];
              activateTab(target);
            }
          } else {
            createTab('default');
          }
        })
        .catch(function () {
          createTab('default');
        });
      return function () {};
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 激活标签：初始化 term（不自动连接；连接由用户交互触发） ----
    React.useEffect(function () {
      if (!vendorReady) return;
      var id = activeId;
      if (!id) return;
      var tab = getTab(id);
      initTermIfNeeded(tab);
      setTimeout(function () { fitFor(tab); }, 30);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId, vendorReady, tabOrder]);

    // ---- 窗口 resize 自动适配 ----
    React.useEffect(function () {
      var onWinResize = debounce(function () {
        var tab = activeTab();
        if (tab) fitFor(tab);
      }, 250);
      window.addEventListener('resize', onWinResize);
      return function () { window.removeEventListener('resize', onWinResize); };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 卸载：关闭所有标签的 WS（后端杀 PTY）并释放 xterm ----
    React.useEffect(function () {
      return function () {
        tabsRef.current.forEach(function (tab) {
          closeWsFor(tab);
        });
        tabsRef.current.forEach(function (tab) {
          if (tab.term) { try { tab.term.dispose(); } catch (e) { /* ignore */ } }
        });
        tabsRef.current.clear();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 渲染 ----
    function renderWsStatus(state) {
      var color = state === 'open' ? '#3fb950' : (state === 'connecting' ? '#d29922' : '#f85149');
      return h('span', { style: Object.assign({}, S.wsStatus, { color: color, border: '1px solid ' + color }) },
        state === 'open' ? '● 已连接' : (state === 'connecting' ? '◌ 连接中' : '○ 未连接'));
    }

    var activeCwd = (activeId && (cwdMap[activeId] || '')) || '';
    var activeWsState = (activeId && wsStates[activeId]) || 'closed';

    return h('div', { style: S.container }, [
      h('div', { style: S.header }, [
        h('span', { style: S.title }, '🖥️ Web 终端'),
        h('span', { style: S.badge }, 'v' + (version || VERSION)),
        h('span', { style: Object.assign({}, S.badge, S.badgeGreen) }, '📁 ' + (activeCwd || '~')),
        renderWsStatus(activeWsState),
        h('button', { style: Object.assign({}, S.button, S.buttonAccent), onClick: newTab }, '＋ 新标签'),
        h('button', { style: Object.assign({}, S.button, S.buttonAccent), onClick: openMgr }, '🗂 会话管理'),
        h('button', { style: Object.assign({}, S.tab, mode === 'pty' ? S.tabActive : {}), onClick: function () { switchMode('pty'); } }, '🖥️ 交互式终端'),
        h('button', { style: Object.assign({}, S.tab, mode === 'exec' ? S.tabActive : {}), onClick: function () { switchMode('exec'); } }, '⚡ 单条命令'),
        h('button', { style: S.button, onClick: copySelection }, '复制'),
        h('button', { style: S.button, onClick: pasteClipboard }, '粘贴'),
        h('button', {
          style: S.button,
          onClick: function () { var tab = activeTab(); if (tab) ensureConnected(tab); },
          disabled: mode !== 'pty' || !activeId
        }, '重连')
      ]),
      // 标签栏
      tabOrder.length ? h('div', { style: S.tabbar }, tabOrder.map(function (tid) {
        var isActive = tid === activeId;
        return h('div', {
          key: tid,
          style: Object.assign({}, S.tabItem, isActive ? S.tabItemActive : {}),
          onClick: function () { switchTab(tid); }
        }, [
          h('span', { style: { maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tid),
          h('span', {
            style: S.tabClose,
            title: '关闭标签（结束该终端）',
            onClick: function (e) { e.stopPropagation(); closeTab(tid); }
          }, '×')
        ]);
      })) : null,
      // 每个标签一个挂载容器；隐藏的 display:none，切换时 fit 修正
      h('div', { style: S.body }, tabOrder.map(function (tid) {
        return h('div', {
          key: tid,
          ref: function (el) { mountsRef.current[tid] = el; },
          style: Object.assign({}, S.termWrap, tid === activeId ? {} : { display: 'none' })
        });
      })),
      h('div', { style: S.hint },
        '多标签：每标签独立终端，切换不中断，点 × 关闭并结束该终端 | 刷新/断网时终端转入后台保留（输出缓冲），可在「🗂 会话管理」查看、结束或清理 | 模式：' + (mode === 'pty' ? '交互式 PTY' : '单条命令 exec') +
        ' | 复制：选中后点「复制」 | 粘贴：点「粘贴」或 Ctrl+Shift+V | 断开自动重连（最多 5 次）'),
      // 会话管理面板
      showMgr ? h('div', {
        style: S.modalOverlay,
        onClick: function (e) { if (e.target === e.currentTarget) closeMgr(); }
      }, [
        h('div', { style: S.modal }, [
          h('div', { style: S.modalHeader }, [
            h('span', { style: { fontSize: '15px', fontWeight: 'bold', color: '#58a6ff' } }, '🗂 会话管理'),
            h('div', {}, [
              h('button', { style: S.mgrBtn, onClick: refreshMgr }, '⟳ 刷新'),
              h('button', { style: Object.assign({}, S.mgrBtn, S.mgrBtnOk), onClick: mgrCreateSession }, '＋ 新建会话'),
              h('button', { style: Object.assign({}, S.mgrBtn, S.mgrBtnDanger), onClick: mgrKillAllIdle }, '结束所有后台会话'),
              h('button', { style: S.mgrBtn, onClick: closeMgr }, '✕ 关闭')
            ])
          ]),
          (mgrLoading && !mgrData) ? h('div', { style: S.mgrEmpty }, '加载中...') : null,
          mgrData ? h('table', { style: S.mgrTable }, [
            h('thead', {}, h('tr', {}, [
              h('th', { style: S.mgrTh }, '会话'),
              h('th', { style: S.mgrTh }, '状态'),
              h('th', { style: S.mgrTh }, 'PID'),
              h('th', { style: S.mgrTh }, '最后活动'),
              h('th', { style: S.mgrTh }, '操作')
            ])),
            h('tbody', {}, (mgrData.sessions || []).map(function (s) {
              return h('tr', { key: s.id }, [
                h('td', { style: S.mgrTd }, [
                  h('div', { style: { fontWeight: 600, color: '#e6edf3' } }, s.id),
                  h('div', { style: { color: '#8b949e', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.cwd || '~')
                ]),
                h('td', { style: S.mgrTd }, ptyBadge(s)),
                h('td', { style: S.mgrTd }, (s.pty && s.pty.pid) ? s.pty.pid : '—'),
                h('td', { style: S.mgrTd }, fmtTime(s.last_activity)),
                h('td', { style: S.mgrTd }, [
                  h('button', { style: Object.assign({}, S.mgrBtn, S.mgrBtnOk), onClick: function () { mgrOpenSession(s.id); } }, '打开'),
                  h('button', {
                    style: S.mgrBtn,
                    onClick: function () { mgrKillSession(s.id); },
                    disabled: !(s.pty && s.pty.running)
                  }, '结束'),
                  h('button', { style: Object.assign({}, S.mgrBtn, S.mgrBtnDanger), onClick: function () { mgrDeleteSession(s.id); } }, '删除')
                ])
              ]);
            })),
            (!mgrData.sessions || !mgrData.sessions.length) ? h('tr', {}, h('td', { colSpan: 5, style: S.mgrEmpty }, '暂无会话 — 点「＋ 新建会话」创建')) : null
          ]) : null
        ])
      ]) : null,
      toast ? h('div', { style: S.toast }, toast.text) : null
    ]);
  }

  // ============ 注册（三件套） ============
  if (QP.registerRoutes) {
    try {
      QP.registerRoutes(PLUGIN_ID, [{ path: "/apps/qwenpaw-web-terminal", component: TerminalComponent, label: "Web 终端", icon: "🖥️" }]);
      console.info("[" + PLUGIN_ID + "] registered via registerRoutes");
    } catch (err) {
      console.warn("[" + PLUGIN_ID + "] registerRoutes failed:", err);
    }
  }

  if (QP.menu && QP.menu.add) {
    try {
      QP.menu.add(PLUGIN_ID, [{
        id: PLUGIN_ID + ".menu",
        location: "primary.settings",
        label: "终端",
        icon: function () { return h("span", { style: { fontSize: 18 } }, "🖥️"); },
        route: PLUGIN_ID + ".home",
        order: 80
      }]);
      console.info("[" + PLUGIN_ID + "] registered via menu.add");
    } catch (err) {
      console.warn("[" + PLUGIN_ID + "] menu.add failed:", err);
    }
  }

  if (QP.route && QP.route.add) {
    try {
      QP.route.add(PLUGIN_ID, [{ id: PLUGIN_ID + ".home", path: "/plugin/qwenpaw-web-terminal", component: TerminalComponent }]);
      console.info("[" + PLUGIN_ID + "] registered via route.add");
    } catch (err) {
      console.warn("[" + PLUGIN_ID + "] route.add failed:", err);
    }
  }

  console.info("[qwenpaw-web-terminal] Plugin v" + VERSION + " loaded");
})();
