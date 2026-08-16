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
  var VERSION = "0.2.2";

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
    mgrEmpty: { padding: '14px', color: '#8b949e', textAlign: 'center' },
    // AI 助手面板（v0.2.0）
    aiBtn: {
      padding: '6px 12px', borderRadius: '6px', border: '1px solid #1f6feb',
      background: 'rgba(88,166,255,0.15)', color: '#58a6ff', cursor: 'pointer', fontSize: '12px'
    },
    aiBtnActive: { background: '#1f6feb', borderColor: '#1f6feb', color: '#fff' },
    aiPanel: {
      position: 'fixed', right: 16, bottom: 16, width: 440, maxWidth: '92vw',
      height: 'min(560px, 72vh)', zIndex: 8000, display: 'flex', flexDirection: 'column',
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
    },
    aiHeader: {
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
      background: '#161b22', borderBottom: '1px solid #30363d', flexShrink: 0,
      borderTopLeftRadius: 10, borderTopRightRadius: 10
    },
    aiSubBar: {
      display: 'block', padding: '4px 12px', background: '#161b22',
      borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: 11,
      flexShrink: 0, lineHeight: '16px'
    },
    aiBody: {
      flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8
    },
    aiRowUser: { display: 'flex', justifyContent: 'flex-end' },
    aiRowAi: { display: 'flex', justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
    aiBubbleUser: {
      maxWidth: '85%', background: '#1f6feb', color: '#fff',
      borderRadius: '10px 10px 2px 10px', padding: '8px 12px', fontSize: 13,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word'
    },
    aiBubbleAi: {
      maxWidth: '92%', background: '#161b22', color: '#c9d1d9',
      borderRadius: '10px 10px 10px 2px', padding: '8px 12px', fontSize: 13,
      border: '1px solid #30363d', wordBreak: 'break-word'
    },
    aiThink: {
      maxWidth: '92%', color: '#8b949e', fontSize: 12,
      background: 'rgba(139,148,158,0.08)', borderLeft: '3px solid #484f58',
      borderRadius: 4, padding: '6px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
    },
    aiEmpty: { color: '#8b949e', fontSize: 12, whiteSpace: 'pre-line', textAlign: 'center', paddingTop: 24 },
    aiFooter: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      background: '#161b22', borderTop: '1px solid #30363d', flexShrink: 0,
      borderBottomLeftRadius: 10, borderBottomRightRadius: 10
    },
    aiModelSel: {
      background: '#010409', color: '#e6edf3', border: '1px solid #30363d',
      borderRadius: 6, padding: '2px 6px', fontSize: 12, outline: 'none',
      maxWidth: 150, flexShrink: 0
    },
    aiApprove: {
      background: '#161b22', border: '1px solid #d29922', borderRadius: 8,
      padding: '8px 10px', fontSize: 12, color: '#c9d1d9'
    },
    aiCmd: {
      marginTop: 6, background: '#010409', border: '1px solid #30363d',
      borderRadius: 6, overflow: 'hidden'
    },
    aiCmdHead: {
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
      background: '#161b22', borderBottom: '1px solid #30363d', fontSize: 11, color: '#8b949e'
    },
    aiCmdLang: {
      background: 'rgba(110,118,129,0.15)', border: '1px solid rgba(110,118,129,0.3)',
      borderRadius: 4, padding: '0 6px', fontSize: 10, color: '#8b949e', lineHeight: '16px'
    },
    aiCmdCopy: {
      padding: '1px 8px', borderRadius: 4, border: '1px solid #30363d',
      background: '#21262d', color: '#c9d1d9', cursor: 'pointer', fontSize: 10, lineHeight: '16px'
    },
    aiCmdBody: {
      padding: '6px 8px', color: '#e6edf3', fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
      whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5
    },
    aiCmdBtns: { display: 'flex', gap: 6, padding: '6px 8px', borderTop: '1px solid #21262d', background: '#161b22' },
    aiCmdBtn: {
      flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 4, padding: '4px 6px', borderRadius: 4, border: '1px solid #30363d',
      background: '#21262d', color: '#c9d1d9', cursor: 'pointer', textAlign: 'center'
    },
    aiCmdBtnWarn: { background: 'rgba(210,153,34,0.12)', borderColor: '#d29922', color: '#d29922' },
    aiCmdBtnRun: { background: 'rgba(63,185,80,0.12)', borderColor: '#3fb950', color: '#3fb950' }
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

  // ---- 复制文本（剪贴板，失败退回 prompt） ----
  // 顶层函数（命令卡片使用），不依赖组件内 showToast：复制成功时仅静默完成，
  // 失败（剪贴板不可用）时退回 prompt 由用户手动复制。
  function copyText(txt) {
    if (!txt) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(function () {
        window.prompt('复制以下文本：', txt);
      });
    } else {
      window.prompt('复制以下文本：', txt);
    }
  }

  // ---- bash/shell 命令高亮（与官方代码块视觉语言对齐：主题化 + 语法着色） ----
  // 返回 React 元素数组，按行渲染。高亮规则：行首 # 注释、引号字符串、${var}/$var、
  // -x/--xxx 选项、内置关键字（echo/cd/ls/cat 等）与命令首词。未匹配部分保持默认色。
  var SH_KEYWORDS = {};
  ("echo cd ls cat grep sed awk curl wget git python pip pip3 npm node bash sh sudo apt apt-get " +
   "docker docker-compose make cmake gcc g++ java javac mvn go cargo rustc ruby gem bundle rake " +
   "tar unzip zip mv cp rm mkdir rmdir touch chmod chown ln find xargs sort uniq head tail less more " +
   "export source alias unalias history kill pkill ps top htop systemctl journalctl service ping " +
   "ssh scp rsync telnet nc ifconfig ip route env set unset read sleep date time which whereis man " +
   "clear exit true false test pushd popd").split(/\s+/).forEach(function (w) { SH_KEYWORDS[w] = 1; });

  function renderShHighlight(src) {
    var esc = escapeHtml;
    var segs = [];
    // 按行处理，保留 \n
    var lines = String(src || '').split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var out = [];
      // 行首注释
      var m = line.match(/^\s*#.*/);
      if (m) {
        out.push('<span style="color:#8b949e">' + esc(m[0]) + '</span>');
        segs.push(out.join(''));
        continue;
      }
      // 遍历 token：引号串 / 注释 / 变量 / 选项 / 关键字 / 普通词
      var re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|#[^\n]*|-[A-Za-z][A-Za-z0-9-]*|--[A-Za-z][A-Za-z0-9-]*|\S+)/g;
      var last = 0;
      while ((m = re.exec(line)) !== null) {
        var t = m[0];
        if (m.index > last) out.push(esc(line.slice(last, m.index)));
        var cls = '';
        var c = t[0];
        if (c === '"' || c === "'" || c === '`') cls = 'color:#a5d6ff';            // 字符串
        else if (c === '$') cls = 'color:#ff7b72';                                  // 变量
        else if (c === '#') cls = 'color:#8b949e';                                  // 注释
        else if ((t[0] === '-' && t.length > 1) && (t[1] !== '-' || t.length > 2)) cls = 'color:#79c0ff'; // 选项
        else if (SH_KEYWORDS[t]) cls = 'color:#d2a8ff;font-weight:600';             // 内置关键字
        else if (out.length === 0 && !/^[|;&><]$/.test(t)) cls = 'color:#ffa657';   // 命令首词
        out.push(cls ? '<span style="' + cls + '">' + esc(t) + '</span>' : esc(t));
        last = m.index + t.length;
      }
      if (last < line.length) out.push(esc(line.slice(last)));
      segs.push(out.join(''));
    }
    return segs.map(function (html, idx) {
      return h('div', { key: 'sh' + idx, dangerouslySetInnerHTML: { __html: html } });
    });
  }

  // ---- AI 消息渲染：简化 Markdown + 代码块转命令卡片 ----
  // 返回 React 元素数组。代码块（```bash/```sh/```console/```shell 等）渲染为
  // 命令卡片，提供「插入脚本 / 运行 / 清空输入 / 中断」按钮；其余按简化 Markdown 渲染。
  function renderAiMessage(text, onCmd) {
    var out = [];
    var lines = String(text || '').split('\n');
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      // 围栏代码块
      var fm = line.match(/^\s*```([\w+-]*)\s*$/);
      if (fm) {
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // 跳过结束围栏
        var cmdText = buf.join('\n').replace(/\n+$/, '').trim();
        if (cmdText) {
          // 闭包陷阱：cmdText / mkClick 都是 var（函数作用域），循环里所有迭代共享同一变量。
          // onClick 延迟到点击时才执行，若闭包引用变量本身，所有按钮都会拿到最后一次迭代的值。
          // 正确做法：每个 onClick 用 IIFE 把「当前 cmdText + action」作为参数捕获进独立闭包。
          out.push(h('div', {
            key: 'c' + out.length,
            style: S.aiCmd
          }, [
            h('div', { style: S.aiCmdHead }, [
              h('span', {}, '💻 命令'),
              h('span', { style: S.aiCmdLang }, (fm[1] || 'shell')),
              h('span', { style: { marginLeft: 'auto' } }),
              h('button', {
                style: S.aiCmdCopy,
                title: '复制命令全文',
                onClick: (function (cmd) { return function () { copyText(cmd); }; })(cmdText)
              }, '📋 复制')
            ]),
            h('div', { style: S.aiCmdBody }, renderShHighlight(cmdText)),
            h('div', { style: S.aiCmdBtns }, [
              h('button', {
                style: Object.assign({}, S.aiCmdBtn, S.aiCmdBtnWarn),
                title: '插入脚本到终端输入行（不执行），确认后按回车执行',
                onClick: (function (cmd) { return function () { onCmd(cmd, 'type'); }; })(cmdText)
              }, [
                h('span', { style: { fontSize: 15, lineHeight: 1, flexShrink: 0 } }, '✍'),
                h('span', { style: { fontSize: 9, lineHeight: 1.35, wordBreak: 'break-word' } }, '插入脚本')
              ]),
              h('button', {
                style: Object.assign({}, S.aiCmdBtn, S.aiCmdBtnRun),
                title: '写入终端输入行并回车，在终端内执行（可见回显，Ctrl+C 可中断）',
                onClick: (function (cmd) { return function () { onCmd(cmd, 'run'); }; })(cmdText)
              }, [
                h('span', { style: { fontSize: 15, lineHeight: 1, flexShrink: 0 } }, '▶'),
                h('span', { style: { fontSize: 9, lineHeight: 1.35, wordBreak: 'break-word' } }, '运行')
              ]),
              h('button', {
                style: Object.assign({}, S.aiCmdBtn, S.aiCmdBtnWarn),
                title: '清空已插入的终端输入（Ctrl+U）',
                onClick: function () { onCmd('', 'clear'); }
              }, [
                h('span', { style: { fontSize: 15, lineHeight: 1, flexShrink: 0 } }, '🗑'),
                h('span', { style: { fontSize: 9, lineHeight: 1.35, wordBreak: 'break-word' } }, '清空输入')
              ]),
              h('button', {
                style: Object.assign({}, S.aiCmdBtn),
                title: '中断终端当前执行（Ctrl+C）',
                onClick: function () { onCmd('', 'intr'); }
              }, [
                h('span', { style: { fontSize: 15, lineHeight: 1, flexShrink: 0 } }, '⏹'),
                h('span', { style: { fontSize: 9, lineHeight: 1.35, wordBreak: 'break-word' } }, '中断')
              ])
            ])
          ]));
        } else {
          out.push(h('div', { key: 'c' + out.length, style: { color: '#8b949e', fontSize: 12 } }, '（空命令块）'));
        }
        continue;
      }
      out.push(h('div', {
        key: 't' + out.length,
        dangerouslySetInnerHTML: { __html: renderAiInline(line) }
      }));
      i++;
    }
    if (!out.length) out.push(h('div', { key: 'e', style: { color: '#8b949e' } }, '…'));
    return out;
  }

  // 简化行内 Markdown：粗体 / 行内代码 / 链接
  function renderAiInline(src) {
    var s = escapeHtml(String(src || ''));
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codes.push('<code style="background:rgba(110,118,129,0.2);border-radius:3px;padding:0 4px;font-size:12px;font-family:inherit">' + c + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#58a6ff">$1</a>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, d) { return codes[+d]; });
    return s;
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
    var vendorReadyRef = React.useRef(false);
    var toastTimerRef = React.useRef(null);

    var [tabOrder, setTabOrder] = React.useState([]);
    var [activeId, setActiveId] = React.useState(null);
    var [mode, setMode] = React.useState('pty'); // 当前激活标签的模式镜像（每标签独立）
    var [version, setVersion] = React.useState('');
    var [vendorReady, setVendorReady] = React.useState(false);
    var [wsStates, setWsStates] = React.useState({});  // id -> closed|connecting|open
    var [cwdMap, setCwdMap] = React.useState({});      // id -> cwd
    var [toast, setToast] = React.useState(null);      // 右上角临时提示（不写入终端，避免打断内容）
    var [showMgr, setShowMgr] = React.useState(false); // 会话管理面板
    var [mgrData, setMgrData] = React.useState(null);  // {sessions:[...]} 或 {error}
    var [mgrLoading, setMgrLoading] = React.useState(false);
    // --- AI 助手面板（v0.2.0） ---
    var LS_AI_OPEN = 'qwenpaw-web-terminal:aiOpen';
    var LS_AI_MSGS = 'qwenpaw-web-terminal:aiMsgs';
    var LS_AI_MODEL = 'qwenpaw-web-terminal:aiModel';
    var [aiOpen, setAiOpen] = React.useState(function () {
      try { return localStorage.getItem(LS_AI_OPEN) === '1'; } catch (e) { return false; }
    });
    var [aiMsgs, setAiMsgs] = React.useState(function () {
      try {
        var v = localStorage.getItem(LS_AI_MSGS);
        if (v) { var arr = JSON.parse(v); if (Array.isArray(arr)) return arr; }
      } catch (e) { /* 忽略 */ }
      return [];
    });
    var [aiInput, setAiInput] = React.useState('');
    var [aiBusy, setAiBusy] = React.useState(false);
    var aiAbortRef = React.useRef(null);
    var aiBodyRef = React.useRef(null);
    var aiReasoningRef = React.useRef(false);
    var [aiModel, setAiModel] = React.useState('');
    var [aiModels, setAiModels] = React.useState([]);
    var [aiApprovals, setAiApprovals] = React.useState([]);

    // ---- tab 实例管理 ----
    function getTab(id) {
      if (!tabsRef.current.has(id)) {
        tabsRef.current.set(id, {
          id: id,
          term: null, fit: null, ws: null, buf: '',
          cwd: '', wsState: 'closed', pending: '',
          reconnectCount: 0, reconnectTimer: null,
          heartbeatTimer: null,
          mode: 'pty',      // 每标签独立模式：'pty' | 'exec'
          started: false    // 是否已开始（PTY 已连接 / 已执行过 exec）——开始后锁定模式
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
      setMode(getTab(id).mode); // 同步模式镜像（每标签独立）
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
      tab.started = true; // 已执行过 exec → 模式锁定
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

    // ---- 模式切换（每标签独立；已开始的标签锁定，仅新建/未开始的标签可切换） ----
    function switchMode(m) {
      var tab = activeIdRef.current ? getTab(activeIdRef.current) : null;
      if (!tab) return;
      if (tab.started) {
        // 已开始（PTY 已连接 / 已执行过 exec）：模式锁定，不切换
        showToast('该标签已开始运行，模式已锁定（新建标签可选择模式）');
        return;
      }
      if (m === tab.mode) return;
      tab.mode = m;
      setMode(m);
      if (m === 'pty') {
        // 切到 pty：清屏、保持惰性（不自动连接，等待输入/重连触发）
        tab.buf = '';
        if (tab.term) {
          tab.term.clear();
          var wsActive = tab.ws && (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING);
          if (!wsActive) {
            writeTo(tab, '\x1b[90m○ 未连接 — 输入任意字符或点击「重连」开始交互\x1b[0m\r\n');
          }
        }
      } else {
        // 切到 exec：断开可能存在的 ws、清屏、显示提示符
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
      if (tab.heartbeatTimer) {
        clearInterval(tab.heartbeatTimer);
        tab.heartbeatTimer = null;
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
      if (tab.heartbeatTimer) {
        clearInterval(tab.heartbeatTimer);
        tab.heartbeatTimer = null;
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
        tab.started = true; // PTY 已连接 → 模式锁定
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
        // 心跳保活：每 20s 发 ping，服务端据此清理「挂了但没断开」的死连接
        tab.heartbeatTimer = setInterval(function () {
          if (tab.ws === ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send('\x00ping'); } catch (e) { /* ignore */ }
          }
        }, 20000);
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
        if (tab.heartbeatTimer) {
          clearInterval(tab.heartbeatTimer);
          tab.heartbeatTimer = null;
        }
        setTabWsState(tab.id, 'closed');
        showToast('连接已关闭（' + tab.id + '）');
        if (tab.mode === 'pty' && tab.reconnectCount < 5) {
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
      if (tab.mode !== 'pty') return;
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
        scrollback: 50000,
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
      if (tab.mode === 'exec') writePromptTo(tab);

      // pty 且未连接：显示灰色提示行；连接成功（onopen）后自动清除
      var wsActive = tab.ws && (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING);
      if (tab.mode === 'pty' && !wsActive) {
        writeTo(tab, '\x1b[90m○ 未连接 — 输入任意字符或点击「重连」开始交互\x1b[0m\r\n');
      }

      // 输入处理：路由到本标签的 ws / buf
      t.onData(function (data) {
        if (tab.mode === 'pty') {
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
      // 渲染后由 useEffect 完成 term 初始化；连接保持惰性（仅输入/点「重连」触发）
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
      // 惰性连接：切换标签不自动连接，仅输入/点「重连」触发；
      // 需要 attach 的场景（打开已存在会话/管理面板打开）由调用方显式 ensureConnected
      setTimeout(function () { fitFor(tab); }, 30);
    }

    // 打开或创建会话：同名已存在 → 直接打开（不重置、不重复创建）；否则创建
    function openOrCreateSession(name, fromMgr) {
      fetch(API_BASE + '/sessions')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var list = (d && d.ok && d.sessions) ? d.sessions : [];
          var existing = null;
          list.forEach(function (s) { if (s.id === name) existing = s; });
          if (existing) {
            var tab = getTab(name);
            tab.cwd = existing.cwd || '';
            tab.mode = 'pty'; // attach 已有会话 → 强制 pty（attach 语义）
            if (tabOrderRef.current.indexOf(name) < 0) createTab(name);
            else switchTab(name);
            ensureConnected(getTab(name));
            showToast('会话已存在，已打开：' + name);
            if (fromMgr) refreshMgr();
            return;
          }
          fetch(API_BASE + '/sessions', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, agentHeaders()),
            body: JSON.stringify({ id: name })
          })
            .then(function (r) { return r.json(); })
            .then(function (dr) {
              if (dr && dr.ok) {
                var tab = getTab(name);
                tab.cwd = dr.cwd || '';
                // 新标签继承当前激活标签的模式；未开始前仍可自由切换（开始后锁定）
                tab.mode = activeIdRef.current ? getTab(activeIdRef.current).mode : 'pty';
                // 新建全新会话：惰性连接（仅输入/点重连触发连接）
                createTab(name);
                if (fromMgr) refreshMgr();
              } else {
                window.alert((dr && dr.error) || '创建失败');
              }
            });
        });
    }

    function newTab() {
      var name = window.prompt('新会话 ID（字母/数字/中划线）：', 's' + Math.floor(Date.now() / 1000).toString(36));
      if (!name) return;
      name = String(name).trim().replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!name) return;
      openOrCreateSession(name, false);
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

    // ---- AI 助手面板（v0.2.0） ----
    function aiSessionId() {
      var k = 'qwenpaw-web-terminal:aiSession';
      var v = null;
      try { v = localStorage.getItem(k); } catch (e) { v = null; }
      if (!v) {
        v = 'qwt-ai-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ }
      }
      return v;
    }
    function clearAiSession() {
      try { localStorage.removeItem('qwenpaw-web-terminal:aiSession'); } catch (e) { /* 忽略 */ }
      try { localStorage.removeItem(LS_AI_MSGS); } catch (e) { /* 忽略 */ }
      setAiMsgs([]);
      setAiApprovals([]);
    }
    React.useEffect(function () {
      try { localStorage.setItem(LS_AI_OPEN, aiOpen ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }, [aiOpen]);
    React.useEffect(function () {
      try { localStorage.setItem(LS_AI_MSGS, JSON.stringify(aiMsgs)); } catch (e) { /* 忽略 */ }
    }, [aiMsgs]);
    React.useEffect(function () {
      if (aiBodyRef.current) aiBodyRef.current.scrollTop = aiBodyRef.current.scrollHeight;
    }, [aiMsgs, aiBusy]);

    // 模型选择持久化 + 可用模型加载
    React.useEffect(function () {
      var saved = null;
      try { saved = localStorage.getItem(LS_AI_MODEL); } catch (e) { saved = null; }
      fetch(API_BASE + '/ai/models')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var list = (data && data.models) || [];
          setAiModels(list);
          var chosen = saved && list.some(function (m) { return m.value === saved; }) ? saved : '';
          if (!chosen && list.length) chosen = list[0].value;
          if (chosen) setAiModel(chosen);
        })
        .catch(function (err) { console.error('[qwenpaw-web-terminal] ai/models failed:', err); });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // AI 发送：SSE 流式，自动附带当前激活终端会话
    function sendAi() {
      var text = (aiInput || '').trim();
      if (!text || aiBusy) return;
      var sid = activeIdRef.current || 'default';
      setAiMsgs(function (prev) { return prev.concat([{ role: 'user', text: text }, { role: 'ai', text: '', think: '' }]); });
      setAiInput('');
      setAiBusy(true);
      var ctrl = new AbortController();
      aiAbortRef.current = ctrl;
      fetch(API_BASE + '/ai/chat', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, agentHeaders()),
        body: JSON.stringify({
          text: text,
          session_id: sid,
          model: aiModel,
        }),
        signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (body) {
            throw new Error((body && (body.detail || body.error || body.message)) || ('HTTP ' + r.status));
          });
        }
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) return;
            buf += decoder.decode(res.value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(function (line) {
              var t = line.trim();
              if (t.indexOf('data: ') === 0) handleAiEvent(t.slice(6).trim());
            });
            return pump();
          });
        }
        return pump();
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        handleAiEvent(JSON.stringify({ object: 'error', error: String((err && err.message) || err) }));
      }).finally(function () {
        setAiBusy(false);
        aiAbortRef.current = null;
      });
    }

    function handleAiEvent(raw) {
      var ev;
      try { ev = JSON.parse(raw); } catch (e) { return; }
      if (!ev) return;
      if (ev.object === 'error') {
        setAiMsgs(function (prev) {
          var next = prev.slice();
          var last = next[next.length - 1];
          var errText = '⚠️ ' + String(ev.error || '未知错误');
          if (last && last.role === 'ai') {
            next[next.length - 1] = { role: 'ai', text: last.text ? last.text + '\n\n' + errText : errText, think: last.think || '' };
          } else {
            next.push({ role: 'ai', text: errText, think: '' });
          }
          return next;
        });
        return;
      }
      if (ev.object === 'message') {
        aiReasoningRef.current = ev.type === 'reasoning';
        if (ev.type === 'message' && ev.role === 'assistant' && ev.status === 'completed') {
          var full = '';
          (ev.content || []).forEach(function (c) {
            if (c && c.type === 'text' && c.text) full += c.text;
          });
          if (full) {
            setAiMsgs(function (prev) {
              var next = prev.slice();
              var last = next[next.length - 1];
              if (last && last.role === 'ai') next[next.length - 1] = { role: 'ai', text: full, think: last.think || '' };
              else next.push({ role: 'ai', text: full, think: '' });
              return next;
            });
          }
        }
        return;
      }
      if (ev.object === 'content' && ev.type === 'text' && ev.text) {
        if (aiReasoningRef.current) {
          setAiMsgs(function (prev) {
            var next = prev.slice();
            var last = next[next.length - 1];
            if (last && last.role === 'ai') next[next.length - 1] = { role: 'ai', text: last.text || '', think: (last.think || '') + ev.text };
            else next.push({ role: 'ai', text: '', think: ev.text });
            return next;
          });
        } else {
          setAiMsgs(function (prev) {
            var next = prev.slice();
            var last = next[next.length - 1];
            if (last && last.role === 'ai') next[next.length - 1] = { role: 'ai', text: last.text + ev.text, think: last.think || '' };
            else next.push({ role: 'ai', text: ev.text, think: '' });
            return next;
          });
        }
        return;
      }
      if (ev.object === 'response' && ev.status === 'completed') {
        if (ev.output) {
          var fullText = '';
          (ev.output || []).forEach(function (m) {
            if (!m || m.type === 'reasoning') return;
            (m.content || []).forEach(function (c) {
              if (c && c.type === 'text' && c.text) fullText += c.text;
            });
          });
          if (fullText) {
            setAiMsgs(function (prev) {
              var next = prev.slice();
              var last = next[next.length - 1];
              if (last && last.role === 'ai' && last.text !== fullText) {
                next[next.length - 1] = { role: 'ai', text: fullText, think: last.think || '' };
              }
              return next;
            });
          }
        }
      }
    }

    // AI 请求进行中：轮询待审批
    React.useEffect(function () {
      if (!aiBusy) { setAiApprovals([]); return; }
      var sid = aiSessionId();
      var timer = setInterval(function () {
        fetch('/api/approval/list')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || !Array.isArray(data.pending_approvals)) return;
            var mine = (data.pending_approvals || []).filter(function (p) {
              return p && (p.session_id === sid || p.root_session_id === sid);
            });
            setAiApprovals(mine);
          })
          .catch(function () { /* 轮询失败忽略 */ });
      }, 2500);
      return function () { clearInterval(timer); };
    }, [aiBusy]);

    function resolveApproval(req, approve) {
      var body = { request_id: req.request_id, session_id: aiSessionId() };
      fetch('/api/approval/' + (approve ? 'approve' : 'deny'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function () {
        setAiApprovals(function (prev) { return prev.filter(function (p) { return p.request_id !== req.request_id; }); });
      }).catch(function (err) {
        console.error('[qwenpaw-web-terminal] approval failed:', err);
        setAiApprovals(function (prev) { return prev.filter(function (p) { return p.request_id !== req.request_id; }); });
      });
    }

    function stopAi() {
      if (aiAbortRef.current) { aiAbortRef.current.abort(); aiAbortRef.current = null; }
    }

    // ---- 向 PTY 发送输入（未连接时先连接并暂存，连接后补发） ----
    function ptySend(tab, text) {
      if (tab.mode !== 'pty') return false;
      if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
        try { tab.ws.send(text); } catch (e) { /* ignore */ }
        return true;
      }
      if (tab.ws && tab.ws.readyState === WebSocket.CONNECTING) {
        tab.pendingInput = (tab.pendingInput || '') + text;
        return true;
      }
      ensureConnected(tab);
      tab.pendingInput = (tab.pendingInput || '') + text;
      return true;
    }

    // AI 命令卡片操作（全部作用于当前激活终端，经终端通道，非后端静默执行）：
    //   type  = 插入脚本（不执行）：清空输入行（Ctrl+U）→ 写入命令（不回车），用户确认后回车执行
    //   run   = 写入并运行：清空输入行 → 写入命令 + 回车，在终端内执行（可见回显/输出，可中断）
    //   intr  = 中断：向终端发送 Ctrl+C（\x03），中断当前执行
    //   clear = 清空已插入的输入（发送 Ctrl+U）
    function aiCmdAction(cmd, action) {
      var tab = activeTab();
      if (!tab) { showToast('没有激活的终端标签'); return; }
      if (tab.mode === 'exec') {
        // 单条命令模式（无 PTY）：本地输入缓冲语义
        if (action === 'run') {
          runExec(tab, cmd);
        } else if (action === 'type') {
          if (tab.term) {
            tab.buf = cmd;
            tab.term.write('\r\n' + cmd);
            writePromptTo(tab);
          }
          showToast('已插入脚本（按回车执行）');
        } else if (action === 'clear') {
          tab.buf = '';
          if (tab.term) { tab.term.write('\r\n'); writePromptTo(tab); }
          showToast('已清空输入');
        } else if (action === 'intr') {
          showToast('单条命令模式无运行进程可中断');
        }
        return;
      }
      // PTY 交互模式：全部经 WS 发送到 bash
      if (action === 'type') {
        // Ctrl+U（\x15）清空当前输入行 → 写入命令（不回车）
        ptySend(tab, '\x15' + cmd);
        showToast('已插入脚本（不执行，按回车执行；「清空」可删除）');
      } else if (action === 'run') {
        // 清空输入行 → 写入命令 + 回车，在终端内执行
        ptySend(tab, '\x15' + cmd + '\r');
        showToast('已在终端执行（Ctrl+C 可中断）');
      } else if (action === 'intr') {
        ptySend(tab, '\x03');
        showToast('已发送 Ctrl+C 中断终端执行');
      } else if (action === 'clear') {
        ptySend(tab, '\x15');
        showToast('已清空终端输入行');
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
      var inTabs = tabOrderRef.current.indexOf(s.id) >= 0;
      if (p.connected) return h('span', { style: { color: '#3fb950' } }, '● 前台运行');
      if (inTabs) return h('span', { style: { color: '#8b949e' } }, '○ 前台空闲');
      if (p.running) return h('span', { style: { color: '#d29922' } },
        '◉ 后台运行' + (p.buffered ? '（缓冲 ' + fmtBytes(p.buffered) + '）' : ''));
      return h('span', { style: { color: '#8b949e' } }, '空闲');
    }
    function mgrOpenAll() {
      var list = (mgrData && mgrData.sessions) || [];
      var notOpen = list.filter(function (s) { return tabOrderRef.current.indexOf(s.id) < 0; });
      if (!notOpen.length) { showToast('所有会话都已在标签栏'); return; }
      notOpen.forEach(function (s) {
        var tab = getTab(s.id);
        if (!tab.cwd && s.cwd) tab.cwd = s.cwd;
        tab.mode = 'pty'; // 打开后台会话 → attach，强制 pty
        createTab(s.id);
        ensureConnected(getTab(s.id));
      });
      refreshMgr();
      showToast('已打开 ' + notOpen.length + ' 个会话');
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
      tab.mode = 'pty'; // 打开会话 → attach，强制 pty
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
      // 结束并删除所有「不在前台标签栏」且正在运行的会话（含后台运行与悬空连接）
      var idle = list.filter(function (s) {
        return s.pty && s.pty.running && tabOrderRef.current.indexOf(s.id) < 0;
      });
      if (!idle.length) { showToast('没有可清理的后台会话'); return; }
      var ids = idle.map(function (s) { return s.id; });
      var p = Promise.resolve();
      ids.forEach(function (id) {
        p = p.then(function () {
          return fetch(API_BASE + '/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
        });
      });
      p.then(function () { refreshMgr(); showToast('已结束并删除 ' + ids.length + ' 个后台会话'); });
    }
    function mgrCreateSession() {
      var name = window.prompt('新会话 ID（字母/数字/中划线）：', 's' + Math.floor(Date.now() / 1000).toString(36));
      if (!name) return;
      name = String(name).trim().replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!name) return;
      // 同名已存在 → 直接打开；否则创建（与「＋ 新标签」行为一致）
      openOrCreateSession(name, true);
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
          // 进入终端页自动创建一个与当前智能体同名的默认标签，
          // 但不自动创建 bash 进程（惰性连接，仅输入/点重连触发）；
          // 刷新/断网后除该默认标签外，其他会话全部留在后台（管理面板可见）。
          // 若该默认会话已在后台运行 → 改为打开（attach 原进程，不重复创建）。
          var id = agentId;
          var tab = getTab(id);
          var cwdInit = {};
          if (sessMap[id]) {
            tab.cwd = sessMap[id].cwd || '';
            cwdInit[id] = sessMap[id].cwd || '';
          }
          var order = [id];
          tabOrderRef.current = order;
          setTabOrder(order);
          setCwdMap(function (prev) { return Object.assign({}, prev, cwdInit); });
          activateTab(id);
          if (sessMap[id] && sessMap[id].pty && sessMap[id].pty.running) {
            ensureConnected(getTab(id));
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

    return h('div', { id: 'qwt-root', style: S.container }, [
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
        }, '重连'),
        h('button', {
          style: aiOpen ? S.aiBtnActive : S.aiBtn,
          onClick: function () { setAiOpen(!aiOpen); },
          title: 'AI 助手：读取当前终端内容，生成命令可一键写入（不执行）或执行'
        }, '🤖 AI 助手')
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
              h('button', { style: S.mgrBtn, onClick: mgrOpenAll }, '打开所有会话'),
              h('button', { style: Object.assign({}, S.mgrBtn, S.mgrBtnDanger), onClick: mgrKillAllIdle }, '结束并删除所有后台会话'),
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
                  h('div', { style: { fontWeight: 600, color: '#e6edf3' } },
                    (tabOrderRef.current.indexOf(s.id) >= 0 ? '📌 ' : '') + s.id),
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
      // AI 助手面板（v0.2.0）
      aiOpen ? h('div', { style: S.aiPanel }, [
        h('div', { style: S.aiHeader }, [
          h('span', { style: { color: '#e6edf3', fontWeight: 600, fontSize: 13 } }, '🤖 AI 助手'),
          aiModels.length ? h('select', {
            style: Object.assign({}, S.aiModelSel, { marginLeft: 8 }),
            value: aiModel,
            title: '选择使用的大模型',
            onChange: function (ev) {
              var v = ev.currentTarget.value;
              setAiModel(v);
              try { localStorage.setItem(LS_AI_MODEL, v); } catch (e) { /* 忽略 */ }
            }
          }, aiModels.map(function (m) {
            return h('option', { key: m.value, value: m.value }, m.label + (m.is_free ? '（免费）' : ''));
          })) : null,
          h('button', {
            style: Object.assign({}, S.button, { marginLeft: 'auto', padding: '2px 8px' }),
            title: '向当前终端发送 Ctrl+C，中断正在执行的命令',
            onClick: function () {
              var t = activeTab();
              if (!t) { showToast('没有激活的终端标签'); return; }
              if (t.mode === 'pty') {
                ptySend(t, '\x03');
                showToast('已发送 Ctrl+C 中断终端执行');
              } else {
                showToast('单条命令模式无运行进程可中断');
              }
            }
          }, '⏹ 中断'),
          h('button', {
            style: Object.assign({}, S.button, { padding: '2px 8px' }),
            title: '清空对话（换新会话，上下文重置）',
            onClick: clearAiSession
          }, '🗑 清空'),
          h('button', {
            style: Object.assign({}, S.button, { padding: '2px 8px' }),
            title: '收起',
            onClick: function () { setAiOpen(false); }
          }, '✕')
        ]),
        h('div', { style: S.aiSubBar },
          '自动读取当前终端「' + (activeIdRef.current || 'default') + '」内容'),
        h('div', { style: S.aiBody, ref: aiBodyRef }, [
          aiApprovals.length > 0 ? aiApprovals.map(function (req, j) {
            return h('div', { key: 'ap' + j, style: S.aiApprove }, [
              h('div', { style: { color: '#d29922', fontWeight: 600, marginBottom: 4 } }, '⚠️ 需要审批'),
              h('div', { style: { color: '#c9d1d9', wordBreak: 'break-word' } },
                'AI 请求执行工具：' + String(req.tool_display_name || req.tool_name || '未知')),
              h('div', { style: { color: '#8b949e', fontSize: 11, margin: '4px 0', wordBreak: 'break-word' } },
                String((req && (req.result_summary || req.exact_target)) || '')),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } }, [
                h('button', {
                  style: Object.assign({}, S.aiCmdBtnRun, { padding: '2px 10px' }),
                  onClick: function () { resolveApproval(req, true); }
                }, '允许'),
                h('button', {
                  style: Object.assign({}, S.aiCmdBtnWarn, { padding: '2px 10px' }),
                  onClick: function () { resolveApproval(req, false); }
                }, '拒绝')
              ])
            ]);
          }) : null,
          aiMsgs.length === 0
            ? h('div', { style: S.aiEmpty },
                '与 AI 对话，发送时自动附带：\n· 当前终端会话内容（去 ANSI 的最近输出）\n· 当前目录\n\nAI 给出的命令会渲染成卡片：\n✍ 插入脚本＝填入输入，回车后执行\n▶ 运行＝写入并回车，在终端内执行\n🗑 清空输入＝删除已插入的命令\n⏹ 中断＝Ctrl+C 中断终端执行\n\n对话上下文会保留（刷新不丢失），\n「🗑 清空」可重置会话')
            : aiMsgs.map(function (m, i) {
                if (m.role === 'user') {
                  return h('div', { key: i, style: S.aiRowUser },
                    h('div', { style: S.aiBubbleUser }, escapeHtml(m.text)));
                }
                return h('div', { key: i, style: S.aiRowAi }, [
                  (m.think ? h('div', { style: S.aiThink }, [
                    h('div', { style: { color: '#8b949e', fontSize: 11, marginBottom: 2 } }, '🤔 思考过程'),
                    escapeHtml(m.think)
                  ]) : null),
                  h('div', { style: S.aiBubbleAi }, renderAiMessage(m.text, aiCmdAction))
                ]);
              }),
          aiBusy ? h('div', { style: { color: '#8b949e', fontSize: 12, padding: '4px 8px' } }, '⏳ AI 思考中…') : null
        ]),
        h('div', { style: S.aiFooter }, [
          h('input', {
            style: Object.assign({}, { background: '#010409', color: '#e6edf3', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', fontSize: 13, outline: 'none', flex: 1 }),
            value: aiInput,
            placeholder: aiBusy ? '正在生成回复…' : '输入问题，Enter 发送（可问终端内容/生成命令）',
            onChange: function (ev) { setAiInput(ev.currentTarget.value); },
            onKeyDown: function (ev) { if (ev.key === 'Enter' && !aiBusy) sendAi(); },
            disabled: aiBusy
          }),
          h('button', {
            style: aiBusy ? S.aiCmdBtnWarn : S.aiBtn,
            title: aiBusy ? '停止生成' : '发送',
            onClick: aiBusy ? stopAi : sendAi,
            disabled: !aiBusy && !(aiInput || '').trim()
          }, aiBusy ? '停止' : '发送')
        ])
      ]) : null,
      toast ? h('div', { style: S.toast }, toast.text) : null
    ]);
  }

  // ============ 滚动条样式：与 qwenpaw-file-browser 插件完全一致（细滚动条 + 半透明浅色滑块） ============
  function injectScrollbarStyle() {
    if (document.getElementById('qwt-scrollbar-style')) return;
    var st = document.createElement('style');
    st.id = 'qwt-scrollbar-style';
    st.textContent =
      '#qwt-root ::-webkit-scrollbar{width:8px;height:8px;}' +
      '#qwt-root ::-webkit-scrollbar-track{background:transparent;}' +
      '#qwt-root ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:4px;}' +
      '#qwt-root ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3);}' +
      '#qwt-root ::-webkit-scrollbar-corner{background:transparent;}';
    document.head.appendChild(st);
  }
  injectScrollbarStyle();

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
        icon: function () { return h("span", { className: "qwenpaw-menu-item-icon", style: { fontSize: 16 } }, "🖥️"); },
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
