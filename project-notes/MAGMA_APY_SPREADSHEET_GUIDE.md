# Magma APY Spreadsheet Guide

Use this layout to verify the tracker's realized Magma APY in a spreadsheet.

## Columns

- `A`: Date/Time
- `B`: Cash Flow (MON)
- `C`: Note

## How To Fill It

For each direct Magma stake lot consumed by the redeem:

- put the stake timestamp in column `A`
- put the original MON deposited as a negative number in column `B`
- add an optional label in column `C`

For the redeem request:

- put the redeem-request timestamp in column `A`
- put the claimable MON value as a positive number in column `B`
- add an optional label in column `C`

## Example

```text
A                         B         C
2026-04-01 09:15:00      -0.60     Stake lot 1
2026-04-05 14:40:00      -0.40     Stake lot 2
2026-04-18 10:20:00       1.05     Redeem value
```

## APY Formula

Use `XIRR` for multiple stake lots:

```excel
=XIRR(B2:B4,A2:A4)
```

Format the result cell as a percentage.

## Single-Lot Check

If there is only one stake lot, you can verify with:

```excel
=(B3/ABS(B2))^(365/(A3-A2))-1
```

## Notes

- Use the redeem-request timestamp, not the later claim timestamp.
- Only include direct Magma stake lots actually consumed by that redeem.
- `Claimable Shares` is not the gain input.
- The positive terminal value is `Claimable MON`.
