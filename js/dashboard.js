/* =====================================================================
   Dashboard panel — one combined box shown when a wallet connects.

   TOP: token info + interactive price chart (DexScreener stats,
        GeckoTerminal candles, drawn by us — axes on the right, live
        price pill, smooth line, crosshair, time-range selector).
   BOTTOM: treasury (Gnosis Safe) assets from the Safe Client Gateway.

   Styling lives in css/theme.css. Config constants are at the top.
   ===================================================================== */

(function () {
  // ---- config -----------------------------------------------------------
  var TOKEN_ADDRESS = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'; // Bankr (BNKR)

  var SAFE_ADDRESS = '0x108eD952C1D78F3E502Ad6A07506e5651cEFF682';
  var SAFE_CHAIN   = 1;      // 1 = Ethereum mainnet
  var SAFE_PREFIX  = 'eth';

  var DS_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
  var DS_PAIRS  = 'https://api.dexscreener.com/latest/dex/pairs/';
  var GT_API    = 'https://api.geckoterminal.com/api/v2/networks/';
  var SAFE_GW   = 'https://safe-client.safe.global';
  var REFRESH_MS = 30000;

  var GT_NET = {
    ethereum: 'eth', bsc: 'bsc', polygon: 'polygon_pos', arbitrum: 'arbitrum',
    base: 'base', optimism: 'optimism', avalanche: 'avax', solana: 'solana',
    fantom: 'ftm', robinhood: 'robinhood'
  };
  function gtNetwork(c) { return GT_NET[c] || c; }

  function ytdDays() {
    var now = new Date(), start = new Date(now.getFullYear(), 0, 1);
    return Math.max(2, Math.ceil((now - start) / 86400000));
  }
  var RANGES = [
    { k: '24H', tf: 'hour', agg: 1, lim: 24 },
    { k: '7D',  tf: 'hour', agg: 1, lim: 168 },
    { k: '1M',  tf: 'day',  agg: 1, lim: 30 },
    { k: '3M',  tf: 'day',  agg: 1, lim: 90 },
    { k: 'YTD', tf: 'day',  agg: 1, lim: ytdDays() },
    { k: '1Y',  tf: 'day',  agg: 1, lim: 365 },
    { k: 'Max', tf: 'day',  agg: 1, lim: 1000 }
  ];
  var currentRange = '3M';
  function rangeCfg(k) { for (var i = 0; i < RANGES.length; i++) if (RANGES[i].k === k) return RANGES[i]; return RANGES[1]; }

  var tok = { chain: null, pair: null };
  var chartData = null, chartMode = 'canvas';
  var refreshTimer = null, tokenReady = false, safeReady = false;

  // ---- formatting -------------------------------------------------------
  function fmtPrice(p) {
    var v = Number(p);
    if (!isFinite(v) || v === 0) return '$0';
    if (v >= 1)    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (v >= 0.01) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    return '$' + v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  function fmtCompact(n) {
    var v = Number(n);
    if (!isFinite(v) || v === 0) return '\u2014';
    return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n === undefined || n === null || isNaN(n)) return '';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function fmtAmount(raw, decimals) {
    var val = Number(raw) / Math.pow(10, Number(decimals || 0));
    if (!isFinite(val) || val === 0) return '0';
    if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (val >= 1)    return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return val.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function shortAddr(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function two(x) { return (x < 10 ? '0' : '') + x; }
  function cssVar(name, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(name); return (v && v.trim()) || fb; }
  function hexToRgba(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) { var s = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex.trim()); if (!s) return null; m = [null, s[1]+s[1], s[2]+s[2], s[3]+s[3]]; }
    return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',' + a + ')';
  }

  // ---- panel skeleton ---------------------------------------------------
  function ensurePanel() {
    var el = document.getElementById('dashPanel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dashPanel';
    el.className = 'panel';
    el.innerHTML =
      '<div class="dash-scroll">'
      + '<div id="tokenSection"><div class="p-msg">Loading token\u2026</div></div>'
      + '<div class="dash-divider"></div>'
      + '<div class="p-subhead">Treasury</div>'
      + '<div id="treasurySection"><div class="p-msg">Loading treasury\u2026</div></div>'
      + '</div>';
    document.body.appendChild(el);
    return el;
  }
  function show(el) { el.classList.add('open'); }
  function hide(el) { el.classList.remove('open'); }

  // ===================================================================
  //  TOKEN SECTION
  // ===================================================================
  function rangesHtml() {
    return '<div class="tp-ranges">' + RANGES.map(function (r) {
      return '<button type="button" data-r="' + r.k + '"' + (r.k === currentRange ? ' class="active"' : '') + '>' + r.k + '</button>';
    }).join('') + '</div>';
  }

  function renderToken(pair) {
    var sec = document.getElementById('tokenSection');
    if (!sec) return;
    var info = pair.info || {};
    var baseSym = (pair.baseToken && pair.baseToken.symbol) || '?';
    var quoteSym = (pair.quoteToken && pair.quoteToken.symbol) || '';
    var name = (pair.baseToken && pair.baseToken.name) || baseSym;
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var logoHtml = info.imageUrl
      ? '<img class="tp-logo" src="' + info.imageUrl + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      : '<span class="tp-logo"></span>';

    sec.innerHTML =
      '<div class="p-head">' + logoHtml
      + '<div><div class="tp-name">' + name + '</div>'
      + '<div class="tp-sub">' + baseSym + (quoteSym ? ' / ' + quoteSym : '') + ' \u00b7 ' + tok.chain + '</div></div></div>'
      + '<div class="tp-price-row"><span class="tp-price">' + fmtPrice(pair.priceUsd) + '</span>'
      + (chg !== null && chg !== undefined ? '<span class="tp-chg ' + chgClass + '">' + fmtPct(chg) + ' (24h)</span>' : '')
      + '</div>'
      + '<div class="tp-stats">'
      + '<div class="tp-cell"><div class="k">Market Cap</div><div class="v">' + fmtCompact(pair.marketCap || pair.fdv) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Liquidity</div><div class="v">' + fmtCompact(pair.liquidity ? pair.liquidity.usd : null) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Vol 24h</div><div class="v">' + fmtCompact(pair.volume ? pair.volume.h24 : null) + '</div></div>'
      + '</div>'
      + rangesHtml()
      + '<div class="tp-chartwrap"><canvas class="tp-chart"></canvas></div>';

    wireRanges(sec);
    loadChart();
  }

  function updateTokenStats(pair) {
    var sec = document.getElementById('tokenSection'); if (!sec) return;
    var price = sec.querySelector('.tp-price'); if (price) price.textContent = fmtPrice(pair.priceUsd);
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgEl = sec.querySelector('.tp-chg');
    if (chgEl && chg !== null && chg !== undefined) {
      chgEl.textContent = fmtPct(chg) + ' (24h)';
      chgEl.className = 'tp-chg ' + (chg > 0 ? 'up' : (chg < 0 ? 'down' : ''));
    }
    var cells = sec.querySelectorAll('.tp-cell .v');
    if (cells.length === 3) {
      cells[0].textContent = fmtCompact(pair.marketCap || pair.fdv);
      cells[1].textContent = fmtCompact(pair.liquidity ? pair.liquidity.usd : null);
      cells[2].textContent = fmtCompact(pair.volume ? pair.volume.h24 : null);
    }
  }

  function wireRanges(sec) {
    var box = sec.querySelector('.tp-ranges'); if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
      currentRange = b.getAttribute('data-r');
      var all = box.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === b);
      loadChart();
    });
  }

  // ---- chart ------------------------------------------------------------
  var AX = { L: 8, R: 64, T: 12, B: 22 };

  async function loadChart() {
    var sec = document.getElementById('tokenSection'); if (!sec) return;
    var wrap = sec.querySelector('.tp-chartwrap');
    if (wrap && !wrap.querySelector('canvas.tp-chart')) wrap.innerHTML = '<canvas class="tp-chart"></canvas>';
    var canvas = sec.querySelector('canvas.tp-chart'); if (!canvas) return;
    var cfg = rangeCfg(currentRange);
    var url = GT_API + gtNetwork(tok.chain) + '/pools/' + tok.pair
      + '/ohlcv/' + cfg.tf + '?aggregate=' + cfg.agg + '&limit=' + cfg.lim + '&currency=usd';
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('ohlcv ' + res.status);
      var json = await res.json();
      var list = json && json.data && json.data.attributes && json.data.attributes.ohlcv_list;
      if (!list || !list.length) throw new Error('no candles');
      list = list.slice().sort(function (a, b) { return a[0] - b[0]; });
      chartData = list.map(function (r) { return { t: r[0], c: Number(r[4]) }; });
      chartMode = 'canvas';
      wireChart(canvas);
      drawChart(canvas, chartData, null);
    } catch (e) {
      console.warn('[token] candles unavailable, embed fallback:', e.message);
      chartMode = 'iframe';
      if (wrap) {
        var src = 'https://dexscreener.com/' + encodeURIComponent(tok.chain) + '/'
          + encodeURIComponent(tok.pair) + '?embed=1&theme=dark&info=0&trades=0';
        wrap.innerHTML = '<iframe class="tp-chart" src="' + src + '" loading="lazy" allow="clipboard-write" referrerpolicy="no-referrer"></iframe>';
      }
    }
  }

  function fmtAxisPrice(v) {
    if (v >= 1000) return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
    if (v >= 1)    return '$' + v.toFixed(2);
    if (v >= 0.01) return '$' + v.toFixed(4);
    return '$' + Number(v.toPrecision(3));
  }
  function fmtAxisLabel(ts, span) {
    var d = new Date(ts * 1000);
    if (span <= 2 * 86400)   return two(d.getHours()) + ':' + two(d.getMinutes());
    if (span <= 220 * 86400) return (d.getMonth() + 1) + '/' + d.getDate();
    return (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
  }
  function fmtHoverTime(ts, span) {
    var d = new Date(ts * 1000);
    if (span <= 2 * 86400) return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Smooth path (Catmull-Rom -> bezier) through {x,y} points
  function smoothPath(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y
      );
    }
  }

  function drawChart(canvas, data, hoverIdx) {
    if (!data || data.length < 2) return;
    var w = canvas.clientWidth || 320, h = canvas.clientHeight || 230;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var up = cssVar('--up', '#3ecf8e'), down = cssVar('--down', '#ff6b6b');
    var textDim = cssVar('--text-dim', '#9a9aa2'), text = cssVar('--text', '#f2f2f4');
    var grid = hexToRgba(cssVar('--text', '#ffffff') || '#ffffff', 0.07) || 'rgba(255,255,255,0.07)';

    var vals = data.map(function (d) { return d.c; });
    var span = data[data.length - 1].t - data[0].t;
    var rising = vals[vals.length - 1] >= vals[0];
    var color = rising ? up : down;

    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var padV = (max - min) * 0.08 || max * 0.02 || 1;
    min -= padV; max += padV;
    var n = vals.length, plotW = w - AX.L - AX.R, plotH = h - AX.T - AX.B;
    function X(i) { return AX.L + (i / (n - 1)) * plotW; }
    function Y(v) { return AX.T + (1 - (v - min) / (max - min)) * plotH; }

    var pts = [];
    for (var i = 0; i < n; i++) pts.push({ x: X(i), y: Y(vals[i]) });

    // Y grid + right-side price labels
    ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    var ySteps = 4;
    for (var s = 0; s <= ySteps; s++) {
      var pv = min + (max - min) * (s / ySteps), gy = Y(pv);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(AX.L, gy); ctx.lineTo(w - AX.R, gy); ctx.stroke();
      ctx.fillStyle = textDim; ctx.textAlign = 'right';
      ctx.fillText(fmtAxisPrice(pv), w - 6, gy);
    }

    // X labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = textDim;
    var xTicks = Math.min(4, n - 1);
    for (var kx = 0; kx <= xTicks; kx++) {
      var xi = Math.round((kx / xTicks) * (n - 1));
      var lx = Math.max(AX.L + 14, Math.min(w - AX.R - 14, X(xi)));
      ctx.fillText(fmtAxisLabel(data[xi].t, span), lx, h - AX.B + 5);
    }

    // area
    ctx.beginPath(); smoothPath(ctx, pts);
    ctx.lineTo(pts[n - 1].x, AX.T + plotH); ctx.lineTo(pts[0].x, AX.T + plotH); ctx.closePath();
    var grad = ctx.createLinearGradient(0, AX.T, 0, AX.T + plotH);
    grad.addColorStop(0, hexToRgba(color, 0.30) || color);
    grad.addColorStop(1, hexToRgba(color, 0.0) || 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath(); smoothPath(ctx, pts);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();

    // current-price pill on the right
    var ly = Y(vals[n - 1]);
    var pill = fmtAxisPrice(vals[n - 1]);
    ctx.font = '600 10px system-ui, sans-serif';
    var pw = ctx.measureText(pill).width + 12;
    var pxx = w - pw - 2, pyy = Math.max(AX.T, Math.min(ly - 9, AX.T + plotH - 18));
    ctx.fillStyle = color; roundRect(ctx, pxx, pyy, pw, 18, 4); ctx.fill();
    ctx.fillStyle = '#08131f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pill, pxx + pw / 2, pyy + 9);
    // dot at last point
    ctx.beginPath(); ctx.arc(pts[n - 1].x, ly, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();

    // crosshair + tooltip
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
      var hx = pts[hoverIdx].x, hv = vals[hoverIdx], hy = pts[hoverIdx].y;
      ctx.save();
      ctx.setLineDash([3, 3]); ctx.strokeStyle = textDim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, AX.T); ctx.lineTo(hx, AX.T + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = cssVar('--panel-bg', '#111'); ctx.lineWidth = 2; ctx.stroke();

      var priceStr = fmtPrice(hv), timeStr = fmtHoverTime(data[hoverIdx].t, span);
      ctx.font = '600 12px system-ui, sans-serif';
      var pwid = ctx.measureText(priceStr).width;
      ctx.font = '10px system-ui, sans-serif';
      var twd = Math.max(pwid, ctx.measureText(timeStr).width) + 16, thg = 34;
      var bx = hx + 10; if (bx + twd > w - AX.R) bx = hx - 10 - twd;
      bx = Math.max(AX.L, Math.min(bx, w - AX.R - twd));
      var by = Math.max(AX.T, Math.min(hy - thg - 8, AX.T + plotH - thg));
      ctx.fillStyle = 'rgba(0,0,0,0.85)'; roundRect(ctx, bx, by, twd, thg, 6); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = text; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText(priceStr, bx + 8, by + 6);
      ctx.fillStyle = textDim; ctx.font = '10px system-ui, sans-serif'; ctx.fillText(timeStr, bx + 8, by + 20);
      ctx.restore();
    }
  }

  function pointerIndex(canvas, clientX) {
    if (!chartData || chartData.length < 2) return null;
    var rect = canvas.getBoundingClientRect(), w = canvas.clientWidth || 320;
    var frac = (clientX - rect.left - AX.L) / (w - AX.L - AX.R);
    frac = Math.max(0, Math.min(1, frac));
    return Math.round(frac * (chartData.length - 1));
  }
  function wireChart(canvas) {
    if (canvas._wired) return; canvas._wired = true;
    function move(cx) { if (chartMode === 'canvas' && chartData) drawChart(canvas, chartData, pointerIndex(canvas, cx)); }
    function clear() { if (chartMode === 'canvas' && chartData) drawChart(canvas, chartData, null); }
    canvas.addEventListener('mousemove', function (e) { move(e.clientX); });
    canvas.addEventListener('mouseleave', clear);
    canvas.addEventListener('touchstart', function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    canvas.addEventListener('touchmove', function (e) { if (e.touches[0]) { move(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('touchend', clear);
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (chartMode !== 'canvas' || !chartData) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var c = document.querySelector('#tokenSection canvas.tp-chart');
      if (c) drawChart(c, chartData, null);
    }, 150);
  });

  // ---- token fetch ------------------------------------------------------
  async function resolvePair() {
    var res = await fetch(DS_TOKENS + encodeURIComponent(TOKEN_ADDRESS));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var pairs = (data && data.pairs) || [];
    if (!pairs.length) return null;
    var t = TOKEN_ADDRESS.toLowerCase();
    var pref = pairs.filter(function (p) { return p.baseToken && p.baseToken.address && p.baseToken.address.toLowerCase() === t; });
    return (pref.length ? pref : pairs).sort(function (a, b) {
      return Number((b.liquidity && b.liquidity.usd) || 0) - Number((a.liquidity && a.liquidity.usd) || 0);
    })[0];
  }

  async function refreshToken(full) {
    try {
      var pair;
      if (!tok.pair) {
        pair = await resolvePair();
        if (!pair) { var s = document.getElementById('tokenSection'); if (s) s.innerHTML = '<div class="p-msg">No pool found for this token.</div>'; return; }
        tok.chain = pair.chainId; tok.pair = pair.pairAddress;
      } else {
        var res = await fetch(DS_PAIRS + encodeURIComponent(tok.chain) + '/' + encodeURIComponent(tok.pair));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        pair = (data && data.pairs && data.pairs[0]) || (data && data.pair);
      }
      if (!pair) return;
      var sec = document.getElementById('tokenSection');
      if (full || !sec || !sec.querySelector('.tp-price')) renderToken(pair);
      else { updateTokenStats(pair); if (chartMode === 'canvas') loadChart(); }
    } catch (e) {
      console.warn('[token] load failed:', e.message);
      var sc = document.getElementById('tokenSection');
      if (sc && !sc.querySelector('.tp-price')) sc.innerHTML = '<div class="p-msg">Could not load token data.</div>';
    }
  }

  // ===================================================================
  //  TREASURY (SAFE) SECTION
  // ===================================================================
  async function loadSafe() {
    var sec = document.getElementById('treasurySection'); if (!sec) return;
    var url = SAFE_GW + '/v1/chains/' + SAFE_CHAIN + '/safes/' + SAFE_ADDRESS + '/balances/USD?trusted=true&exclude_spam=true';
    try {
      var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      renderSafe(sec, await res.json());
    } catch (e) {
      console.warn('[safe] load failed:', e.message);
      sec.innerHTML = '<div class="p-msg">Could not load treasury assets.</div>';
    }
  }
  function renderSafe(sec, data) {
    var items = (data && data.items) ? data.items.slice() : [];
    items.sort(function (a, b) { return Number(b.fiatBalance || 0) - Number(a.fiatBalance || 0); });
    var link = 'https://app.safe.global/home?safe=' + SAFE_PREFIX + ':' + SAFE_ADDRESS;
    var rows = items.map(function (it) {
      var t = it.tokenInfo || {}, sym = t.symbol || '???';
      var icon = t.logoUri
        ? '<img class="sp-ico" src="' + t.logoUri + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        : '<span class="sp-ico"></span>';
      return '<div class="sp-row">' + icon
        + '<div class="sp-meta"><div class="sp-sym">' + sym + '</div>'
        + '<div class="sp-amt">' + fmtAmount(it.balance, t.decimals) + ' ' + sym + '</div></div>'
        + '<div class="sp-val">' + fmtCompact(it.fiatBalance) + '</div></div>';
    }).join('');
    if (!rows) rows = '<div class="p-msg">No assets in this Safe.</div>';
    sec.innerHTML =
      '<div class="sp-addr"><a href="' + link + '" target="_blank" rel="noopener">' + shortAddr(SAFE_ADDRESS) + ' \u2197</a></div>'
      + '<div class="sp-total">' + fmtCompact(data ? data.fiatTotal : 0) + '</div>'
      + '<div class="sp-list">' + rows + '</div>'
      + '<div class="p-foot">' + items.length + ' asset' + (items.length === 1 ? '' : 's') + ' \u00b7 via Safe</div>';
  }

  // ===================================================================
  //  WIRE TO WALLET EVENTS
  // ===================================================================
  window.addEventListener('wallet:connected', function () {
    var el = ensurePanel();
    show(el);
    if (!tokenReady) { tokenReady = true; refreshToken(true); }
    else refreshToken(false);
    if (!safeReady) { safeReady = true; loadSafe(); }
    if (!refreshTimer) refreshTimer = setInterval(function () { refreshToken(false); }, REFRESH_MS);
  });
  window.addEventListener('wallet:disconnected', function () {
    var el = document.getElementById('dashPanel');
    if (el) hide(el);
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  });
})();
