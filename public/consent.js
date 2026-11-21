// Cookie banner of madorbs.com (the game page and the guide pages; plain script, no build): Google
// Analytics (statistics) and Google AdSense (ads). The Adsterra banners (src/client/ads.ts) are off since 30/10/2026.
// Two ways, by where the visitor is (the browser's time zone; unknown counts as Europe):
// - Europe (EU/EEA, UK, Switzerland): opt-in. Nothing runs before "Accept" (or that choice in "Customize").
// - Elsewhere (Brazil included): opt-out. Statistics and ads run from the start; the banner says so,
//   with "Refuse" and "Customize" at hand until a choice is made, and the footer's "Cookies" link after.
// The game asks window.madorbsConsent.allows('ads') and listens to the "madorbs:consent" event (a
// choice made without a reload). The choice is kept in
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
      body: 'Mad Orbs uses cookies only if you agree: for usage statistics (Google Analytics) and for ads (Google AdSense). The game works either way.',
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
      adsText: 'Google AdSense: ads that keep the game free, possibly based on your interests.',
      always: 'Always on',
      notice: 'Mad Orbs uses cookies for usage statistics (Google Analytics) and for ads (Google AdSense), which keep the game free. You can refuse them or choose which ones, now or later with the Cookies link at the bottom of the page.',
      acceptNotice: 'Got it',
    },
    pt: {
      title: 'Cookies',
      body: 'O Mad Orbs só usa cookies se você concordar: para estatísticas de uso (Google Analytics) e para anúncios (Google AdSense). O jogo funciona de qualquer jeito.',
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
      adsText: 'Google AdSense: anúncios que mantêm o jogo grátis, possivelmente com base nos seus interesses.',
      always: 'Sempre ligados',
      notice: 'O Mad Orbs usa cookies para estatísticas de uso (Google Analytics) e para anúncios (Google AdSense), que mantêm o jogo grátis. Você pode recusar ou escolher quais, agora ou depois pelo link Cookies no rodapé da página.',
      acceptNotice: 'Entendi',
    },
    es: {
      title: 'Cookies',
      body: 'Mad Orbs solo usa cookies si aceptas: para estadísticas de uso (Google Analytics) y para anuncios (Google AdSense). El juego funciona igual.',
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
      adsText: 'Google AdSense: anuncios que mantienen el juego gratis, posiblemente según tus intereses.',
      always: 'Siempre activas',
      notice: 'Mad Orbs usa cookies para estadísticas de uso (Google Analytics) y para anuncios (Google AdSense), que mantienen el juego gratis. Puedes rechazarlas o elegir cuáles, ahora o después con el enlace Cookies al pie de la página.',
      acceptNotice: 'Entendido',
    },
    // (the French page has no privacy page of its own: the English one)
    fr: {
      title: 'Cookies',
      body: "Mad Orbs n'utilise des cookies que si vous l'acceptez : pour les statistiques d'utilisation (Google Analytics) et pour la publicité (Google AdSense). Le jeu fonctionne dans tous les cas.",
      privacy: 'Politique de confidentialité',
      privacyUrl: '/privacy',
      accept: 'Accepter',
      reject: 'Refuser',
      customize: 'Personnaliser',
      save: 'Enregistrer mes choix',
      necessary: 'Nécessaires',
      necessaryText: 'Vos réglages, votre connexion et ce choix, gardés dans votre navigateur. Toujours actifs.',
      analytics: "Statistiques d'utilisation",
      analyticsText: 'Google Analytics : combien de personnes visitent le site et comment il est utilisé.',
      ads: 'Publicité',
      adsText: 'Google AdSense : des publicités qui gardent le jeu gratuit, éventuellement selon vos centres d\'intérêt.',
      always: 'Toujours actifs',
      notice: "Mad Orbs utilise des cookies pour les statistiques d'utilisation (Google Analytics) et pour la publicité (Google AdSense), qui gardent le jeu gratuit. Vous pouvez les refuser ou choisir lesquels, maintenant ou plus tard avec le lien Cookies en bas de la page.",
      acceptNotice: "J'ai compris",
    },
    // (the German page has no privacy page of its own: the English one)
    de: {
      title: 'Cookies',
      body: 'Mad Orbs verwendet Cookies nur mit deiner Zustimmung: für Nutzungsstatistiken (Google Analytics) und für Werbung (Google AdSense). Das Spiel funktioniert so oder so.',
      privacy: 'Datenschutzerklärung',
      privacyUrl: '/privacy',
      accept: 'Akzeptieren',
      reject: 'Ablehnen',
      customize: 'Anpassen',
      save: 'Auswahl speichern',
      necessary: 'Notwendig',
      necessaryText: 'Deine Einstellungen, deine Anmeldung und diese Auswahl, in deinem Browser gespeichert. Immer aktiv.',
      analytics: 'Nutzungsstatistiken',
      analyticsText: 'Google Analytics: wie viele Leute die Seite besuchen und wie sie genutzt wird.',
      ads: 'Werbung',
      adsText: 'Google AdSense: Werbung, die das Spiel kostenlos hält, möglicherweise nach deinen Interessen.',
      always: 'Immer aktiv',
      notice: 'Mad Orbs verwendet Cookies für Nutzungsstatistiken (Google Analytics) und für Werbung (Google AdSense), die das Spiel kostenlos hält. Du kannst sie ablehnen oder auswählen, jetzt oder später über den Link Cookies unten auf der Seite.',
      acceptNotice: 'Verstanden',
    },
    // (the Italian page has no privacy page of its own: the English one)
    it: {
      title: 'Cookie',
      body: "Mad Orbs usa i cookie solo se sei d'accordo: per le statistiche di utilizzo (Google Analytics) e per la pubblicità (Google AdSense). Il gioco funziona comunque.",
      privacy: 'Informativa sulla privacy',
      privacyUrl: '/privacy',
      accept: 'Accetta',
      reject: 'Rifiuta',
      customize: 'Personalizza',
      save: 'Salva le scelte',
      necessary: 'Necessari',
      necessaryText: 'Le tue impostazioni, il tuo accesso e questa scelta, salvati nel tuo browser. Sempre attivi.',
      analytics: 'Statistiche di utilizzo',
      analyticsText: 'Google Analytics: quante persone visitano il sito e come viene usato.',
      ads: 'Pubblicità',
      adsText: 'Google AdSense: pubblicità che mantiene il gioco gratuito, forse in base ai tuoi interessi.',
      always: 'Sempre attivi',
      notice: 'Mad Orbs usa i cookie per le statistiche di utilizzo (Google Analytics) e per la pubblicità (Google AdSense), che mantiene il gioco gratuito. Puoi rifiutarli o scegliere quali, ora o più tardi con il link Cookie in fondo alla pagina.',
      acceptNotice: 'Ho capito',
    },
    pl: {
      title: "Pliki cookie",
      body: "Mad Orbs używa plików cookie tylko za Twoją zgodą: do statystyk użytkowania (Google Analytics) i do reklam (Google AdSense). Gra działa tak czy inaczej.",
      privacy: "Polityka prywatności",
      privacyUrl: "/privacy",
      accept: "Akceptuj",
      reject: "Odrzuć",
      customize: "Dostosuj",
      save: "Zapisz wybór",
      necessary: "Niezbędne",
      necessaryText: "Twoje ustawienia, logowanie i ten wybór, zapisane w przeglądarce. Zawsze aktywne.",
      analytics: "Statystyki użytkowania",
      analyticsText: "Google Analytics: ile osób odwiedza stronę i jak z niej korzysta.",
      ads: "Reklamy",
      adsText: "Google AdSense: reklamy, dzięki którym gra jest darmowa, być może dopasowane do Twoich zainteresowań.",
      always: "Zawsze aktywne",
      notice: "Mad Orbs używa plików cookie do statystyk użytkowania (Google Analytics) i do reklam (Google AdSense), dzięki którym gra jest darmowa. Możesz je odrzucić lub wybrać, które zostawić, teraz lub później przez link Pliki cookie na dole strony.",
      acceptNotice: "Rozumiem",
    },
    tr: {
      title: "Çerezler",
      body: "Mad Orbs çerezleri yalnızca izin verirsen kullanır: kullanım istatistikleri (Google Analytics) ve reklamlar (Google AdSense) için. Oyun her durumda çalışır.",
      privacy: "Gizlilik politikası",
      privacyUrl: "/privacy",
      accept: "Kabul et",
      reject: "Reddet",
      customize: "Özelleştir",
      save: "Seçimleri kaydet",
      necessary: "Gerekli",
      necessaryText: "Ayarların, oturumun ve bu seçim, tarayıcında saklanır. Her zaman açık.",
      analytics: "Kullanım istatistikleri",
      analyticsText: "Google Analytics: siteyi kaç kişinin ziyaret ettiği ve nasıl kullanıldığı.",
      ads: "Reklamlar",
      adsText: "Google AdSense: oyunu ücretsiz tutan reklamlar, ilgi alanlarına göre olabilir.",
      always: "Her zaman açık",
      notice: "Mad Orbs kullanım istatistikleri (Google Analytics) ve oyunu ücretsiz tutan reklamlar (Google AdSense) için çerez kullanır. Bunları şimdi ya da daha sonra sayfanın altındaki Çerezler bağlantısından reddedebilir veya seçebilirsin.",
      acceptNotice: "Anladım",
    },
    ru: {
      title: "Файлы cookie",
      body: "Mad Orbs использует файлы cookie только с вашего согласия: для статистики использования (Google Analytics) и для рекламы (Google AdSense). Игра работает в любом случае.",
      privacy: "Политика конфиденциальности",
      privacyUrl: "/privacy",
      accept: "Принять",
      reject: "Отклонить",
      customize: "Настроить",
      save: "Сохранить выбор",
      necessary: "Необходимые",
      necessaryText: "Ваши настройки, вход в аккаунт и этот выбор хранятся в браузере. Всегда включены.",
      analytics: "Статистика использования",
      analyticsText: "Google Analytics: сколько людей заходит на сайт и как его используют.",
      ads: "Реклама",
      adsText: "Google AdSense: реклама, благодаря которой игра бесплатна, возможно с учётом ваших интересов.",
      always: "Всегда включены",
      notice: "Mad Orbs использует файлы cookie для статистики использования (Google Analytics) и для рекламы (Google AdSense), благодаря которой игра бесплатна. Вы можете отказаться от них или выбрать нужные сейчас или позже по ссылке «Файлы cookie» внизу страницы.",
      acceptNotice: "Понятно",
    },
    uk: {
      title: "Файли cookie",
      body: "Mad Orbs використовує файли cookie лише за вашою згодою: для статистики використання (Google Analytics) і для реклами (Google AdSense). Гра працює в будь-якому разі.",
      privacy: "Політика конфіденційності",
      privacyUrl: "/privacy",
      accept: "Прийняти",
      reject: "Відхилити",
      customize: "Налаштувати",
      save: "Зберегти вибір",
      necessary: "Необхідні",
      necessaryText: "Ваші налаштування, вхід і цей вибір зберігаються у браузері. Завжди увімкнені.",
      analytics: "Статистика використання",
      analyticsText: "Google Analytics: скільки людей відвідує сайт і як ним користуються.",
      ads: "Реклама",
      adsText: "Google AdSense: реклама, завдяки якій гра безкоштовна, можливо з урахуванням ваших інтересів.",
      always: "Завжди увімкнені",
      notice: "Mad Orbs використовує файли cookie для статистики використання (Google Analytics) і для реклами (Google AdSense), завдяки якій гра безкоштовна. Ви можете відмовитися від них або вибрати потрібні зараз чи пізніше за посиланням «Файли cookie» внизу сторінки.",
      acceptNotice: "Зрозуміло",
    },
    ja: {
      title: "Cookie",
      body: "Mad Orbs は同意をいただいた場合のみ Cookie を使用します：利用統計（Google Analytics）と広告（Google AdSense）のためです。どちらでもゲームは遊べます。",
      privacy: "プライバシーポリシー",
      privacyUrl: "/privacy",
      accept: "同意する",
      reject: "拒否する",
      customize: "カスタマイズ",
      save: "選択を保存",
      necessary: "必須",
      necessaryText: "設定、ログイン、この選択はブラウザーに保存されます。常に有効です。",
      analytics: "利用統計",
      analyticsText: "Google Analytics：サイトの訪問者数と使われ方。",
      ads: "広告",
      adsText: "Google AdSense：ゲームを無料に保つ広告。興味関心に基づく場合があります。",
      always: "常に有効",
      notice: "Mad Orbs は利用統計（Google Analytics）と、ゲームを無料に保つ広告（Google AdSense）のために Cookie を使用します。今すぐ、またはページ下部の「Cookie」リンクからいつでも拒否・選択できます。",
      acceptNotice: "わかりました",
    },
    ko: {
      title: "쿠키",
      body: "Mad Orbs는 동의한 경우에만 쿠키를 사용합니다: 이용 통계(Google Analytics)와 광고(Google AdSense)를 위해서입니다. 어느 쪽이든 게임은 작동합니다.",
      privacy: "개인정보 처리방침",
      privacyUrl: "/privacy",
      accept: "동의",
      reject: "거부",
      customize: "설정",
      save: "선택 저장",
      necessary: "필수",
      necessaryText: "설정, 로그인, 이 선택은 브라우저에 저장됩니다. 항상 켜져 있습니다.",
      analytics: "이용 통계",
      analyticsText: "Google Analytics: 방문자 수와 사이트 이용 방식.",
      ads: "광고",
      adsText: "Google AdSense: 게임을 무료로 유지하는 광고, 관심사에 따라 표시될 수 있습니다.",
      always: "항상 켜짐",
      notice: "Mad Orbs는 이용 통계(Google Analytics)와 게임을 무료로 유지하는 광고(Google AdSense)를 위해 쿠키를 사용합니다. 지금 또는 나중에 페이지 하단의 쿠키 링크에서 거부하거나 선택할 수 있습니다.",
      acceptNotice: "확인",
    },
    zh: {
      title: "Cookie",
      body: "Mad Orbs 仅在你同意后使用 Cookie：用于使用统计（Google Analytics）和广告（Google AdSense）。无论如何游戏都能正常运行。",
      privacy: "隐私政策",
      privacyUrl: "/privacy",
      accept: "接受",
      reject: "拒绝",
      customize: "自定义",
      save: "保存选择",
      necessary: "必要",
      necessaryText: "你的设置、登录和此选择保存在浏览器中。始终开启。",
      analytics: "使用统计",
      analyticsText: "Google Analytics：有多少人访问网站以及如何使用。",
      ads: "广告",
      adsText: "Google AdSense：让游戏保持免费的广告，可能根据你的兴趣展示。",
      always: "始终开启",
      notice: "Mad Orbs 使用 Cookie 进行使用统计（Google Analytics）和展示让游戏保持免费的广告（Google AdSense）。你可以现在或稍后通过页面底部的 Cookie 链接拒绝或选择。",
      acceptNotice: "知道了",
    },
    'zh-tw': {
      title: "Cookie",
      body: "Mad Orbs 只在你同意後使用 Cookie：用於使用統計（Google Analytics）與廣告（Google AdSense）。無論如何遊戲都能正常運作。",
      privacy: "隱私權政策",
      privacyUrl: "/privacy",
      accept: "接受",
      reject: "拒絕",
      customize: "自訂",
      save: "儲存選擇",
      necessary: "必要",
      necessaryText: "你的設定、登入與此選擇會儲存在瀏覽器中。一律開啟。",
      analytics: "使用統計",
      analyticsText: "Google Analytics：有多少人造訪網站以及如何使用。",
      ads: "廣告",
      adsText: "Google AdSense：讓遊戲維持免費的廣告，可能依你的興趣顯示。",
      always: "一律開啟",
      notice: "Mad Orbs 使用 Cookie 進行使用統計（Google Analytics）與顯示讓遊戲維持免費的廣告（Google AdSense）。你可以現在或稍後透過頁面底部的 Cookie 連結拒絕或選擇。",
      acceptNotice: "我知道了",
    },
    'pt-pt': {
      title: "Cookies",
      body: "O Mad Orbs só usa cookies se concordares: para estatísticas de utilização (Google Analytics) e para publicidade (Google AdSense). O jogo funciona de qualquer forma.",
      privacy: "Política de privacidade",
      privacyUrl: "/pt/privacidade",
      accept: "Aceitar",
      reject: "Recusar",
      customize: "Personalizar",
      save: "Guardar escolhas",
      necessary: "Necessários",
      necessaryText: "As tuas definições, a tua sessão e esta escolha, guardadas no teu navegador. Sempre ativos.",
      analytics: "Estatísticas de utilização",
      analyticsText: "Google Analytics: quantas pessoas visitam e como o site é utilizado.",
      ads: "Publicidade",
      adsText: "Google AdSense: publicidade que mantém o jogo gratuito, possivelmente com base nos teus interesses.",
      always: "Sempre ativos",
      notice: "O Mad Orbs usa cookies para estatísticas de utilização (Google Analytics) e para publicidade (Google AdSense), que mantém o jogo gratuito. Podes recusar ou escolher quais, agora ou mais tarde na ligação Cookies no fundo da página.",
      acceptNotice: "Entendi",
    },
  };
  // (Spain's Spanish: the Latin American texts)
  TEXTS['es-es'] = TEXTS.es;
  // The language of the address (/pt/..., /es/..., /fr/..., /de/..., /it/..., English elsewhere), like src/i18n langOfPath
  var pathLang = /^\/([a-z]{2}(?:-[a-z]{2})?)(\/|$)/.exec(location.pathname);
  var T = (pathLang && TEXTS[pathLang[1]]) || TEXTS.en;

  // ------------------------------------------------------------ where: opt-in in Europe only
  /** Time zones of the EU/EEA, the UK and Switzerland outside "Europe/..." (islands, Ceuta). */
  var EUROPE_EXTRA = /^(Atlantic\/(Azores|Madeira|Canary|Faroe|Reykjavik)|Africa\/Ceuta|Arctic\/Longyearbyen)$/;
  function inEurope() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      return !zone || /^Europe\//.test(zone) || EUROPE_EXTRA.test(zone);
    } catch (e) {
      return true;
    }
  }
  /** Opt-out here: statistics and ads are on until refused. */
  var OPT_OUT = !inEurope();
  if (OPT_OUT) {
    T.body = T.notice;
    T.accept = T.acceptNotice;
  }
  /** What is on now: the choice made, or (no choice yet) everything outside Europe, nothing in it. */
  function current() {
    return read() || { analytics: OPT_OUT, ads: OPT_OUT, implied: true };
  }

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
  /** A person on madorbs.com itself: not an automated browser, not framed by another site. */
  function realVisit() {
    if (!/(^|\.)madorbs\.com$/.test(location.hostname) || navigator.webdriver) return false;
    try {
      return window.top === window.self || window.top.location.hostname === location.hostname;
    } catch (e) {
      return false;
    }
  }
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
    // Google's ad script only on the real site, opened by a person: never on localhost or in the test browsers
    // (automated, navigator.webdriver: hundreds of headless runs loaded it with our publisher ID until 30/10/2026)
    // nor inside another site's frame
    if (choice.ads && !loaded.ads && realVisit()) {
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
    write(choice);
    close();
    if ((loaded.analytics && !choice.analytics) || (loaded.ads && !choice.ads)) {
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
    var chosen = read();
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
    details.appendChild(toggleRow('analytics', T.analytics, T.analyticsText, chosen ? chosen.analytics : true));
    details.appendChild(toggleRow('ads', T.ads, T.adsText, chosen ? chosen.ads : true));
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
    // No choice yet: outside Europe everything runs now and the banner tells it; in Europe it asks first
    apply(current());
    if (!choice) open(false);
  }

  window.madorbsConsent = {
    open: function () {
      open(true);
    },
    /** 'ads' or 'analytics': the visitor agreed to it. */
    allows: function (kind) {
      return !!current()[kind];
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
