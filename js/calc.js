/* Obliczenia: makro z gramatury i wartości na 100 g, kalorie ze wzoru 4/4/9. */
(function () {
  'use strict';
  const TF = (window.TF = window.TF || {});

  const KCAL_PER_G = { p: 4, c: 4, f: 9 };

  /** Zamienia tekst z pola formularza ("12,5") lub liczbę na liczbę >= 0. */
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
    const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function kcalOf(p, f, c) {
    return KCAL_PER_G.p * p + KCAL_PER_G.c * c + KCAL_PER_G.f * f;
  }

  /** Makro i kalorie jednego składnika. */
  function itemTotals(item) {
    const k = num(item.grams) / 100;
    const p = num(item.p100) * k;
    const f = num(item.f100) * k;
    const c = num(item.c100) * k;
    return { grams: num(item.grams), p, f, c, kcal: kcalOf(p, f, c) };
  }

  function sumTotals(list) {
    const t = { grams: 0, p: 0, f: 0, c: 0, kcal: 0 };
    for (const x of list) {
      t.grams += x.grams;
      t.p += x.p;
      t.f += x.f;
      t.c += x.c;
    }
    t.kcal = kcalOf(t.p, t.f, t.c);
    return t;
  }

  function mealTotals(meal) {
    return sumTotals((meal.items || []).map(itemTotals));
  }

  function dayTotals(meals) {
    return sumTotals(meals.map(mealTotals));
  }

  /**
   * Przeskalowuje gramatury tak, żeby sumowały się dokładnie do podanej wagi.
   * Zwraca nową listę; proporcje między składnikami zostają.
   */
  function scaleToWeight(items, totalGrams) {
    const total = Math.round(num(totalGrams));
    const sum = items.reduce((s, it) => s + num(it.grams), 0);
    if (!(total > 0) || !(sum > 0)) return items.map((it) => ({ ...it }));
    const k = total / sum;
    const out = items.map((it) => ({ ...it, grams: Math.max(1, Math.round(num(it.grams) * k)) }));
    // Zaokrąglenia mogą dać różnicę kilku gramów: koryguje ją największy składnik.
    const diff = total - out.reduce((s, it) => s + it.grams, 0);
    if (diff !== 0) {
      let big = 0;
      for (let i = 1; i < out.length; i++) if (out[i].grams > out[big].grams) big = i;
      out[big].grams = Math.max(1, out[big].grams + diff);
    }
    return out;
  }

  /** Udział białka, tłuszczów i węglowodanów w kaloriach (ułamki 0..1). */
  function kcalShares(t) {
    const kp = KCAL_PER_G.p * t.p;
    const kf = KCAL_PER_G.f * t.f;
    const kc = KCAL_PER_G.c * t.c;
    const s = kp + kf + kc;
    if (!(s > 0)) return { p: 0, f: 0, c: 0 };
    return { p: kp / s, f: kf / s, c: kc / s };
  }

  TF.calc = { num, kcalOf, itemTotals, mealTotals, dayTotals, sumTotals, scaleToWeight, kcalShares };
})();
