/* Interfejs: dziennik dnia, dodawanie i korekta posiłku, ustawienia. */
(function () {
  'use strict';
  const TF = window.TF;
  const { calc, ai, db, settings, pin } = TF;

  const APP_VERSION = '3';

  const $app = document.getElementById('app');
  const $camera = document.getElementById('pick-camera');
  const $gallery = document.getElementById('pick-gallery');

  const state = {
    day: today(),
    draft: null, // posiłek w trakcie dodawania lub edycji
    unlocked: false, // czy PIN do ustawień został już podany
    depth: 0, // ile ekranów w głąb aplikacji jesteśmy (dla przycisku Wróć)
  };

  /* ---------- Narzędzia ---------- */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const ICONS = {
    camera:
      '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1-1.6A1.5 1.5 0 0 1 10.1 3.7h3.8a1.5 1.5 0 0 1 1.3.7l1 1.6h1.3A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.3" r="3.4"/>',
    image:
      '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.6-4.2a1.5 1.5 0 0 1 2 0l2.4 2.2 1.6-1.4a1.5 1.5 0 0 1 2 0l2.4 2.2"/>',
    gear:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    next: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    trash:
      '<path d="M5 7h14M10 7V5.2A1.2 1.2 0 0 1 11.2 4h1.6A1.2 1.2 0 0 1 14 5.2V7M7 7l.8 11a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L17 7"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  };

  function icon(name) {
    return h('span', {
      class: 'icon',
      'aria-hidden': 'true',
      html:
        '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        ICONS[name] +
        '</svg>',
    });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function dayStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function today() {
    return dayStr(new Date());
  }
  function parseDay(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }
  function addDays(s, n) {
    const d = parseDay(s);
    d.setDate(d.getDate() + n);
    return dayStr(d);
  }
  function weekOf(s) {
    const mondayOffset = (parseDay(s).getDay() + 6) % 7;
    const monday = addDays(s, -mondayOffset);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }

  const fmtLong = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' });
  const fmtTime = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const WEEKDAYS = ['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'];

  function dayTitle(day) {
    const date = parseDay(day);
    if (day === today()) return 'Dziś, ' + fmtShort.format(date);
    if (day === addDays(today(), -1)) return 'Wczoraj, ' + fmtShort.format(date);
    const text = fmtLong.format(date);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  const fmtInt = (n) => Math.round(n).toLocaleString('pl-PL');
  const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('pl-PL', { maximumFractionDigits: 1 });

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- Nawigacja ---------- */

  function go(path, replace) {
    const target = '#/' + path;
    if (location.hash === target) return route();
    if (replace) {
      location.replace(target);
    } else {
      state.depth++;
      location.hash = target;
    }
  }

  /** Wraca do poprzedniego ekranu, a jeśli go nie ma, do dziennika. */
  function leave() {
    if (state.depth > 0) {
      state.depth--;
      history.back();
    } else {
      go('', true);
    }
  }

  let routeToken = 0;
  let closeOpenDialog = null;

  function mount(view, keepScroll) {
    const y = window.scrollY;
    $app.replaceChildren(view);
    window.scrollTo(0, keepScroll ? y : 0);
  }

  async function route() {
    const token = ++routeToken;
    if (closeOpenDialog) closeOpenDialog(null);
    const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');

    if (name === 'nowy') {
      if (!state.draft || !state.draft.isNew) return go('', true);
      return mount(viewEditor());
    }
    if (name === 'posilek' && arg) {
      if (!state.draft || state.draft.id !== arg) {
        const meal = await db.get(arg);
        if (token !== routeToken) return;
        if (!meal) return go('', true);
        state.draft = draftFromMeal(meal);
      }
      return mount(viewEditor());
    }
    if (name === 'ustawienia') {
      if (pin.isSet() && !state.unlocked) {
        let answer = await pinDialog();
        if (token !== routeToken) return;
        if (answer === 'forgot') {
          answer = await confirmDialog({
            title: 'Usunąć PIN i klucze API?',
            text: 'Bez PIN-u nie da się podejrzeć zapisanych kluczy. Możesz usunąć PIN razem z kluczami i wpisać klucze od nowa. Posiłki zostaną.',
            yes: 'Usuń PIN i klucze',
            danger: true,
          });
          if (token !== routeToken) return;
          if (answer) {
            settings.save({ ...settings.load(), pinHash: '', pinSalt: '', geminiKey: '', openaiKey: '' });
            toast('Usunięto PIN i klucze');
          }
        }
        if (!answer) return leave();
        state.unlocked = true;
      }
      return mount(viewSettings());
    }

    state.draft = null;
    state.unlocked = false;
    state.depth = 0;
    const view = await viewDay();
    if (token !== routeToken) return;
    mount(view);
  }

  /* ---------- Komunikaty i okna ---------- */

  let toastTimer = null;
  function toast(message) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = h('div', { class: 'toast', role: 'status' }, message);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2800);
  }

  function openDialog(build) {
    return new Promise((resolve) => {
      const dlg = h('dialog', { class: 'dialog' });
      const close = (value) => {
        if (closeOpenDialog === close) closeOpenDialog = null;
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(value);
      };
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        close(null);
      });
      build(dlg, close);
      document.body.append(dlg);
      closeOpenDialog = close;
      dlg.showModal();
    });
  }

  function confirmDialog({ title, text, yes, danger }) {
    return openDialog((dlg, close) => {
      dlg.append(
        h('h2', { class: 'dialog__title' }, title),
        text ? h('p', { class: 'dialog__text' }, text) : null,
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close(false) }, 'Anuluj'),
          h('button', { class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'), type: 'button', onclick: () => close(true) }, yes)
        )
      );
    }).then(Boolean);
  }

  /** Pyta o PIN do ustawień. Zwraca true, false albo 'forgot', gdy użytkownik nie pamięta PIN-u. */
  function pinDialog() {
    return openDialog((dlg, close) => {
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const input = h('input', {
        class: 'field',
        type: 'password',
        inputmode: 'numeric',
        autocomplete: 'off',
        id: 'pin-input',
        'aria-describedby': 'pin-error',
      });
      error.id = 'pin-error';
      const form = h(
        'form',
        {
          onsubmit: (e) => {
            e.preventDefault();
            if (pin.check(input.value)) return close(true);
            error.hidden = false;
            error.textContent = 'Nieprawidłowy PIN. Spróbuj jeszcze raz.';
            input.value = '';
            input.focus();
          },
        },
        h('h2', { class: 'dialog__title' }, 'Podaj PIN do ustawień'),
        h('label', { class: 'label', for: 'pin-input' }, 'PIN'),
        input,
        error,
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close(false) }, 'Anuluj'),
          h('button', { class: 'btn btn--primary', type: 'submit' }, 'Odblokuj')
        ),
        h(
          'button',
          {
            class: 'link-btn',
            type: 'button',
            onclick: () => close('forgot'),
          },
          'Nie pamiętam PIN-u'
        )
      );
      dlg.append(form);
    });
  }

  /* ---------- Wspólne elementy ---------- */

  const MACROS = [
    { key: 'p', name: 'Białko', short: 'B' },
    { key: 'f', name: 'Tłuszcze', short: 'T' },
    { key: 'c', name: 'Węglowodany', short: 'W' },
  ];

  /** Pasek pokazujący, jaka część kalorii pochodzi z białka, tłuszczów i węglowodanów. */
  function macroBar(t) {
    const shares = calc.kcalShares(t);
    const empty = !(shares.p + shares.f + shares.c > 0);
    const label = empty
      ? 'Brak danych o makroskładnikach'
      : MACROS.map((m) => `${m.name} ${Math.round(shares[m.key] * 100)}% kalorii`).join(', ');
    return h(
      'div',
      { class: 'bar' + (empty ? ' bar--empty' : ''), role: 'img', 'aria-label': label },
      empty
        ? null
        : MACROS.filter((m) => shares[m.key] > 0).map((m) =>
            h('span', { class: 'bar__seg bar__seg--' + m.key, style: `flex-grow:${shares[m.key].toFixed(4)}` })
          )
    );
  }

  /** Legenda z gramami: Białko 96 g, Tłuszcze 61 g, Węglowodany 210 g. */
  function macroLegend(t) {
    return h(
      'dl',
      { class: 'legend' },
      MACROS.map((m) =>
        h(
          'div',
          { class: 'legend__item' },
          h('dt', {}, h('span', { class: 'dot dot--' + m.key }), m.name),
          h('dd', {}, fmtInt(t[m.key]) + ' g')
        )
      )
    );
  }

  /** Zwięzłe makro w jednej linii: B 14 g, T 9 g, W 68 g. */
  function macroInline(t, whole) {
    return h(
      'span',
      { class: 'macros' },
      MACROS.map((m) =>
        h(
          'span',
          { class: 'macros__item' },
          h('span', { class: 'dot dot--' + m.key }),
          h('abbr', { title: m.name }, m.short),
          ' ' + (whole ? fmtInt(t[m.key]) : fmt1(t[m.key])) + ' g'
        )
      )
    );
  }

  function topBar({ title, right }) {
    return h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Wróć', onclick: leave }, icon('back')),
      h('h1', { class: 'topbar__title' }, title),
      right || h('span', { class: 'icon-btn icon-btn--spacer' })
    );
  }

  /* ---------- Ekran: dziennik dnia ---------- */

  async function viewDay() {
    const day = state.day;
    const week = weekOf(day);
    const [meals, weekMeals] = await Promise.all([db.byDay(day), db.range(week[0], week[6])]);
    const totals = calc.dayTotals(meals);

    const kcalByDay = {};
    for (const d of week) kcalByDay[d] = 0;
    for (const m of weekMeals) kcalByDay[m.day] = (kcalByDay[m.day] || 0) + calc.mealTotals(m).kcal;
    const maxKcal = Math.max(1, ...Object.values(kcalByDay));

    const setDay = (d) => {
      state.day = d;
      route();
    };

    const weekStrip = h(
      'nav',
      { class: 'week', 'aria-label': 'Wybór dnia' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Poprzedni tydzień', onclick: () => setDay(addDays(day, -7)) }, icon('back')),
      h(
        'ol',
        { class: 'week__days' },
        week.map((d, i) => {
          const kcal = kcalByDay[d];
          const height = kcal > 0 ? Math.max(10, Math.round((kcal / maxKcal) * 100)) : 0;
          return h(
            'li',
            {},
            h(
              'button',
              {
                class: 'week__day' + (d === day ? ' is-selected' : '') + (d === today() ? ' is-today' : ''),
                type: 'button',
                'aria-pressed': d === day ? 'true' : 'false',
                'aria-label': `${fmtLong.format(parseDay(d))}, ${fmtInt(kcal)} kcal`,
                onclick: () => setDay(d),
              },
              h('span', { class: 'week__col' }, h('span', { class: 'week__fill', style: `height:${height}%` })),
              h('span', { class: 'week__name' }, WEEKDAYS[i]),
              h('span', { class: 'week__num' }, parseDay(d).getDate())
            )
          );
        })
      ),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Następny tydzień', onclick: () => setDay(addDays(day, 7)) }, icon('next'))
    );

    const summary = h(
      'section',
      { class: 'summary', 'aria-label': 'Suma dnia' },
      h('p', { class: 'summary__kcal' }, h('strong', {}, fmtInt(totals.kcal)), ' kcal'),
      macroBar(totals),
      macroLegend(totals)
    );

    const list = meals.length
      ? h(
          'ul',
          { class: 'meals' },
          meals.map((m) => {
            const t = calc.mealTotals(m);
            return h(
              'li',
              {},
              h(
                'a',
                { class: 'meal', href: '#/posilek/' + m.id, onclick: () => state.depth++ },
                m.thumb ? h('img', { class: 'meal__photo', src: m.thumb, alt: '' }) : h('span', { class: 'meal__photo' }),
                h(
                  'span',
                  { class: 'meal__body' },
                  h('span', { class: 'meal__name' }, m.name),
                  macroInline(t, true)
                ),
                h(
                  'span',
                  { class: 'meal__side' },
                  h('span', { class: 'meal__kcal' }, fmtInt(t.kcal) + ' kcal'),
                  h('time', { class: 'meal__time' }, fmtTime.format(new Date(m.ts)))
                )
              )
            );
          })
        )
      : h(
          'p',
          { class: 'empty' },
          day === today()
            ? 'Nie ma jeszcze posiłków z dzisiaj. Zrób zdjęcie tego, co jesz, a aplikacja policzy makro i kalorie.'
            : 'Tego dnia nie zapisano żadnego posiłku. Możesz dodać go teraz ze zdjęcia z galerii.'
        );

    const noKey = !settings.active().apiKey
      ? h(
          'p',
          { class: 'notice' },
          'Do analizy zdjęć potrzebny jest klucz API. ',
          h('a', { href: '#/ustawienia', onclick: () => state.depth++ }, 'Dodaj klucz w ustawieniach')
        )
      : null;

    return h(
      'main',
      { class: 'screen screen--day' },
      h(
        'header',
        { class: 'brand' },
        h('span', { class: 'brand__name' }, 'Tom Food'),
        h('a', { class: 'icon-btn', href: '#/ustawienia', 'aria-label': 'Ustawienia', onclick: () => state.depth++ }, icon('gear'))
      ),
      h(
        'div',
        { class: 'day-head' },
        h('h1', { class: 'day-head__title' }, dayTitle(day)),
        day !== today()
          ? h('button', { class: 'link-btn', type: 'button', onclick: () => setDay(today()) }, 'Wróć do dziś')
          : null
      ),
      weekStrip,
      summary,
      noKey,
      h('h2', { class: 'section-title' }, 'Posiłki'),
      list,
      h(
        'div',
        { class: 'dock' },
        h(
          'div',
          { class: 'dock__inner' },
          h('button', { class: 'btn btn--primary btn--grow', type: 'button', onclick: () => $camera.click() }, icon('camera'), 'Zrób zdjęcie'),
          h('button', { class: 'btn btn--outline', type: 'button', onclick: () => $gallery.click() }, icon('image'), 'Z galerii')
        )
      )
    );
  }

  /* ---------- Zdjęcie ---------- */

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image'));
      };
      img.src = url;
    });
  }

  function toJpeg(img, maxEdge, quality) {
    const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const ht = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = ht;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, ht);
    ctx.drawImage(img, 0, 0, w, ht);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function onPick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { img, url } = await loadImage(file);
      const full = toJpeg(img, 1024, 0.8); // do modelu
      const thumb = toJpeg(img, 480, 0.72); // do dziennika
      URL.revokeObjectURL(url);
      const day = state.day;
      state.draft = {
        isNew: true,
        id: null,
        day,
        ts: day === today() ? Date.now() : parseDay(day).getTime(),
        full,
        thumb,
        weight: '',
        name: '',
        titleByUser: false,
        items: [],
        note: '',
        info: '',
        analyzed: false,
        busy: false,
        error: null,
      };
      go('nowy');
    } catch (err) {
      toast('Nie udało się otworzyć tego zdjęcia. Wybierz inne.');
    }
  }

  /* ---------- Ekran: nowy posiłek i korekta ---------- */

  function draftFromMeal(meal) {
    return {
      isNew: false,
      id: meal.id,
      day: meal.day,
      ts: meal.ts,
      full: null,
      thumb: meal.thumb || '',
      weight: '',
      name: meal.name,
      items: meal.items.map((it) => ({ ...it })),
      note: meal.note || '',
      analyzed: true,
      busy: false,
      error: null,
    };
  }

  function viewEditor() {
    const d = state.draft;
    const onScreen = () => state.draft === d && /^#\/(nowy|posilek)/.test(location.hash);
    const rerender = () => {
      if (onScreen()) mount(viewEditor(), true);
    };

    /* Suma posiłku: odświeżana przy każdej zmianie w polach. */
    const totalKcal = h('strong', {});
    const totalMacros = h('div', { class: 'totals__macros' });
    const totalBar = h('div', { class: 'totals__bar' });
    function paintTotals() {
      const t = calc.mealTotals(d);
      totalKcal.textContent = fmtInt(t.kcal);
      totalMacros.replaceChildren(macroInline(t, true));
      totalBar.replaceChildren(macroBar(t));
    }

    async function analyze() {
      if (d.busy) return;
      const cfg = settings.active();
      d.error = null;
      if (!cfg.apiKey) {
        d.error = new ai.AiError('Brakuje klucza API. Dodaj go w ustawieniach.', { code: 'no_key' });
        return rerender();
      }
      d.busy = true;
      d.busySince = Date.now();
      rerender();
      try {
        const known = settings.load()[cfg.provider + 'Models'];
        const r = await ai.analyzePhoto({
          ...cfg,
          dataUrl: d.full,
          weightGrams: d.weight,
          title: d.titleByUser ? d.name : '',
          fallbackModels: ai.fallbackModels(cfg.provider, cfg.model, known),
        });
        d.name = r.name;
        d.items = r.items;
        d.note = r.note;
        d.info = r.modelUsed && r.modelUsed !== cfg.model ? `Model ${cfg.model} nie odpowiedział, analizę wykonał ${r.modelUsed}.` : '';
        d.analyzed = true;
      } catch (err) {
        d.error =
          err instanceof ai.AiError
            ? err
            : new ai.AiError('Analiza się nie powiodła. Spróbuj ponownie.', { detail: String((err && err.message) || '') });
      } finally {
        d.busy = false;
        rerender();
        const result = !d.error && onScreen() && document.querySelector('.result');
        if (result) result.scrollIntoView({ block: 'start' });
      }
    }

    async function save() {
      const items = d.items
        .map((it) => ({
          name: String(it.name || '').trim(),
          grams: Math.round(calc.num(it.grams)),
          p100: calc.num(it.p100),
          f100: calc.num(it.f100),
          c100: calc.num(it.c100),
        }))
        .filter((it) => it.name && it.grams > 0);
      if (!items.length) {
        toast('Dodaj przynajmniej jeden składnik z nazwą i gramaturą');
        return;
      }
      const meal = {
        id: d.id || newId(),
        day: d.day,
        ts: d.ts,
        name: String(d.name || '').trim() || 'Posiłek',
        items,
        thumb: d.thumb,
        note: d.note,
      };
      try {
        await db.save(meal);
      } catch (err) {
        toast('Nie udało się zapisać posiłku. Zwolnij miejsce w telefonie i spróbuj ponownie.');
        return;
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      state.day = meal.day;
      toast('Zapisano posiłek');
      leave();
    }

    async function removeMeal() {
      const sure = await confirmDialog({
        title: 'Usunąć ten posiłek?',
        text: 'Zniknie z dziennika i z sumy dnia. Tej operacji nie da się cofnąć.',
        yes: 'Usuń posiłek',
        danger: true,
      });
      if (!sure) return;
      await db.remove(d.id);
      toast('Usunięto posiłek');
      leave();
    }

    function itemRow(it) {
      const out = h('div', { class: 'item__out' });
      const paint = () => {
        const t = calc.itemTotals(it);
        out.replaceChildren(h('strong', {}, fmtInt(t.kcal) + ' kcal'), macroInline(t));
      };
      const changed = () => {
        paint();
        paintTotals();
      };
      const per100 = (key, label) =>
        h(
          'label',
          { class: 'mini' },
          h('span', { class: 'mini__label' }, label),
          h('input', {
            class: 'field field--num',
            type: 'text',
            inputmode: 'decimal',
            value: it[key] === '' || it[key] == null ? '' : String(it[key]).replace('.', ','),
            oninput: (e) => {
              it[key] = e.target.value;
              changed();
            },
          })
        );
      paint();
      return h(
        'li',
        { class: 'item' },
        h(
          'div',
          { class: 'item__main' },
          h('input', {
            class: 'field item__name',
            type: 'text',
            value: it.name,
            placeholder: 'Nazwa składnika',
            'aria-label': 'Nazwa składnika',
            oninput: (e) => {
              it.name = e.target.value;
            },
          }),
          h(
            'label',
            { class: 'item__grams' },
            h('input', {
              class: 'field field--num',
              type: 'text',
              inputmode: 'numeric',
              value: it.grams === '' || it.grams == null ? '' : String(it.grams),
              'aria-label': 'Gramatura w gramach',
              oninput: (e) => {
                it.grams = e.target.value;
                changed();
              },
            }),
            h('span', { class: 'unit' }, 'g')
          ),
          h(
            'button',
            {
              class: 'icon-btn icon-btn--small',
              type: 'button',
              'aria-label': 'Usuń składnik ' + (it.name || ''),
              onclick: () => {
                d.items = d.items.filter((x) => x !== it);
                rerender();
              },
            },
            icon('close')
          )
        ),
        out,
        h(
          'details',
          { class: 'item__more', open: it.isManual ? true : null },
          h('summary', {}, 'Wartości na 100 g'),
          h('div', { class: 'item__per100' }, per100('p100', 'Białko'), per100('f100', 'Tłuszcze'), per100('c100', 'Węglowodany'))
        )
      );
    }

    /* Panel analizy: tylko dla nowego zdjęcia. */
    let analysis = null;
    if (d.full) {
      const errorBox = d.error
        ? h(
            'div',
            { class: 'form-error', role: 'alert' },
            h('p', {}, d.error.message),
            d.error.detail ? h('p', { class: 'form-error__detail' }, d.error.detail) : null,
            /^(no_key|network|http_401|http_403|http_404|http_429|http_5\d\d)$/.test(d.error.code)
              ? h('a', { href: '#/ustawienia', onclick: () => state.depth++ }, 'Otwórz ustawienia')
              : null
          )
        : null;
      const engine = settings.active();
      const busyLabel = h('span', {}, 'Analizuję zdjęcie…');
      if (d.busy) {
        const tick = () => {
          const sec = Math.round((Date.now() - d.busySince) / 1000);
          busyLabel.textContent = `Analizuję zdjęcie… ${sec} s`;
        };
        tick();
        const timer = setInterval(() => (busyLabel.isConnected ? tick() : clearInterval(timer)), 1000);
      }
      analysis = h(
        'section',
        { class: 'analysis' },
        h('label', { class: 'label', for: 'meal-name' }, 'Tytuł posiłku (opcjonalnie)'),
        h('input', {
          class: 'field',
          id: 'meal-name',
          type: 'text',
          maxlength: '120',
          placeholder: 'np. owsianka z bananem i masłem orzechowym',
          value: d.name,
          disabled: d.busy,
          'aria-describedby': 'title-hint',
          oninput: (e) => {
            d.name = e.target.value;
            d.titleByUser = e.target.value.trim() !== '';
          },
        }),
        h('p', { class: 'hint', id: 'title-hint' }, 'Tytuł podpowiada modelowi, co jest na zdjęciu, i zostaje jako nazwa w dzienniku.'),
        h('label', { class: 'label', for: 'weight' }, 'Waga jedzenia w gramach (opcjonalnie)'),
        h(
          'div',
          { class: 'with-unit' },
          h('input', {
            class: 'field field--num',
            id: 'weight',
            type: 'text',
            inputmode: 'numeric',
            placeholder: 'np. 350',
            value: d.weight,
            disabled: d.busy,
            'aria-describedby': 'weight-hint',
            oninput: (e) => {
              d.weight = e.target.value;
            },
          }),
          h('span', { class: 'unit' }, 'g')
        ),
        h(
          'p',
          { class: 'hint', id: 'weight-hint' },
          'Jeśli zważysz porcję, gramatury składników zsumują się dokładnie do tej wagi. Bez wagi model szacuje ją ze zdjęcia.'
        ),
        errorBox,
        h(
          'button',
          {
            class: 'btn ' + (d.analyzed ? 'btn--outline' : 'btn--primary') + ' btn--block',
            type: 'button',
            disabled: d.busy,
            'aria-busy': d.busy ? 'true' : null,
            onclick: analyze,
          },
          d.busy ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), busyLabel] : d.analyzed ? 'Analizuj ponownie' : 'Analizuj zdjęcie'
        ),
        h(
          'p',
          { class: 'hint hint--engine' },
          engine.apiKey
            ? `Analizuje ${ai.LABELS[engine.provider]}, model ${engine.model}. `
            : `Wybrany dostawca: ${ai.LABELS[engine.provider]}, brak klucza API. `,
          d.busy ? null : h('a', { href: '#/ustawienia', onclick: () => state.depth++ }, 'Zmień')
        ),
        d.info ? h('p', { class: 'notice', role: 'status' }, d.info) : null
      );
    }

    /* Wynik: nazwa, składniki, suma. */
    let result = null;
    let footer = null;
    if (d.analyzed) {
      result = h(
        'section',
        { class: 'result' },
        d.full
          ? null
          : [
              h('label', { class: 'label', for: 'meal-name' }, 'Nazwa posiłku'),
              h('input', {
                class: 'field',
                id: 'meal-name',
                type: 'text',
                value: d.name,
                oninput: (e) => {
                  d.name = e.target.value;
                },
              }),
            ],
        h('h2', { class: 'section-title' }, 'Składniki'),
        d.items.length
          ? h('ul', { class: 'items' }, d.items.map(itemRow))
          : h('p', { class: 'empty' }, 'Brak składników. Dodaj pierwszy poniżej.'),
        h(
          'button',
          {
            class: 'btn btn--ghost btn--block',
            type: 'button',
            onclick: () => {
              d.items.push({ name: '', grams: '', p100: '', f100: '', c100: '', isManual: true });
              rerender();
              const names = document.querySelectorAll('.item__name');
              if (names.length) names[names.length - 1].focus();
            },
          },
          icon('plus'),
          'Dodaj składnik'
        ),
        d.note ? h('p', { class: 'hint hint--note' }, 'Uwaga modelu: ' + d.note) : null
      );
      footer = h(
        'div',
        { class: 'dock dock--totals' },
        h(
          'div',
          { class: 'dock__inner dock__inner--stack' },
          h(
            'div',
            { class: 'totals' },
            h('div', { class: 'totals__row' }, h('p', { class: 'totals__kcal' }, 'Razem ', totalKcal, ' kcal'), totalMacros),
            totalBar
          ),
          h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: save }, d.isNew ? 'Zapisz posiłek' : 'Zapisz zmiany')
        )
      );
      paintTotals();
    }

    const otherDay =
      d.isNew && d.day !== today() ? h('p', { class: 'notice' }, 'Posiłek zapisze się w dniu: ' + dayTitle(d.day).toLowerCase() + '.') : null;

    return h(
      'main',
      { class: 'screen screen--editor' + (d.analyzed ? ' has-totals' : '') },
      topBar({
        title: d.isNew ? 'Nowy posiłek' : 'Posiłek',
        right: d.isNew
          ? null
          : h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Usuń posiłek', onclick: removeMeal }, icon('trash')),
      }),
      d.full || d.thumb ? h('img', { class: 'photo', src: d.full || d.thumb, alt: 'Zdjęcie posiłku' }) : null,
      otherDay,
      analysis,
      result,
      footer
    );
  }

  /* ---------- Ekran: ustawienia ---------- */

  function viewSettings() {
    const s = settings.load();
    const PROVIDERS = [
      { id: 'gemini', name: 'Gemini', keyHint: 'Klucz utworzysz w Google AI Studio.' },
      { id: 'openai', name: 'OpenAI', keyHint: 'Klucz utworzysz na platform.openai.com.' },
    ];

    function providerBlock(p) {
      const keyField = p.id + 'Key';
      const modelField = p.id + 'Model';
      const listField = p.id + 'Models';
      const status = h('p', { class: 'hint', role: 'status' });
      const select = h('select', {
        class: 'field',
        id: p.id + '-model',
        onchange: (e) => {
          s[modelField] = e.target.value;
        },
      });
      function fillModels() {
        const ids = s[listField].includes(s[modelField]) ? s[listField] : [s[modelField], ...s[listField]];
        select.replaceChildren(...ids.map((id) => h('option', { value: id }, id)));
        select.value = s[modelField];
      }
      fillModels();

      const keyInput = h('input', {
        class: 'field',
        id: p.id + '-key',
        type: 'password',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        value: s[keyField],
        'aria-describedby': p.id + '-key-hint',
        oninput: (e) => {
          s[keyField] = e.target.value.trim();
        },
      });
      const showBtn = h(
        'button',
        {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: () => {
            const hidden = keyInput.type === 'password';
            keyInput.type = hidden ? 'text' : 'password';
            showBtn.textContent = hidden ? 'Ukryj' : 'Pokaż';
          },
        },
        'Pokaż'
      );
      const fetchBtn = h(
        'button',
        {
          class: 'btn btn--outline btn--block',
          type: 'button',
          onclick: async () => {
            fetchBtn.disabled = true;
            status.textContent = 'Pobieram listę modeli…';
            try {
              const ids = await ai.listModels(p.id, s[keyField]);
              s[listField] = ids;
              if (!ids.includes(s[modelField])) s[modelField] = ai.pickModel(p.id, ids);
              fillModels();
              settings.save(s);
              status.textContent = `Klucz działa. Dostępne modele: ${ids.length}. Wybrany: ${s[modelField]}.`;
            } catch (err) {
              status.textContent = err instanceof ai.AiError ? err.message : 'Nie udało się pobrać listy modeli.';
            } finally {
              fetchBtn.disabled = false;
            }
          },
        },
        'Sprawdź klucz i pobierz modele'
      );
      const testBtn = h(
        'button',
        {
          class: 'btn btn--ghost btn--block',
          type: 'button',
          onclick: async () => {
            testBtn.disabled = true;
            status.textContent = `Wysyłam krótkie pytanie do modelu ${s[modelField]}…`;
            try {
              const r = await ai.ping({ provider: p.id, apiKey: s[keyField], model: s[modelField] });
              status.textContent = `Model ${s[modelField]} odpowiedział w ${fmt1(r.ms / 1000)} s.`;
            } catch (err) {
              const known = err instanceof ai.AiError;
              status.textContent = (known ? err.message : 'Test się nie powiódł.') + (known && err.detail ? ' Szczegóły: ' + err.detail : '');
            } finally {
              testBtn.disabled = false;
            }
          },
        },
        'Wyślij testowe pytanie do modelu'
      );

      return h(
        'fieldset',
        { class: 'group' },
        h('legend', { class: 'group__title' }, p.name),
        h('label', { class: 'label', for: p.id + '-key' }, 'Klucz API'),
        h('div', { class: 'row' }, keyInput, showBtn),
        h('p', { class: 'hint', id: p.id + '-key-hint' }, p.keyHint),
        h('label', { class: 'label', for: p.id + '-model' }, 'Model'),
        select,
        fetchBtn,
        testBtn,
        status
      );
    }

    const providerChoice = h(
      'fieldset',
      { class: 'group' },
      h('legend', { class: 'group__title' }, 'Kto analizuje zdjęcia'),
      h(
        'div',
        { class: 'segmented' },
        PROVIDERS.map((p) =>
          h(
            'label',
            { class: 'segmented__opt' },
            h('input', {
              type: 'radio',
              name: 'provider',
              value: p.id,
              checked: s.provider === p.id ? true : null,
              onchange: () => {
                s.provider = p.id;
              },
            }),
            h('span', {}, p.name)
          )
        )
      ),
      h('p', { class: 'hint' }, 'Zdjęcie trafia bezpośrednio z telefonu do wybranego dostawcy. Klucze zostają tylko na tym urządzeniu.')
    );

    /* PIN */
    const pinInput = h('input', {
      class: 'field',
      id: 'new-pin',
      type: 'password',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: 'co najmniej 4 cyfry',
    });
    const pinGroup = h(
      'fieldset',
      { class: 'group' },
      h('legend', { class: 'group__title' }, 'Blokada ustawień'),
      h(
        'p',
        { class: 'hint' },
        s.pinHash
          ? 'PIN jest ustawiony. Ekran ustawień i klucze otwierają się dopiero po jego podaniu.'
          : 'Ustaw PIN, żeby nikt z telefonem w ręku nie podejrzał ani nie zmienił kluczy API.'
      ),
      h('label', { class: 'label', for: 'new-pin' }, s.pinHash ? 'Nowy PIN' : 'PIN'),
      h(
        'div',
        { class: 'row' },
        pinInput,
        h(
          'button',
          {
            class: 'btn btn--outline',
            type: 'button',
            onclick: () => {
              const value = pinInput.value.trim();
              if (value.length < 4) return toast('PIN musi mieć co najmniej 4 cyfry');
              Object.assign(s, pin.make(value));
              settings.save(s);
              state.unlocked = true;
              toast('Ustawiono PIN');
              mount(viewSettings(), true);
            },
          },
          s.pinHash ? 'Zmień PIN' : 'Ustaw PIN'
        )
      ),
      s.pinHash
        ? h(
            'button',
            {
              class: 'link-btn',
              type: 'button',
              onclick: () => {
                s.pinHash = '';
                s.pinSalt = '';
                settings.save(s);
                toast('Usunięto PIN');
                mount(viewSettings(), true);
              },
            },
            'Usuń PIN'
          )
        : null
    );

    return h(
      'main',
      { class: 'screen screen--settings' },
      topBar({ title: 'Ustawienia' }),
      h(
        'form',
        {
          class: 'settings',
          onsubmit: (e) => {
            e.preventDefault();
            if (settings.save(s)) {
              toast('Zapisano ustawienia');
              leave();
            } else {
              toast('Nie udało się zapisać ustawień. Sprawdź, czy przeglądarka nie blokuje pamięci.');
            }
          },
        },
        providerChoice,
        PROVIDERS.map(providerBlock),
        h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Zapisz ustawienia')
      ),
      pinGroup,
      h('p', { class: 'hint' }, 'Tom Food, wersja ' + APP_VERSION)
    );
  }

  /* ---------- Start ---------- */

  $camera.addEventListener('change', onPick);
  $gallery.addEventListener('change', onPick);
  window.addEventListener('hashchange', route);

  // Po północy dziennik otwarty w tle przeskakuje na nowy dzień.
  let lastSeenToday = today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || today() === lastSeenToday) return;
    if (state.day === lastSeenToday) state.day = today();
    lastSeenToday = today();
    if (!/^#\/(nowy|posilek|ustawienia)/.test(location.hash)) route();
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  route();
})();
