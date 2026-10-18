## PR-2: «Email учасника у звіті про прострочення»
**Вердикт:** REQUEST_CHANGES
Звіт тепер віддає email, але доступ до нього не записано в журнал (`logAccess`). Крім того, у `src/` з'явилося форматування суми «грн», а Map-індекс замінено пошуком учасника на кожен рядок. CHANGELOG не оновлено.

### F1 — app/src/loans.js → overdueReport — email віддається без `logAccess`
- R2 · блокує: так · high
- `review-queue/pr-2/change.diff:16`
  ```text
  +      email: db.findMember(l.memberId)?.email ?? null,
  ```
- `overdueReport` тепер віддає назовні email кожного боржника. При цьому `logAccess` не викликається і не імпортується, хоча сусідній `memberCard` (`app/src/members.js:16`) записує кожне читання. Вхід: `overdueReport(createDb(), iryna, "2026-10-08")`. Очікується 3 записи в `db.accessLog` (memberId 5, 2, 1). Фактично `db.accessLog` лишається порожнім. Виправлення: для кожного рядка з email викликати `logAccess(db, user, l.memberId, "overdue-report")`.

### F2 — app/src/loans.js → overdueReport — форматування «грн» у `src/`, про яке опис мовчить і яке не покрите тестом
- R4, R10, R18 · блокує: так · high
- `review-queue/pr-2/change.diff:20`
  ```text
  +      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",
  ```
- У відповідь API додано суму в гривнях дробом у вигляді відформатованого рядка, через `toFixed` і «грн». Стандарт забороняє це в `src/`. Опис PR згадує лише email і про нове поле `feeText` не каже нічого. Жоден тест не перевіряє `feeText`: для loanId 6 мало б бути `"110,00 грн"`, а перевірки немає. Виправлення: прибрати `feeText` з `src/` і форматувати суму з `feeKopecks` на боці відображення.

### F3 — app/src/loans.js → overdueReport — Map-індекс замінено лінійним пошуком на кожен рядок
- R19 · блокує: так · medium
- `review-queue/pr-2/change.diff:9`
  ```text
  -  const names = new Map(db.members.map((m) => [m.id, m.name]));
  ```
  `review-queue/pr-2/change.diff:15-16`
  ```text
  +      member: db.findMember(l.memberId)?.name ?? "—",
  +      email: db.findMember(l.memberId)?.email ?? null,
  ```
- `findMember` — це `members.find(...)` (`app/src/db.js:42`), і на кожну прострочену позику він викликається двічі. Виходить 2·N×M кроків замість N+M, як було з Map. Виправлення: залишити Map `id → member`, побудовану один раз, і брати з неї `name` та `email`.

### F4 — app/CHANGELOG.md — немає запису про нові поля `email` і `feeText`
- R6 · блокує: так · medium
- `app/CHANGELOG.md:8-9`
  ```text
  - `overdueReport(db, user, todayIso)` — staff-only report of loans past due, with
    `loanId`, `member`, `book`, `daysLate`, `feeKopecks`.
  ```
- PR змінює формат відповіді експортованої `overdueReport`: додає поля `email` і `feeText`. Проте `app/CHANGELOG.md` у дифі не змінено, тож той, хто викликає функцію, про зміну не дізнається. Виправлення: додати в CHANGELOG запис про нове поле `email` (і про `feeText`, якщо воно лишиться).

### Під питанням (не блокує)
- Немає

**Дотримано:** R1, R5, R8, R11, R12, R13, R14, R16, R17 · **Незастосовні:** R3, R7, R9, R15
