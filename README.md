# Tom Food

Uproszczony dziennik kalorii: robisz zdjęcie posiłku, model AI rozpoznaje składniki i ich makro, a aplikacja liczy kalorie i sumę dnia.

## Jak to działa

1. Zdjęcie (aparat lub galeria), opcjonalnie tytuł posiłku i waga porcji w gramach.
2. Zdjęcie trafia prosto z telefonu do Gemini albo OpenAI. Model zwraca listę składników: nazwa, gramatura, białko, tłuszcze i węglowodany na 100 g.
3. Kalorie liczy aplikacja: `4 × białko + 4 × węglowodany + 9 × tłuszcze`.
4. Składniki i gramatury można poprawić przed zapisem. Posiłki zapisują się w dzienniku z sumą dzienną.

Dane (posiłki, klucze API) zostają wyłącznie w pamięci przeglądarki na danym telefonie. Nie ma serwera ani kont.

## Uruchomienie

- **Na komputerze, do testów:** otwórz `index.html` w Chrome.
- **Na telefonie:** aplikacja musi być dostępna pod adresem HTTPS (np. GitHub Pages). Otwórz adres w Chrome na Androidzie i wybierz z menu „Dodaj do ekranu głównego”.

Przy pierwszym uruchomieniu wejdź w ustawienia (ikona w prawym górnym rogu), wklej klucz API i kliknij „Sprawdź klucz i pobierz modele”.

## Aktualizacje

Po zmianie plików podbij numer wersji w `sw.js` (np. `tomfood-v3` → `tomfood-v4`), żeby telefony pobrały nową wersję.

## Pliki

| Plik | Rola |
|---|---|
| `index.html` | strona aplikacji |
| `css/app.css` | wygląd |
| `js/calc.js` | obliczenia makro i kalorii |
| `js/ai.js` | zapytania do OpenAI i Gemini, prompt, schemat odpowiedzi |
| `js/db.js` | zapis posiłków (IndexedDB), ustawienia, PIN |
| `js/app.js` | ekrany i nawigacja |
| `sw.js`, `manifest.webmanifest`, `icons/` | instalacja na telefonie i praca bez sieci |
| `fonts/` | krój Bricolage Grotesque (licencja SIL OFL 1.1) |
