## PR-4: «Винести хелпери дат у src/dates.js»
**Вердикт:** REQUEST_CHANGES
Перенесення зберігає поведінку `daysBetween`, `addDays` і `lateFee`. Але раніше приватна `toUtc` стала публічною `toUtcMs`, і вона повертає дату як timestamp, а не рядок `YYYY-MM-DD`. Це порушує блокуюче правило R5.

### F1 — app/src/dates.js → toUtcMs — нова публічна функція повертає дату як timestamp
- R5 · блокує: так · high
- `review-queue/pr-4/change.diff:27`
  ```text
  +export function toUtcMs(iso) {
  +  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  ```
- У базовому коді `toUtc` не експортувалася (`app/src/loans.js:8`: `function toUtc(iso) {`). Тепер це export з `app/src/`, і будь-який модуль може отримати дату як число мілісекунд. За стандартом R5 порушує дата в результаті, яка не є рядком `YYYY-MM-DD`, зокрема timestamp. Приклад: `toUtcMs("2026-10-08")` має повертати рядок `YYYY-MM-DD`, а повертає `1791417600000`. Виправлення: зробити `toUtcMs` приватною в `dates.js`, прибрати її з CHANGELOG, а тест у `dates.test.js` перевести на `daysBetween`/`addDays`.

### Під питанням (не блокує)
- R10 · `review-queue/pr-4/PR.md:3` — опис каже лише, що хелпери «переїхали в окремий модуль». Він не згадує, що `toUtcMs` стала публічною, тобто що зміна розширює API. Про це пише лише CHANGELOG. Неясно, чи достатньо формулювання «хелпери переїхали», щоб покрити новий export.

**Дотримано:** R6, R8, R11, R12, R13, R14, R16, R17, R18 · **Незастосовні:** R1, R2, R3, R4, R7, R9, R15
