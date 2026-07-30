# PiggyLedger Wishlist

This is a running list of possible future improvements. Items are ideas, not
committed roadmap work, and can be refined as the product evolves.

## 1. Migrate persistence to DynamoDB (core migration implemented)

Replace the local JSON database with DynamoDB so application data survives EC2
replacement and no longer depends on a single local disk.

Considerations:

- Design keys around families, users, chores, ledger entries, and balances.
- Preserve ledger history and account credentials during migration.
- Support atomic balance-affecting transactions.
- Add backup and point-in-time recovery options.
- Keep usage within DynamoDB's low-cost or free-tier range.

## 2. Support multiple families (core tenant isolation implemented)

Allow multiple independent families to use one PiggyLedger deployment without
seeing or modifying each other's data.

Considerations:

- Introduce a stable `familyId` tenant boundary on every relevant record.
- Give each family its own access token, adults, children, chores, settings,
  currencies, and ledger.
- Prevent cross-family access in every API operation.
- Add family creation, invitation, administration, and deletion flows.
- Design this together with the DynamoDB schema rather than retrofitting it.

## 3. Support a tax rate

Allow a configurable percentage to be withheld when a child earns money.

Considerations:

- Configure the rate per family, with an optional per-child override.
- Record gross earnings, tax withheld, and net earnings as auditable ledger
  values rather than modifying balances invisibly.
- Decide where withheld funds go: removed, tracked in a tax account, or moved
  into savings.
- Define rounding behavior and whether adjustments, gifts, and exchanges are
  taxable.

## 4. Add “tablet time” as an alternative currency

Allow chores and ledger entries to award tablet time, such as minutes, instead
of money.

Possible capabilities:

- Let each chore pay money, tablet minutes, or both.
- Show separate balances and transaction histories for each currency.
- Allow adults to grant, deduct, or redeem tablet time.
- Optionally let children exchange money for tablet time using a
  family-configured rate.
- Record exchanges as linked ledger entries so the conversion is auditable.
- Define whether exchanges are one-way or reversible and whether daily limits
  apply.

## Suggested implementation order

1. Model multiple families and DynamoDB together.
2. Migrate existing data and APIs to the new tenant-aware schema.
3. Generalize the ledger to support multiple currencies.
4. Add tablet-time earning, spending, and exchange rules.
5. Add tax calculations once ledger transaction types and currency behavior are
   stable.
