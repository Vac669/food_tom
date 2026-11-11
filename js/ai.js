/* Analiza zdjęcia przez model: OpenAI albo Gemini, wywoływane prosto z telefonu. */
(function () {
  'use strict';
  const TF = (window.TF = window.TF || {});
  const { num } = TF.calc;

  const TIMEOUT_MS = 120000;
  const MAX_OUTPUT_TOKENS = 8000;

  const DEFAULT_MODELS = {
    gemini: 'gemini-3.7-flash',
    openai: 'gpt-5.5',
  };

  /** Błąd z komunikatem gotowym do pokazania użytkownikowi. */
  class AiError extends Error {
    constructor(message, opts) {
      super(message);
      this.name = 'AiError';
      this.code = (opts && opts.code) || 'error';
      this.detail = (opts && opts.detail) || '';
    }
  }

  function buildPrompt(weightGrams) {
    const w = Math.round(num(weightGrams));
    const weightLine =
      w > 0
        ? `Użytkownik zważył jedzenie: łączna waga to ${w} g. Gramatury składników muszą sumować się do ${w} g.`
        : 'Użytkownik nie podał wagi. Oszacuj gramatury na podstawie wielkości talerza, sztućców, opakowania i typowych porcji.';
    return [
      'Przeanalizuj zdjęcie jedzenia i zwróć wynik jako JSON.',
      '',
      'Zasady:',
      '- Wypisz każdy widoczny składnik osobno (na przykład: ryż, pierś z kurczaka, sos, oliwa), po polsku i konkretnie.',
      '- grams: gramatura porcji widocznej na zdjęciu, w stanie, w jakim jest podana (po ugotowaniu, usmażeniu). Dla napojów podaj mililitry.',
      '- protein_100g, fat_100g, carbs_100g: białko, tłuszcze i węglowodany w gramach na 100 g tego składnika w tym samym stanie. Uwzględnij tłuszcz ze smażenia i sosy.',
      '- Nie licz kalorii, policzy je aplikacja.',
      '- Jeśli na zdjęciu widać etykietę lub tabelę wartości odżywczych, użyj wartości z etykiety.',
      '- meal_name: krótka polska nazwa całego posiłku, najwyżej 5 słów.',
      '- note: jedno krótkie zdanie o tym, co było najtrudniejsze do oszacowania, albo pusty tekst.',
      '- Jeśli zdjęcie nie przedstawia jedzenia ani napoju, ustaw is_food na false i zwróć pustą listę items.',
      '',
      weightLine,
      '',
      'Odpowiedz wyłącznie obiektem JSON w tym kształcie:',
      '{"is_food": true, "meal_name": "", "items": [{"name": "", "grams": 0, "protein_100g": 0, "fat_100g": 0, "carbs_100g": 0}], "note": ""}',
    ].join('\n');
  }

  const ITEM_FIELDS = ['name', 'grams', 'protein_100g', 'fat_100g', 'carbs_100g'];
  const ROOT_FIELDS = ['is_food', 'meal_name', 'items', 'note'];

  /** Schemat w dialekcie OpenAI (strict) albo Gemini (typy wielkimi literami, bez additionalProperties). */
  function buildSchema(dialect) {
    const T = (t) => (dialect === 'gemini' ? t.toUpperCase() : t);
    const item = {
      type: T('object'),
      properties: {
        name: { type: T('string') },
        grams: { type: T('number') },
        protein_100g: { type: T('number') },
        fat_100g: { type: T('number') },
        carbs_100g: { type: T('number') },
      },
      required: ITEM_FIELDS,
    };
    const root = {
      type: T('object'),
      properties: {
        is_food: { type: T('boolean') },
        meal_name: { type: T('string') },
        items: { type: T('array'), items: item },
        note: { type: T('string') },
      },
      required: ROOT_FIELDS,
    };
    if (dialect === 'openai') {
      item.additionalProperties = false;
      root.additionalProperties = false;
    }
    return root;
  }

  /** Wyciąga obiekt JSON z odpowiedzi modelu, także gdy jest owinięty w ```json albo w tekst. */
  function extractJson(text) {
    const raw = String(text || '').trim();
    const tries = [raw, raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')];
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of tries) {
      try {
        const v = JSON.parse(t);
        if (v && typeof v === 'object') return v;
      } catch (e) {
        /* następna próba */
      }
    }
    throw new AiError('Model zwrócił odpowiedź, której nie da się odczytać. Spróbuj ponownie.', {
      code: 'bad_json',
      detail: raw.slice(0, 300),
    });
  }

  const clamp = (v, max) => Math.min(max, Math.round(num(v) * 10) / 10);

  /** Sprawdza i porządkuje odpowiedź modelu. Zwraca { name, items, note }. */
  function normalizeResult(data) {
    const list = Array.isArray(data && data.items) ? data.items : [];
    const items = [];
    for (const it of list) {
      if (!it || typeof it !== 'object') continue;
      const name = String(it.name || '').trim().slice(0, 80);
      const grams = Math.round(num(it.grams));
      if (!name || !(grams > 0)) continue;
      items.push({
        name,
        grams: Math.min(grams, 5000),
        p100: clamp(it.protein_100g, 100),
        f100: clamp(it.fat_100g, 100),
        c100: clamp(it.carbs_100g, 100),
      });
    }
    if ((data && data.is_food === false) || items.length === 0) {
      throw new AiError('Na zdjęciu nie widać jedzenia. Zrób zdjęcie posiłku z bliska, przy dobrym świetle.', {
        code: 'no_food',
      });
    }
    return {
      name: String((data && data.meal_name) || '').trim().slice(0, 60) || 'Posiłek',
      items,
      note: String((data && data.note) || '').trim().slice(0, 240),
    };
  }

  function splitDataUrl(dataUrl) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) throw new AiError('Nie udało się przygotować zdjęcia. Wybierz je jeszcze raz.', { code: 'bad_image' });
    return { mime: m[1], base64: m[2] };
  }

  async function request(url, init, providerLabel) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new AiError(`${providerLabel} nie odpowiedział w ciągu 2 minut. Spróbuj ponownie albo wybierz szybszy model w ustawieniach.`, {
          code: 'timeout',
        });
      }
      // Przeglądarka nie podaje powodu. OpenAI przy błędnym kluczu też kończy się w ten sposób.
      throw new AiError(
        `Nie udało się połączyć z ${providerLabel}. Sprawdź internet. Jeśli działa, sprawdź klucz API w ustawieniach.`,
        { code: 'network', detail: String((e && e.message) || '') }
      );
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      /* odpowiedź bez JSON */
    }
    return { ok: res.ok, status: res.status, body };
  }

  function httpError(providerLabel, status, body) {
    const detail = String((body && body.error && (body.error.message || body.error.status)) || '').slice(0, 300);
    let msg;
    if (status === 401 || status === 403 || (status === 400 && /api.?key/i.test(detail))) {
      msg = `Klucz API ${providerLabel} jest nieprawidłowy albo nie ma uprawnień. Popraw go w ustawieniach.`;
    } else if (status === 404) {
      msg = `Wybrany model ${providerLabel} nie istnieje. Pobierz listę modeli w ustawieniach i wybierz inny.`;
    } else if (status === 429) {
      msg = `Limit zapytań ${providerLabel} jest wyczerpany albo skończyły się środki na koncie. Spróbuj później lub przełącz model w ustawieniach.`;
    } else if (status >= 500) {
      msg = `Serwer ${providerLabel} ma chwilowy problem. Spróbuj ponownie za chwilę.`;
    } else {
      msg = `${providerLabel} odrzucił zapytanie (błąd ${status}).`;
    }
    return new AiError(msg, { code: 'http_' + status, detail });
  }

  function truncatedError(providerLabel) {
    return new AiError(`${providerLabel} przerwał odpowiedź przed końcem. Spróbuj ponownie.`, { code: 'truncated' });
  }

  /**
   * Wysyła kolejne warianty zapytania, od najbogatszego do najprostszego.
   * Błąd 400 zwykle znaczy, że model nie zna któregoś parametru, więc próbujemy prostszej wersji.
   */
  async function sendVariants(variants, send) {
    let last;
    for (const variant of variants) {
      last = await send(variant);
      if (last.status !== 400) break;
      const detail = String((last.body && last.body.error && last.body.error.message) || '');
      if (/api.?key/i.test(detail)) break; // zły klucz: prostsze warianty nic nie zmienią
    }
    return last;
  }

  /* ---------- OpenAI ---------- */

  /*
   * reasoning_effort "low": szacowanie porcji nie wymaga długiego namysłu, a domyślny poziom
   * potrafi wydłużyć odpowiedź do minut. Limit tokenów chroni przed odpowiedzią bez końca.
   */
  function openaiVariants(wantJson) {
    const schema = { type: 'json_schema', json_schema: { name: 'meal_analysis', strict: true, schema: buildSchema('openai') } };
    if (!wantJson) return [{ effort: 'low', max: 2000 }, { max: 2000 }, {}];
    return [
      { format: schema, effort: 'low', max: MAX_OUTPUT_TOKENS },
      { format: schema, max: MAX_OUTPUT_TOKENS },
      { format: { type: 'json_object' }, max: MAX_OUTPUT_TOKENS },
      {},
    ];
  }

  async function openaiChat({ apiKey, model, content, wantJson }) {
    const last = await sendVariants(openaiVariants(wantJson), (v) => {
      const payload = { model, messages: [{ role: 'user', content }] };
      if (v.format) payload.response_format = v.format;
      if (v.effort) payload.reasoning_effort = v.effort;
      if (v.max) payload.max_completion_tokens = v.max;
      return request(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: JSON.stringify(payload),
        },
        'OpenAI'
      );
    });
    if (!last.ok) throw httpError('OpenAI', last.status, last.body);
    const choice = last.body && last.body.choices && last.body.choices[0];
    const msg = choice && choice.message;
    if (msg && msg.refusal) {
      throw new AiError('Model odmówił analizy tego zdjęcia. Spróbuj z innym ujęciem.', {
        code: 'refusal',
        detail: String(msg.refusal).slice(0, 300),
      });
    }
    let text = msg && msg.content;
    if (Array.isArray(text)) text = text.map((p) => (p && p.text) || '').join('');
    return { text: String(text || ''), truncated: !!choice && choice.finish_reason === 'length' };
  }

  /* ---------- Gemini ---------- */

  function geminiVariants(wantJson) {
    if (!wantJson) return [{ thinking: 'low', max: 2000 }, { max: 2000 }, {}];
    return [
      { json: true, schema: true, thinking: 'low', max: MAX_OUTPUT_TOKENS },
      { json: true, schema: true, max: MAX_OUTPUT_TOKENS },
      { json: true, max: MAX_OUTPUT_TOKENS },
      {},
    ];
  }

  async function geminiGenerate({ apiKey, model, parts, wantJson }) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    const last = await sendVariants(geminiVariants(wantJson), (v) => {
      const cfg = {};
      if (v.json) cfg.responseMimeType = 'application/json';
      if (v.schema) cfg.responseSchema = buildSchema('gemini');
      if (v.thinking) cfg.thinkingConfig = { thinkingLevel: v.thinking };
      if (v.max) cfg.maxOutputTokens = v.max;
      const payload = { contents: [{ parts }] };
      if (Object.keys(cfg).length) payload.generationConfig = cfg;
      return request(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(payload),
        },
        'Gemini'
      );
    });
    if (!last.ok) throw httpError('Gemini', last.status, last.body);
    const body = last.body || {};
    if (body.promptFeedback && body.promptFeedback.blockReason) {
      throw new AiError('Model odmówił analizy tego zdjęcia. Spróbuj z innym ujęciem.', {
        code: 'refusal',
        detail: String(body.promptFeedback.blockReason),
      });
    }
    const cand = body.candidates && body.candidates[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => p && !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    return { text, truncated: !!cand && cand.finishReason === 'MAX_TOKENS' };
  }

  /* ---------- Wspólne wejścia ---------- */

  const LABELS = { openai: 'OpenAI', gemini: 'Gemini' };

  function ask({ provider, apiKey, model, text, dataUrl, wantJson }) {
    if (provider === 'openai') {
      const content = [{ type: 'text', text }];
      if (dataUrl) content.push({ type: 'image_url', image_url: { url: dataUrl } });
      return openaiChat({ apiKey, model, content, wantJson });
    }
    const parts = [];
    if (dataUrl) {
      const { mime, base64 } = splitDataUrl(dataUrl);
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    }
    parts.push({ text });
    return geminiGenerate({ apiKey, model, parts, wantJson });
  }

  /**
   * Analizuje zdjęcie posiłku.
   * @returns {Promise<{name: string, items: Array, note: string}>}
   */
  async function analyzePhoto({ provider, apiKey, model, dataUrl, weightGrams }) {
    if (!apiKey) {
      throw new AiError('Brakuje klucza API. Dodaj go w ustawieniach.', { code: 'no_key' });
    }
    const reply = await ask({
      provider,
      apiKey,
      model: model || DEFAULT_MODELS[provider],
      text: buildPrompt(weightGrams),
      dataUrl,
      wantJson: true,
    });
    let data;
    try {
      data = extractJson(reply.text);
    } catch (e) {
      throw reply.truncated ? truncatedError(LABELS[provider]) : e;
    }
    const result = normalizeResult(data);
    if (num(weightGrams) > 0) result.items = TF.calc.scaleToWeight(result.items, weightGrams);
    return result;
  }

  /**
   * Krótki test: jedno zdanie do wybranego modelu, bez zdjęcia.
   * Pokazuje, czy klucz, model i połączenie działają, i ile trwa odpowiedź.
   */
  async function ping({ provider, apiKey, model }) {
    if (!apiKey) throw new AiError('Najpierw wpisz klucz API.', { code: 'no_key' });
    const started = Date.now();
    const reply = await ask({
      provider,
      apiKey,
      model: model || DEFAULT_MODELS[provider],
      text: 'Odpowiedz jednym słowem: OK',
      wantJson: false,
    });
    return { ms: Date.now() - started, text: reply.text.trim().slice(0, 40) };
  }

  /* ---------- Lista modeli ---------- */

  const NOT_FOR_PHOTOS = /(audio|realtime|tts|transcribe|image|embedding|search|instruct|codex|moderation|live|robotics|computer-use|whisper|dall|sora|veo|lyria)/i;

  /** Sortuje malejąco po numerze wersji w nazwie, żeby najnowsze modele były na górze. */
  function byVersionDesc(a, b) {
    const va = parseFloat((/(\d+(?:\.\d+)?)/.exec(a) || [0, 0])[1]);
    const vb = parseFloat((/(\d+(?:\.\d+)?)/.exec(b) || [0, 0])[1]);
    return vb - va || a.localeCompare(b);
  }

  async function listModels(provider, apiKey) {
    if (!apiKey) throw new AiError('Najpierw wpisz klucz API.', { code: 'no_key' });
    let ids = [];
    if (provider === 'openai') {
      const r = await request('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + apiKey } }, 'OpenAI');
      if (!r.ok) throw httpError('OpenAI', r.status, r.body);
      ids = ((r.body && r.body.data) || [])
        .map((m) => String(m.id || ''))
        .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id));
    } else {
      const r = await request(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
        { headers: { 'x-goog-api-key': apiKey } },
        'Gemini'
      );
      if (!r.ok) throw httpError('Gemini', r.status, r.body);
      ids = ((r.body && r.body.models) || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((id) => /^gemini-/.test(id));
    }
    return Array.from(new Set(ids.filter((id) => id && !NOT_FOR_PHOTOS.test(id)))).sort(byVersionDesc);
  }

  /** Wybiera rozsądny model z pobranej listy, gdy zapisany już nie istnieje. */
  function pickModel(provider, ids) {
    const exact = provider === 'openai' ? /^gpt-\d+(\.\d+)?$/ : /^gemini-\d+(\.\d+)?-flash$/;
    return ids.find((id) => exact.test(id)) || ids[0] || DEFAULT_MODELS[provider];
  }

  TF.ai = {
    AiError,
    DEFAULT_MODELS,
    LABELS,
    analyzePhoto,
    ping,
    listModels,
    pickModel,
    // wystawione do testów
    _buildPrompt: buildPrompt,
    _buildSchema: buildSchema,
    _extractJson: extractJson,
    _normalizeResult: normalizeResult,
  };
})();
