# Frontend restyle verification

The frontend uses shared tokens in `public/css/style.css`, locally hosted
Nunito Sans fonts (SIL Open Font License in `public/fonts/OFL.txt`), and
shared keyboard/dialog behavior in `public/js/ui.js`.

## Verified

- Chromium screenshots of all five pages at 390, 768, and 1440 pixel widths,
  in both light and dark themes.
- All five adult tabs at each width and theme: no document overflow.
- Representative pending, reusable, and completed chores; positive and
  negative ledger entries; balances; people; rankings; and a pending request.
- Adult balance card keyboard access, initial dialog focus, focus wrapping,
  Escape dismissal, focus restoration, and arrow-key tab navigation.
- All five adult dialog layouts on mobile without internal horizontal overflow.
- Child amount keypad, money-request submission with a mocked response,
  Escape dismissal, and theme persistence after reload.
- No uncaught JavaScript exceptions during the page and tab sweep.
- Source API suite: 31 tests passed. Full `npm run build`: passed (93 tests
  including two existing CDK asset copies), followed by TypeScript compilation.
- JavaScript syntax checks and `git diff --check`: passed.

## Scope

Browser verification used a local static server with Playwright-intercepted
API fixtures. It did not contact live family data or AWS. The API suite uses
its existing in-memory adapters. Real camera scanning, email delivery,
clipboard permissions, and Firefox/WebKit were not exercised.

Visual refinement moved the theme switch into document flow to avoid
covering controls and made the child history table fit narrow screens.
