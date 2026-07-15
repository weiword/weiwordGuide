/* =====================================================================
   App: header nav + full-screen pages (shown after a wallet connects).

     $WW      -> token info + holder data (DexScreener + Blockscout)
     Staking  -> placeholder
     Treasury -> Gnosis Safe assets

   Styling lives in css/theme.css. Config constants are at the top.
   ===================================================================== */

(function () {
  // ---- config -----------------------------------------------------------
  var TOKEN_ADDRESS = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'; // $WW token

  var SAFE_ADDRESS = '0x108eD952C1D78F3E502Ad6A07506e5651cEFF682';
  var SAFE_CHAIN   = 1;
  var SAFE_PREFIX  = 'eth';

  var DS_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
  var DS_PAIRS  = 'https://api.dexscreener.com/latest/dex/pairs/';
  var SAFE_GW   = 'https://safe-client.safe.global';
  var REFRESH_MS = 30000;

  // Public, keyless Blockscout instances per chain (for holder data)
  var BLOCKSCOUT = {
    ethereum: 'https://eth.blockscout.com',
    base: 'https://base.blockscout.com',
    optimism: 'https://optimism.blockscout.com',
    arbitrum: 'https://arbitrum.blockscout.com',
    polygon: 'https://polygon.blockscout.com',
    gnosis: 'https://gnosis.blockscout.com'
  };
  function scoutBase() { return BLOCKSCOUT[tok.chain] || null; }

  var PAGES = [
    { k: 'ww',       label: '$WW' },
    { k: 'staking',  label: 'Staking' },
    { k: 'treasury', label: 'Treasury' }
  ];

  // ---- state ------------------------------------------------------------
  var tok = { chain: null, pair: null };
  var tokenPair = null, holderData = null, safeData = null, activePage = 'ww';
  var refreshTimer = null;

  // ---- formatting -------------------------------------------------------
  function fmtPrice(p) {
    var v = Number(p);
    if (!isFinite(v) || v === 0) return '$0';
    if (v >= 1)    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (v >= 0.01) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    return '$' + v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  function fmtUsd(n) {
    var v = Number(n);
    if (!isFinite(v) || v === 0) return '\u2014';
    return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
  }
  function fmtNum(n) {
    var v = Number(n);
    if (!isFinite(v)) return '\u2014';
    return v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
  }
  function fmtInt(n) {
    var v = Number(n);
    if (!isFinite(v)) return '\u2014';
    return v.toLocaleString();
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
  function shortAddr(a) { return a ? a.slice(0, 6) + '\u2026' + a.slice(-4) : ''; }
  function enc(x) { return encodeURIComponent(x); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }

  // ---- panel ------------------------------------------------------------
  function ensurePanel() {
    var el = document.getElementById('dashPanel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dashPanel';
    el.innerHTML = '<div class="dash-scroll" id="pageContent"></div>';
    document.body.appendChild(el);
    return el;
  }
  function show(el) { el.classList.add('open'); }
  function hide(el) { el.classList.remove('open'); }
  function content() { return document.getElementById('pageContent'); }

  // ===================================================================
  //  PAGE: $WW
  // ===================================================================
  function statCard(k, v, cls) {
    return '<div class="es-card es-stat"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
  }

  function wwHtml() {
    var pair = tokenPair, hd = holderData;
    var base = scoutBase();
    var info = (pair && pair.info) || {};
    var baseSym = (pair && pair.baseToken && pair.baseToken.symbol) || 'WW';
    var name = (pair && pair.baseToken && pair.baseToken.name) || '$WW';
    var chg = pair && pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var logo = info.imageUrl
      ? '<img class="es-logo" src="' + esc(info.imageUrl) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      : '<span class="es-logo"></span>';
    var tokenLink = base ? (base + '/token/' + TOKEN_ADDRESS) : ('https://dexscreener.com/' + tok.chain + '/' + (tok.pair || ''));

    // holder-derived values
    var holders = hd && hd.counters ? hd.counters.token_holders_count : (hd && hd.info ? hd.info.holders_count : null);
    var transfers = hd && hd.counters ? hd.counters.transfers_count : null;
    var supplyRaw = hd && hd.info ? hd.info.total_supply : null;
    var decimals = hd && hd.info ? Number(hd.info.decimals) : 18;
    var supply = supplyRaw != null ? fmtNum(Number(supplyRaw) / Math.pow(10, decimals)) : '\u2014';

    var cards =
      statCard('Price', pair ? fmtPrice(pair.priceUsd) : '\u2014')
      + statCard('Market Cap', pair ? fmtUsd(pair.marketCap || pair.fdv) : '\u2014')
      + statCard('Liquidity', pair ? fmtUsd(pair.liquidity ? pair.liquidity.usd : null) : '\u2014')
      + statCard('Volume 24h', pair ? fmtUsd(pair.volume ? pair.volume.h24 : null) : '\u2014')
      + statCard('Holders', holders != null ? fmtInt(holders) : (hd === null ? '\u2026' : '\u2014'))
      + statCard('Total Supply', supply)
      + statCard('Transfers', transfers != null ? fmtInt(transfers) : (hd === null ? '\u2026' : '\u2014'));

    // top holders table
    var rowsHtml = '';
    var items = hd && hd.holders && hd.holders.items ? hd.holders.items.slice(0, 15) : [];
    if (items.length) {
      var totalForPct = supplyRaw ? Number(supplyRaw) : null;
      rowsHtml = items.map(function (it, i) {
        var a = it.address || it.address_hash;
        var hash = (typeof a === 'string') ? a : (a && a.hash);
        var qty = fmtAmount(it.value, decimals);
        var pct = totalForPct ? (Number(it.value) / totalForPct * 100) : null;
        var addrCell = hash
          ? (base ? '<a class="mono" href="' + base + '/address/' + hash + '" target="_blank" rel="noopener">' + shortAddr(hash) + '</a>'
                  : '<span class="mono">' + shortAddr(hash) + '</span>')
          : '\u2014';
        return '<tr><td>' + (i + 1) + '</td><td>' + addrCell + '</td>'
          + '<td class="num mono">' + qty + '</td>'
          + '<td class="num mono">' + (pct != null ? pct.toFixed(2) + '%' : '\u2014') + '</td></tr>';
      }).join('');
    } else if (hd === null) {
      rowsHtml = '<tr><td colspan="4"><span class="es-note" style="padding:10px 0;display:block">Loading holders\u2026</span></td></tr>';
    } else if (!base) {
      rowsHtml = '<tr><td colspan="4"><span class="es-note" style="padding:10px 0;display:block">Holder data not available for this chain.</span></td></tr>';
    } else {
      rowsHtml = '<tr><td colspan="4"><span class="es-note" style="padding:10px 0;display:block">No holder data.</span></td></tr>';
    }

    var table =
      '<div class="es-card"><div class="es-card-h">Top Holders</div>'
      + '<div class="es-scroll-x"><table class="es-table"><thead><tr>'
      + '<th>#</th><th>Address</th><th class="num">Quantity</th><th class="num">Percentage</th>'
      + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';

    return '<div class="es-title">' + logo + '<h1>' + esc(name) + ' (' + esc(baseSym) + ')</h1>'
      + (chg !== null && chg !== undefined ? '<span class="chg ' + chgClass + '">' + fmtPct(chg) + ' (24h)</span>' : '')
      + '</div>'
      + '<div class="es-addr"><a href="' + tokenLink + '" target="_blank" rel="noopener">' + TOKEN_ADDRESS + ' \u2197</a></div>'
      + '<div class="es-cards">' + cards + '</div>'
      + table;
  }

  // ===================================================================
  //  PAGE: Staking
  // ===================================================================
  function stakingHtml() {
    return '<div class="es-title"><h1>$WW Staking</h1></div>'
      + '<div class="es-cards">'
      + statCard('APR', '\u2014')
      + statCard('Total Staked', '\u2014')
      + statCard('Your Stake', '\u2014')
      + statCard('Rewards', '\u2014')
      + '</div>'
      + '<div class="es-card"><div class="es-card-h">Staking</div><div class="es-note">Staking is coming soon.</div></div>';
  }

  // ===================================================================
  //  PAGE: Treasury
  // ===================================================================
  function treasuryHtml(data) {
    var items = (data && data.items) ? data.items.slice() : [];
    items.sort(function (a, b) { return Number(b.fiatBalance || 0) - Number(a.fiatBalance || 0); });
    var link = 'https://app.safe.global/home?safe=' + SAFE_PREFIX + ':' + SAFE_ADDRESS;
    var rows = items.map(function (it) {
      var t = it.tokenInfo || {}, sym = t.symbol || '???';
      var icon = t.logoUri ? '<img class="es-ico" src="' + esc(t.logoUri) + '" alt="" onerror="this.style.display=\'none\'">' : '';
      return '<tr><td>' + icon + esc(sym) + '</td>'
        + '<td class="num mono">' + fmtAmount(it.balance, t.decimals) + '</td>'
        + '<td class="num mono">' + fmtUsd(it.fiatBalance) + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="3"><span class="es-note" style="padding:10px 0;display:block">No assets in this Safe.</span></td></tr>';

    return '<div class="es-title"><h1>Treasury</h1></div>'
      + '<div class="es-addr"><a href="' + link + '" target="_blank" rel="noopener">' + SAFE_ADDRESS + ' \u2197</a></div>'
      + '<div class="es-cards">'
      + statCard('Total Value', fmtUsd(data ? data.fiatTotal : 0))
      + statCard('Assets', fmtInt(items.length))
      + '</div>'
      + '<div class="es-card"><div class="es-card-h">Assets</div>'
      + '<div class="es-scroll-x"><table class="es-table"><thead><tr>'
      + '<th>Asset</th><th class="num">Balance</th><th class="num">Value</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  // ===================================================================
  //  DATA
  // ===================================================================
  async function resolvePair() {
    var res = await fetch(DS_TOKENS + enc(TOKEN_ADDRESS));
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
  async function loadToken() {
    if (!tok.pair) {
      var p = await resolvePair();
      if (!p) throw new Error('no pool');
      tok.chain = p.chainId; tok.pair = p.pairAddress; tokenPair = p; return p;
    }
    var res = await fetch(DS_PAIRS + enc(tok.chain) + '/' + enc(tok.pair));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var d = await res.json();
    tokenPair = (d && d.pairs && d.pairs[0]) || (d && d.pair) || tokenPair;
    return tokenPair;
  }
  async function loadHolders() {
    var base = scoutBase();
    if (!base) return { info: null, counters: null, holders: null };
    function get(path) { return fetch(base + path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    var results = await Promise.all([
      get('/api/v2/tokens/' + TOKEN_ADDRESS),
      get('/api/v2/tokens/' + TOKEN_ADDRESS + '/counters'),
      get('/api/v2/tokens/' + TOKEN_ADDRESS + '/holders')
    ]);
    return { info: results[0], counters: results[1], holders: results[2] };
  }
  async function loadSafe() {
    var url = SAFE_GW + '/v1/chains/' + SAFE_CHAIN + '/safes/' + SAFE_ADDRESS + '/balances/USD?trusted=true&exclude_spam=true';
    var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    safeData = await res.json();
    return safeData;
  }

  // ===================================================================
  //  ROUTER
  // ===================================================================
  function renderPage(key) {
    var c = content(); if (!c) return;

    if (key === 'staking') { c.innerHTML = stakingHtml(); return; }

    if (key === 'ww') {
      c.innerHTML = wwHtml();
      if (!tokenPair) loadToken().then(function () { if (activePage === 'ww' && content()) content().innerHTML = wwHtml(); })
        .catch(function () { if (activePage === 'ww' && content()) content().innerHTML = wwHtml(); });
      if (!holderData) loadHolders().then(function (d) { holderData = d; if (activePage === 'ww' && content()) content().innerHTML = wwHtml(); })
        .catch(function () { holderData = { info: null, counters: null, holders: null }; if (activePage === 'ww' && content()) content().innerHTML = wwHtml(); });
      return;
    }

    if (key === 'treasury') {
      if (safeData) { c.innerHTML = treasuryHtml(safeData); return; }
      c.innerHTML = '<div class="es-title"><h1>Treasury</h1></div><div class="es-note">Loading treasury\u2026</div>';
      loadSafe().then(function () { if (activePage === 'treasury' && content()) content().innerHTML = treasuryHtml(safeData); })
        .catch(function () { if (activePage === 'treasury' && content()) content().innerHTML = '<div class="es-title"><h1>Treasury</h1></div><div class="es-note">Could not load treasury.</div>'; });
      return;
    }
  }

  function setActive(key) {
    ['nav', 'mobileNav'].forEach(function (id) {
      var box = document.getElementById(id); if (!box) return;
      var links = box.querySelectorAll('a[data-p]');
      for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-p') === key);
    });
  }
  function showPage(key) {
    activePage = key;
    show(ensurePanel());
    setActive(key);
    renderPage(key);
  }

  function navHtml() {
    return PAGES.map(function (p) { return '<a data-p="' + p.k + '" href="javascript:void(0)">' + p.label + '</a>'; }).join('');
  }
  function buildNav() {
    var nav = document.getElementById('nav'); if (nav) nav.innerHTML = navHtml();
    var mnav = document.getElementById('mobileNav'); if (mnav) mnav.innerHTML = navHtml();
    setActive(activePage);
  }
  function clearNav() {
    var nav = document.getElementById('nav'); if (nav) nav.innerHTML = '';
    var mnav = document.getElementById('mobileNav'); if (mnav) { mnav.innerHTML = ''; mnav.classList.remove('open'); }
  }
  function closeMobileMenu() { var m = document.getElementById('mobileNav'); if (m) m.classList.remove('open'); }

  function bindNav(box) {
    if (!box || box._bound) return;
    box._bound = true;
    box.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-p]') : null;
      if (!a) return;
      showPage(a.getAttribute('data-p'));
      closeMobileMenu();
    });
  }
  bindNav(document.getElementById('nav'));
  bindNav(document.getElementById('mobileNav'));
  var burger = document.getElementById('hamburger');
  if (burger) burger.addEventListener('click', function () {
    var m = document.getElementById('mobileNav'); if (m) m.classList.toggle('open');
  });

  // ===================================================================
  //  WALLET EVENTS
  // ===================================================================
  window.addEventListener('wallet:connected', function () {
    document.body.classList.add('connected');
    buildNav();
    showPage(activePage || 'ww');
    if (!refreshTimer) refreshTimer = setInterval(function () {
      if (activePage === 'ww') loadToken().then(function () {
        if (activePage === 'ww' && content()) content().innerHTML = wwHtml();
      }).catch(function () {});
    }, REFRESH_MS);
  });
  window.addEventListener('wallet:disconnected', function () {
    document.body.classList.remove('connected');
    clearNav();
    var el = document.getElementById('dashPanel'); if (el) hide(el);
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  });
})();
