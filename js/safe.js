/* =====================================================================
   Safe assets panel.

   When a visitor connects their wallet, this shows the assets held in a
   Gnosis Safe. Data comes from the Safe Client Gateway (the same API the
   official Safe app uses) — no API key needed for read access.

   All styling lives in css/theme.css (shared .panel look + #safePanel).
   Change SAFE_ADDRESS / SAFE_CHAIN below to point at a different Safe.
   ===================================================================== */

(function () {
  var SAFE_ADDRESS = '0x108eD952C1D78F3E502Ad6A07506e5651cEFF682';
  var SAFE_CHAIN   = 1;      // 1 = Ethereum mainnet
  var CHAIN_PREFIX = 'eth';  // used for the app.safe.global link
  var FIAT         = 'USD';
  var GATEWAY      = 'https://safe-client.safe.global';

  function fmtUsd(n) {
    return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  }
  function fmtAmount(raw, decimals) {
    var val = Number(raw) / Math.pow(10, Number(decimals || 0));
    if (!isFinite(val) || val === 0) return '0';
    if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (val >= 1)    return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return val.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function shortAddr(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }

  function ensurePanel() {
    var el = document.getElementById('safePanel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'safePanel';
    el.className = 'panel';
    document.body.appendChild(el);
    return el;
  }
  function show(el) { el.classList.add('open'); }
  function hide(el) { el.classList.remove('open'); }

  function head() {
    return '<div class="p-head"><span class="p-title">Safe Assets</span>'
      + '<button class="p-close" aria-label="Close">&times;</button></div>';
  }
  function wireClose(el) {
    var btn = el.querySelector('.p-close');
    if (btn) btn.addEventListener('click', function () { hide(el); });
  }

  function renderLoading(el) {
    el.innerHTML = head() + '<div class="p-msg">Loading assets\u2026</div>';
    wireClose(el);
  }
  function renderError(el, msg) {
    el.innerHTML = head() + '<div class="p-msg">Could not load Safe assets.<br>' + (msg || '') + '</div>';
    wireClose(el);
  }
  function renderData(el, data) {
    var items = (data && data.items) ? data.items.slice() : [];
    items.sort(function (a, b) { return Number(b.fiatBalance || 0) - Number(a.fiatBalance || 0); });

    var link = 'https://app.safe.global/home?safe=' + CHAIN_PREFIX + ':' + SAFE_ADDRESS;
    var rows = items.map(function (it) {
      var t = it.tokenInfo || {};
      var sym = t.symbol || '???';
      var icon = t.logoUri
        ? '<img class="sp-ico" src="' + t.logoUri + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        : '<span class="sp-ico"></span>';
      return '<div class="sp-row">' + icon
        + '<div class="sp-meta"><div class="sp-sym">' + sym + '</div>'
        + '<div class="sp-amt">' + fmtAmount(it.balance, t.decimals) + ' ' + sym + '</div></div>'
        + '<div class="sp-val">' + fmtUsd(it.fiatBalance) + '</div></div>';
    }).join('');
    if (!rows) rows = '<div class="p-msg">No assets found in this Safe.</div>';

    el.innerHTML = head()
      + '<div class="sp-addr"><a href="' + link + '" target="_blank" rel="noopener">'
      + shortAddr(SAFE_ADDRESS) + ' \u2197</a></div>'
      + '<div class="sp-total">' + fmtUsd(data ? data.fiatTotal : 0) + '</div>'
      + '<div class="sp-list">' + rows + '</div>'
      + '<div class="p-foot">' + items.length + ' asset' + (items.length === 1 ? '' : 's') + ' \u00b7 via Safe</div>';
    wireClose(el);
  }

  var loaded = false;
  async function loadAssets(el) {
    renderLoading(el);
    var url = GATEWAY + '/v1/chains/' + SAFE_CHAIN + '/safes/' + SAFE_ADDRESS
      + '/balances/' + FIAT + '?trusted=true&exclude_spam=true';
    try {
      var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      renderData(el, await res.json());
      loaded = true;
    } catch (e) {
      console.warn('[safe] load failed:', e.message);
      renderError(el, e.message);
    }
  }

  window.addEventListener('wallet:connected', function () {
    var el = ensurePanel();
    show(el);
    if (!loaded) loadAssets(el);
  });
  window.addEventListener('wallet:disconnected', function () {
    var el = document.getElementById('safePanel');
    if (el) hide(el);
  });
})();
