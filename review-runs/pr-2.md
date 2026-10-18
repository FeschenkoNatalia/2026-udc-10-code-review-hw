## PR-2: «Email учасника у звіті про прострочення»
**Вердикт:** REQUEST_CHANGES
`overdueReport` тепер віддає email, але не пише в журнал доступу. Крім того, зміна додає форматовану суму в гривнях у `src/`, а нові поля не внесено в CHANGELOG і не згадано в описі.

### F1 — app/src/loans.js → overdueReport — email віддається без `logAccess`
- R2 · блокує: так · high
- `review-queue/pr-2/change.diff:16`
  ```text
  +      email: db.findMember(l.memberId)?.email ?? null,
  ```
- Сусідня функція `memberCard` (`app/src/members.js:16`) викликає `logAccess(db, user, m.id, "member-card")` перед тим, як віддати email. `overdueReport` у `loans.js` не імпортує `logAccess` і не викликає його. Вхід: `overdueReport(createDb(), iryna, "2026-10-08")`. Очікуване: 3 записи в `db.accessLog`, по одному на учасників 5, 2 і 1. Фактичне: `accessLog` порожній, хоча віддано email трьох учасників. Виправлення: для кожного учасника, чий email потрапив у звіт, викликати `logAccess(db, user, memberId, "overdue-report")`.

### F2 — app/src/loans.js → overdueReport — у `src/` додано форматовану суму в гривнях
- R4, R10, R18 · блокує: так · high
- `review-queue/pr-2/change.diff:20`
  ```text
  +      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",
  ```
- `review-queue/pr-2/PR.md:4`
  ```text
  Тепер для кожного рядка беремо учасника і віддаємо ім'я та email.
  ```
- R4 прямо забороняє форматування на зразок «15,00 грн» у `src/`: сума в гривнях і з `toFixed` іде в API поруч із `feeKopecks`. Опис згадує лише ім'я та email, а нове поле `feeText` у ньому не названо (R10). Тесту на `feeText` немає (R18): для рядка `loanId: 6` на `2026-10-08` очікуване значення `"110,00 грн"` ніде не перевіряється. Виправлення: прибрати `feeText` і форматувати суму з `feeKopecks` на боці клієнта.

### F3 — app/src/loans.js → overdueReport — змінено форму результату, а CHANGELOG не оновлено
- R6 · блокує: так · medium
- `review-queue/pr-2/change.diff:15-16`
  ```text
  +      member: db.findMember(l.memberId)?.name ?? "—",
  +      email: db.findMember(l.memberId)?.email ?? null,
  ```
- У результат експортованої `overdueReport` додано поля `email` і `feeText` (рядок 20), а `app/CHANGELOG.md` у дифі не змінено. Чинний запис (`app/CHANGELOG.md:8-9`) і далі перелічує лише `loanId`, `member`, `book`, `daysLate`, `feeKopecks`. Виправлення: додати в CHANGELOG запис про нове поле `email` (і про `feeText`, якщо його залишать).

### Під питанням (не блокує)
- Немає

**Дотримано:** R1, R5, R7, R8, R11, R12, R13, R14, R16, R17 · **Незастосовні:** R3, R9, R15
