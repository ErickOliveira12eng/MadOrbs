// Cookie consent banner of madorbs.com (the game page and the guide pages; plain script, no build).
// Nothing from Google or the ad networks runs before the visitor agrees: Google Analytics (statistics),
// Google AdSense and the Adsterra banners (ads, src/client/ads.ts) load only after "Accept" (or that
// choice in "Customize"). The game asks window.madorbsConsent.allows('ads') and listens to the
// "madorbs:consent" event (a choice made without a reload). The choice is kept in
// this browser (localStorage "madorbs.consent"); the "Cookies" link in the footers opens the banner
// again (window.madorbsConsent.open()). Texts in English, Portuguese and Spanish (from the address).
(function () {
  'use strict';
  var KEY = 'madorbs.consent';
  /** Bump when what is asked changes: everybody is asked again. */
  var VERSION = 2;
  var GA_ID = 'G-H15R1L9QEF';
  var ADS_CLIENT = 'ca-pub-4734295007084792';

  var TEXTS = {
    en: {
      title: 'Cookies',
      body: 'Mad Orbs uses cookies only if you agree: for usage statistics (Google Analytics) and for ads (Google AdSense and Adsterra). The game works either way.',
      privacy: 'Privacy policy',
      privacyUrl: '/privacy',
      accept: 'Accept',
      reject: 'Reject',
      customize: 'Customize',
      save: 'Save choices',
      necessary: 'Necessary',
      necessaryText: 'Your settings, your sign-in and this choice, kept in your browser. Always on.',
      analytics: 'Usage statistics',
      analyticsText: 'Google Analytics: how many people visit and how the site is used.',
      ads: 'Ads',
      adsText: 'Google AdSense and Adsterra: ads on the menu screens that keep the game free, possibly based on your interests.',
      always: 'Always on',
    },
    pt: {
      title: 'Cookies',
      body: 'O Mad Orbs só usa cookies se você concordar: para estatísticas de uso (Google Analytics) e para anúncios (Google AdSense e Adsterra). O jogo funciona de qualquer jeito.',
      privacy: 'Política de privacidade',
      privacyUrl: '/pt/privacidade',
      accept: 'Aceitar',
      reject: 'Recusar',
      customize: 'Personalizar',
      save: 'Salvar escolhas',
      necessary: 'Necessários',
      necessaryText: 'Suas configurações, seu login e esta escolha, guardados no seu navegador. Sempre ligados.',
      analytics: 'Estatísticas de uso',
      analyticsText: 'Google Analytics: quantas pessoas visitam e como o site é usado.',
      ads: 'Anúncios',
      adsText: 'Google AdSense e Adsterra: anúncios nas telas de menu que mantêm o jogo grátis, possivelmente com base nos seus interesses.',
      always: 'Sempre ligados',
    },
    es: {
      title: 'Cookies',
      body: 'Mad Orbs solo usa cookies si aceptas: para estadísticas de uso (Google Analytics) y para anuncios (Google AdSense y Adsterra). El juego funciona igual.',
      privacy: 'Política de privacidad',
      privacyUrl: '/es/privacidad',
      accept: 'Aceptar',
      reject: 'Rechazar',
      customize: 'Personalizar',
      save: 'Guardar opciones',
      necessary: 'Necesarias',
      necessaryText: 'Tu configuración, tu sesión y esta elección, guardadas en tu navegador. Siempre activas.',
      analytics: 'Estadísticas de uso',
      analyticsText: 'Google Analytics: cuántas personas visitan y cómo se usa el sitio.',
      ads: 'Anuncios',
      adsText: 'Google AdSense y Adsterra: anuncios en las pantallas de menú que mantienen el juego gratis, posiblemente según tus intereses.',
      always: 'Siempre activas',
    },
  };
  // The language of the address (/pt/..., /es/..., English elsewhere), like src/i18n langOfPath
  var pathLang = /^\/(pt|es)(\/|$)/.exec(location.pathname);
  var T = TEXTS[pathLang ? pathLang[1] : 'en'];

  function read() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || 'null');
      return c && c.v === VERSION ? c : null;
    } catch (e) {
      return null;
    }
  }
  function write(choice) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: VERSION, analytics: !!choice.analytics, ads: !!choice.ads, at: new Date().toISOString() }));
    } catch (e) {
      /* storage blocked: the choice lasts for this page */
    }
  }

  // ------------------------------------------------------------ Google, after consent only
  var loaded = { analytics: false, ads: false };
  function loadScript(src, attrs) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    for (var k in attrs || {}) s.setAttribute(k, attrs[k]);
    document.head.appendChild(s);
  }
  function apply(choice) {
    if (choice.analytics && !loaded.analytics) {
      loaded.analytics = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () {
        window.dataLayer.push(arguments);
      };
      window.gtag('consent', 'default', {
        analytics_storage: 'granted',
        ad_storage: choice.ads ? 'granted' : 'denied',
        ad_user_data: choice.ads ? 'granted' : 'denied',
        ad_personalization: choice.ads ? 'granted' : 'denied',
      });
      window.gtag('js', new Date());
      // Visits are only counted on madorbs.com (not on localhost or in the test browsers)
      if (/(^|\.)madorbs\.com$/.test(location.hostname)) window.gtag('config', GA_ID);
      loadScript('https://www.googletagmanager.com/gtag/js?id=' + GA_ID);
    }
    if (choice.ads && !loaded.ads) {
      loaded.ads = true;
      loadScript('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADS_CLIENT, { crossorigin: 'anonymous' });
    }
  }

  /** Withdrawn consent: Google's cookies of this site are deleted and the page reloads without them. */
  function clearGoogleCookies() {
    var host = location.hostname;
    var domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^(_ga|_gid|_gat|__gads|__gpi|__eoi|_gcl)/.test(name)) return;
      domains.forEach(function (d) {
        document.cookie = name + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  function choose(choice) {
    var before = read();
    write(choice);
    close();
    if (before && ((before.analytics && !choice.analytics) || (before.ads && !choice.ads))) {
      clearGoogleCookies();
      location.reload();
      return;
    }
    apply(choice);
    try {
      window.dispatchEvent(new Event('madorbs:consent'));
    } catch (e) {
      /* old browsers: the game sees the choice on the next page */
    }
  }

  // ------------------------------------------------------------ the banner
  var root = null;
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function toggleRow(name, title, text, checked, locked) {
    var row = el('label', 'mc-row');
    var box = el('input');
    box.type = 'checkbox';
    box.name = name;
    box.checked = checked;
    box.disabled = !!locked;
    var info = el('span', 'mc-info');
    info.appendChild(el('b', '', title));
    info.appendChild(el('small', '', text));
    row.appendChild(info);
    var sw = el('span', 'mc-switch');
    sw.appendChild(box);
    sw.appendChild(el('i'));
    if (locked) row.title = T.always;
    row.appendChild(sw);
    return row;
  }

  function open(showDetails) {
    close();
    var current = read();
    root = el('div', 'mo-consent');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', T.title);
    var card = el('div', 'mc-card');
    var head = el('div', 'mc-head');
    head.appendChild(el('b', 'mc-title', T.title));
    card.appendChild(head);
    var p = el('p', 'mc-body', T.body + ' ');
    var link = el('a', '', T.privacy);
    link.href = T.privacyUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    p.appendChild(link);
    card.appendChild(p);

    var details = el('div', 'mc-details');
    details.hidden = !showDetails;
    details.appendChild(toggleRow('necessary', T.necessary, T.necessaryText, true, true));
    // Before any choice the switches start on; after one, they show it
    details.appendChild(toggleRow('analytics', T.analytics, T.analyticsText, current ? current.analytics : true));
    details.appendChild(toggleRow('ads', T.ads, T.adsText, current ? current.ads : true));
    card.appendChild(details);

    var buttons = el('div', 'mc-buttons');
    var customize = el('button', 'mc-btn ghost', T.customize);
    var save = el('button', 'mc-btn ghost', T.save);
    var reject = el('button', 'mc-btn', T.reject);
    var accept = el('button', 'mc-btn primary', T.accept);
    [customize, save, reject, accept].forEach(function (b) {
      b.type = 'button';
    });
    save.hidden = !showDetails;
    customize.hidden = !!showDetails;
    customize.onclick = function () {
      details.hidden = false;
      customize.hidden = true;
      save.hidden = false;
    };
    save.onclick = function () {
      choose({ analytics: details.querySelector('[name=analytics]').checked, ads: details.querySelector('[name=ads]').checked });
    };
    reject.onclick = function () {
      choose({ analytics: false, ads: false });
    };
    accept.onclick = function () {
      choose({ analytics: true, ads: true });
    };
    buttons.appendChild(customize);
    buttons.appendChild(save);
    buttons.appendChild(reject);
    buttons.appendChild(accept);
    card.appendChild(buttons);
    root.appendChild(card);
    document.body.appendChild(root);
  }
  function close() {
    if (root) root.remove();
    root = null;
  }

  var css =
    '.mo-consent{position:fixed;left:16px;bottom:16px;z-index:1000;max-width:440px;width:calc(100% - 32px);font:600 14px/1.45 "Nunito Variable","Segoe UI",system-ui,sans-serif;color:#eef2ff}' +
    '#start[hidden]~.mo-consent{display:none}' +
    '.mc-card{background:#141a38;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:16px 18px 14px;box-shadow:0 20px 60px rgba(0,0,0,.55)}' +
    '.mc-title{font:400 22px "Lilita One","Trebuchet MS",sans-serif;letter-spacing:.5px}' +
    '.mc-body{margin:6px 0 12px;color:#c4cbef}.mc-body a{color:#9fc4ff}' +
    '.mc-details{display:grid;gap:8px;margin-bottom:12px}.mc-details[hidden]{display:none}' +
    '.mc-row{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.05);cursor:pointer}' +
    '.mc-info{flex:1;display:flex;flex-direction:column}.mc-info small{color:#98a3c7;font-weight:600;font-size:12.5px}' +
    '.mc-switch{position:relative;width:40px;height:22px;flex:none}.mc-switch input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}' +
    '.mc-switch i{position:absolute;inset:0;border-radius:11px;background:#3a4170;transition:background .15s}' +
    '.mc-switch i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}' +
    '.mc-switch input:checked+i{background:#24b24e}.mc-switch input:checked+i::after{transform:translateX(18px)}' +
    '.mc-switch input:disabled+i{opacity:.6}.mc-switch input:focus-visible+i{outline:2px solid #7aa2ff;outline-offset:2px}' +
    '.mc-buttons{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.mc-buttons [hidden]{display:none}' +
    '.mc-btn{font-weight:800;font-size:14px;font-family:inherit;padding:9px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#232b57;color:#eef2ff;cursor:pointer}' +
    '.mc-btn:hover{background:#2e3870}.mc-btn.ghost{background:transparent;margin-right:auto}.mc-btn.ghost:hover{background:rgba(255,255,255,.07)}' +
    '.mc-btn.primary{background:linear-gradient(180deg,#5fe27d,#24b24e);border-color:#167a35;color:#08240f}.mc-btn.primary:hover{filter:brightness(1.07)}' +
    '@media (max-width:480px){.mo-consent{left:8px;bottom:8px;width:calc(100% - 16px)}.mc-btn{flex:1}.mc-btn.ghost{margin-right:0}}';

  function start() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    var choice = read();
    if (choice) apply(choice);
    else open(false);
  }

  window.madorbsConsent = {
    open: function () {
      open(true);
    },
    /** 'ads' or 'analytics': the visitor agreed to it. */
    allows: function (kind) {
      var c = read();
      return !!(c && c[kind]);
    },
  };
  // The "Cookies" links in the footers
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!a) return;
    e.preventDefault();
    open(true);
  });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
