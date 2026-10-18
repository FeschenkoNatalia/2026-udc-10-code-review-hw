## PR-1: «Сторінкування для списку позик»
**Вердикт:** REQUEST_CHANGES
`listLoansPage` рахує зміщення з помилкою на одиницю. Через це перша сторінка ніколи не повертається, а для невеликих списків результат порожній. Крім того, розмір сторінки не обмежено, запису в CHANGELOG немає, а тест не перевіряє `items`.

### F1 — app/src/loans.js → listLoansPage — зміщення `page * pageSize` пропускає першу сторінку
- R16, R10 · блокує: так · high
- `review-queue/pr-1/change.diff:10-12`
  ```text
  +export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {
  +  const all = listLoans(db, user);
  +  const start = page * pageSize;
  ```
- За замовчуванням `page = 1`, тобто нумерація з 1, але `start = 1 * 20 = 20`, і перші 20 позик не потрапляють на жодну сторінку. Приклад: staff (`iryna`), `createDb()` має 7 позик (`app/test/loans.test.js:16`), виклик `{ page: 1, pageSize: 20 }` → очікувано `items` з 7 позиками → фактично `items: []` при `total: 7`. Для `page: -1`: `slice(-20, 0)` → `[]`. Тому твердження опису «Додав `listLoansPage` — сторінки, розмір сторінки, загальна кількість» не відповідає коду. Виправлення: `const start = (page - 1) * pageSize;`, а `page` обмежити знизу значенням 1.

### F2 — app/src/loans.js → listLoansPage — розмір сторінки не обмежено
- R7 · блокує: так · high
- `review-queue/pr-1/change.diff:10`
  ```text
  +export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {
  ```
- `pageSize` береться від викликача як є, верхньої межі немає. Приклад: `{ page: 1, pageSize: 1e9 }` → очікувано сторінка з обмеженим розміром → фактично весь список із 3 000+ рядків. Сторінкування, яке додали для UI, такий виклик обходить. Виправлення: обмежити `pageSize` константою, наприклад `Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE)`.

### F3 — app/CHANGELOG.md — нова публічна функція без запису
- R6 · блокує: так · medium
- `review-queue/pr-1/change.diff:10`
  ```text
  +export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {
  ```
- Диф додає `export` в `app/src/loans.js`, а `app/CHANGELOG.md` у ньому не змінено. Нова функція і форма її результату `{ items, page, pageSize, total }` ніде не задокументовані. Виправлення: додати запис про `listLoansPage` з параметрами, нумерацією сторінок від 1, межею `pageSize` і формою результату.

### F4 — app/test/loans.test.js → тест сторінкування не перевіряє `items`
- R18, R8 · блокує: так · medium
- `review-queue/pr-1/change.diff:36-41`
  ```text
  +test("paged list reports the total and the page it returned", () => {
  +  const res = listLoansPage(createDb(), iryna, { page: 1, pageSize: 20 });
  +  assert.equal(res.total, 7);
  +  assert.equal(res.page, 1);
  +  assert.equal(res.pageSize, 20);
  +});
  ```
- Тест перевіряє тільки поля, які лише повторюють вхід (`page`, `pageSize`), і `total`. Головну нову поведінку, тобто вміст сторінки, він не перевіряє, тому проходить, хоча `items` порожній (див. F1). Не перевірено і кілька сторінок: вхід `{ page: 2, pageSize: 3 }` → очікувано id позик 4–6. Виправлення: додати `assert.deepEqual(res.items.map((l) => l.id), [...])` для першої та наступної сторінки і випадок, коли `pageSize` перевищує межу.

### Під питанням (не блокує)
- R9 · `review-queue/pr-1/change.diff:10-14` — нова функція покладається на перевірку з `listLoans` (`user required` і фільтр за `user.id` для учасника). Тесту, де `listLoansPage` викликає учасник або виклик іде без `user`, немає. Бракує доказу, що делегована перевірка вважається «новою функцією з перевіркою доступу» в сенсі R9.

**Дотримано:** R1, R11, R12, R13, R14, R17 · **Незастосовні:** R2, R3, R4, R5, R15
