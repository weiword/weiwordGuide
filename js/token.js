/* =====================================================================
   Token info panel (data + custom chart).

   - Price / market cap / liquidity / 24h volume from DexScreener API.
   - Chart is drawn by us on a <canvas> from GeckoTerminal OHLCV candles,
     so it carries no third-party branding and follows the theme colors.
   - If candles aren't available for a pair, it falls back to the
     DexScreener embed chart so something always shows.

   All styling lives in css/theme.css. Change the DEFAULT_* values below
   to point at a different token.
   ===================================================================== */

(function () {
  var DEFAULT_CHAIN = 'robinhood';
  var DEFAULT_PAIR  = '0x8e8fa19c2ec1ddf5048fa3119953d6f21856bb18';
  var DS_API   = 'https://api.dexscreener.com/latest/dex/pairs/';
  var GT_API   = 'https://api.geckoterminal.com/api/v2/networks/';
  var REFRESH_MS = 30000;

  // DexScreener chain slug -> GeckoTerminal network id (for candle data)
  var GT_NET = {
    ethereum: 'eth', bsc: 'bsc', polygon: 'polygon_pos', arbitrum: 'arbitrum',
    base: 'base', optimism: 'optimism', avalanche: 'avax', solana: 'solana',
    fantom: 'ftm', robinhood: 'robinhood'
  };
  function gtNetwork(chain) { return GT_NET[chain] || chain; }

  var state = { chain: DEFAULT_CHAIN, pair: DEFAULT_PAIR };
  var chartPts = null;      // last candle data (for redraw on resize)
  var chartMode = 'canvas'; // 'canvas' or 'iframe'
  var refreshTimer = null;

  // ---- formatting --------------------------------------------------------
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

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function hexToRgba(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) {
      var s = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex.trim());
      if (!s) return null;
      m = [null, s[1] + s[1], s[2] + s[2], s[3] + s[3]];
    }
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  // ---- DOM ---------------------------------------------------------------
  function ensurePanel() {
    var el = document.getElementById('tokenPanel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tokenPanel';
    el.className = 'panel';
    document.body.appendChild(el);
    return el;
  }

  function renderMsg(el, msg) {
    el.innerHTML = '<div class="p-head"><span class="p-title">Token</span></div>'
      + '<div class="p-msg">' + msg + '</div>';
  }

  function render(el, pair) {
    var info = pair.info || {};
    var baseSym = (pair.baseToken && pair.baseToken.symbol) || '?';
    var quoteSym = (pair.quoteToken && pair.quoteToken.symbol) || '';
    var name = (pair.baseToken && pair.baseToken.name) || baseSym;
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var logoHtml = info.imageUrl
      ? '<img class="tp-logo" src="' + info.imageUrl + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      : '<span class="tp-logo"></span>';

    el.innerHTML =
      '<div class="p-head">' + logoHtml
      + '<div><div class="tp-name">' + name + '</div>'
      + '<div class="tp-sub">' + baseSym + (quoteSym ? ' / ' + quoteSym : '') + ' \u00b7 ' + state.chain + '</div></div></div>'
      + '<div class="tp-price-row"><span class="tp-price">' + fmtPrice(pair.priceUsd) + '</span>'
      + (chg !== null && chg !== undefined ? '<span class="tp-chg ' + chgClass + '">' + fmtPct(chg) + ' (24h)</span>' : '')
      + '</div>'
      + '<div class="tp-stats">'
      + '<div class="tp-cell"><div class="k">Market Cap</div><div class="v">' + fmtCompact(pair.marketCap || pair.fdv) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Liquidity</div><div class="v">' + fmtCompact(pair.liquidity ? pair.liquidity.usd : null) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Vol 24h</div><div class="v">' + fmtCompact(pair.volume ? pair.volume.h24 : null) + '</div></div>'
      + '</div>'
      + '<div class="tp-chartwrap"><canvas class="tp-chart"></canvas></div>';

    loadChart(el);
  }

  function updateStats(el, pair) {
    var price = el.querySelector('.tp-price');
    if (price) price.textContent = fmtPrice(pair.priceUsd);
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgEl = el.querySelector('.tp-chg');
    if (chgEl && chg !== null && chg !== undefined) {
      chgEl.textContent = fmtPct(chg) + ' (24h)';
      chgEl.className = 'tp-chg ' + (chg > 0 ? 'up' : (chg < 0 ? 'down' : ''));
    }
    var cells = el.querySelectorAll('.tp-cell .v');
    if (cells.length === 3) {
      cells[0].textContent = fmtCompact(pair.marketCap || pair.fdv);
      cells[1].textContent = fmtCompact(pair.liquidity ? pair.liquidity.usd : null);
      cells[2].textContent = fmtCompact(pair.volume ? pair.volume.h24 : null);
    }
  }

  // ---- chart -------------------------------------------------------------
  async function loadChart(el) {
    var canvas = el.querySelector('canvas.tp-chart');
    if (!canvas) return;
    var url = GT_API + gtNetwork(state.chain) + '/pools/' + state.pair
      + '/ohlcv/hour?aggregate=1&limit=120&currency=usd';
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('ohlcv ' + res.status);
      var json = await res.json();
      var list = json && json.data && json.data.attributes && json.data.attributes.ohlcv_list;
      if (!list || !list.length) throw new Error('no candles');
      list = list.slice().sort(function (a, b) { return a[0] - b[0]; });
      chartPts = list.map(function (r) { return Number(r[4]); }); // close prices
      chartMode = 'canvas';
      drawChart(canvas, chartPts);
    } catch (e) {
      console.warn('[token] candles unavailable, using embed fallback:', e.message);
      useIframeFallback(el);
    }
  }

  function useIframeFallback(el) {
    chartMode = 'iframe';
    var wrap = el.querySelector('.tp-chartwrap');
    if (!wrap) return;
    var src = 'https://dexscreener.com/' + encodeURIComponent(state.chain) + '/'
      + encodeURIComponent(state.pair) + '?embed=1&theme=dark&info=0&trades=0';
    wrap.innerHTML = '<iframe class="tp-chart" src="' + src + '" loading="lazy" '
      + 'allow="clipboard-write" referrerpolicy="no-referrer"></iframe>';
  }

  function drawChart(canvas, vals) {
    if (!vals || vals.length < 2) return;
    var w = canvas.clientWidth || 320;
    var h = canvas.clientHeight || 200;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var up = cssVar('--up', '#3ecf8e');
    var down = cssVar('--down', '#ff6b6b');
    var rising = vals[vals.length - 1] >= vals[0];
    var color = rising ? up : down;

    var padL = 8, padR = 8, padT = 12, padB = 10;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min = min * 0.999; max = max * 1.001 || 1; }
    var n = vals.length;
    function X(i) { return padL + (i / (n - 1)) * (w - padL - padR); }
    function Y(v) { return padT + (1 - (v - min) / (max - min)) * (h - padT - padB); }

    // line
    ctx.beginPath();
    ctx.moveTo(X(0), Y(vals[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(X(i), Y(vals[i]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // area fill
    ctx.lineTo(X(n - 1), h - padB);
    ctx.lineTo(X(0), h - padB);
    ctx.closePath();
    var top = hexToRgba(color, 0.28) || color;
    var bot = hexToRgba(color, 0.0) || 'rgba(0,0,0,0)';
    var grad = ctx.createLinearGradient(0, padT, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bot);
    ctx.fillStyle = grad;
    ctx.fill();

    // last-price dot
    ctx.beginPath();
    ctx.arc(X(n - 1), Y(vals[n - 1]), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // redraw canvas chart on resize
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (chartMode !== 'canvas' || !chartPts) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var el = document.getElementById('tokenPanel');
      var canvas = el && el.querySelector('canvas.tp-chart');
      if (canvas) drawChart(canvas, chartPts);
    }, 150);
  });

  // ---- fetch stats + orchestrate ----------------------------------------
  async function refresh(el, full) {
    if (full) renderMsg(el, 'Loading token\u2026');
    try {
      var res = await fetch(DS_API + encodeURIComponent(state.chain) + '/' + encodeURIComponent(state.pair));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var pair = (data && data.pairs && data.pairs[0]) || (data && data.pair);
      if (!pair) { renderMsg(el, 'No pair found for ' + state.chain + ' / ' + state.pair + '.'); return; }

      if (full || !el.querySelector('.tp-price')) {
        render(el, pair);
      } else {
        updateStats(el, pair);
        if (chartMode === 'canvas') loadChart(el); // refresh candles quietly
      }
    } catch (e) {
      console.warn('[token] load failed:', e.message);
      renderMsg(el, 'Could not load token data. ' + e.message);
    }
  }

  function show(el) { el.classList.add('open'); }
  function hide(el) { el.classList.remove('open'); }

  var initialized = false;
  window.addEventListener('wallet:connected', function () {
    var el = ensurePanel();
    show(el);
    if (!initialized) { initialized = true; refresh(el, true); }
    else { refresh(el, false); }
    if (!refreshTimer) refreshTimer = setInterval(function () { refresh(el, false); }, REFRESH_MS);
  });

  window.addEventListener('wallet:disconnected', function () {
    var el = document.getElementById('tokenPanel');
    if (el) hide(el);
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  });
})();
