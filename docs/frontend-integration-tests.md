# Front-end integration test plan

Use Playwright for browser integration tests. Run the app against a dedicated
test database or an in-memory data adapter, and give each test a new family so
tests can run in parallel without sharing state.

## Highest-value user journeys

1. Child QR sign-in
   - Confirm the child instructions are the first and most prominent option.
   - Provide a valid QR result, select a child, enter the PIN, and confirm the
     child dashboard opens.
   - Repeat with an expired QR result and confirm the page asks for a new code.
2. Adult email sign-in
   - Enter an adult email, capture the test email, and open its link.
   - Confirm an unknown email receives the same browser response.
3. Parent gives a child access
   - Confirm the child sign-in card is visible without changing tabs.
   - Open the QR dialog and confirm the QR image, expiry, and link are present.
   - Copy the link and verify that it opens the family login page.
4. Parent manages people
   - Add a child, reject a short PIN and duplicate adult email, update login
     details, and remove a profile.
   - Confirm the signed-in adult cannot remove their own profile.
5. Chore lifecycle
   - Add assigned and shared chores, then verify each child's visible chores.
   - Complete and undo a chore and verify the balance and reversal entry.
   - Complete a repeatable chore twice and confirm two payments appear.
6. Ledger and balances
   - Add positive and negative adjustments and verify all displayed totals.
   - Filter the audit trail by child, date, and reason.
   - Confirm children cannot view another child's financial information.
7. Session and recovery
   - Refresh dashboards, log out, expire a family link, and deny camera access.
   - Confirm each state recovers with clear language and no internal terms.

## Browser coverage

Run the core journeys in Chromium on every build. Run a smaller compatibility
set in Firefox and WebKit before deployment. Include a narrow mobile viewport
for child sign-in, the PIN pad, the parent QR dialog, and the chore list.

## Test design notes

- Prefer accessible Playwright queries such as `getByRole` and `getByLabel`.
  Add stable `data-testid` attributes only when those are not enough.
- Put the QR decoder behind a small injectable adapter. Stub its result in most
  tests, with one real QR image test to verify decoder compatibility.
- Grant a fake camera stream for successful scan tests and test denied camera
  permission separately.
- Capture email with a local service such as Mailpit or a test email adapter.
  Never call Mailjet from browser tests.
- Seed state through a test fixture process instead of browser clicks unless
  the clicks themselves are the behavior being tested.
- Save screenshots, Playwright traces, console output, and network logs on
  failure.

## Suggested automation stages

1. Pull request: API tests, Chromium core journeys, and infrastructure build.
2. Pre-deploy: Chromium, Firefox, WebKit, and mobile viewport journeys.
3. Post-deploy smoke test: health endpoint, homepage, adult link request, and a
   read-only child login using a dedicated smoke-test family.
