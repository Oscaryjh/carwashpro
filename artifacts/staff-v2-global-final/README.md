# Tetamu Staff App V2 — Global Final Visual Pack

Scope: canonical Staff 3000, Local / Railway Testing safe evidence only. No Production data is included.

## Evidence provenance

- `profile-390x844.png` was captured during this closure from the clean controlled worktree at `ccbba5e`, using the local Profile V2 fixture and an authenticated local-only session.
- The remaining images are copied, without pixel modification, from the accepted V2 phase evidence that forms the current canonical commit chain. They are consolidated here so the final UAT has one reviewable pack.
- The 360 and 412 images are representative layout-risk captures. The primary review width is 390×844.

## Primary 390×844 pack

| Module | File | Evidence source |
| --- | --- | --- |
| Home | `home-390x844.png` | accepted Home V2 final-polish evidence |
| Time Hub | `time-390x844.png` | accepted Time Hub V2 evidence |
| Schedule | `schedule-390x844.png` | accepted Schedule V2 evidence |
| Attendance History | `attendance-history-390x844.png` | accepted Attendance History V2 evidence |
| Timesheet | `timesheet-390x844.png` | accepted canonical Staff capture |
| Requests | `requests-390x844.png` | accepted Requests Hub V2 evidence |
| Leave | `leave-390x844.png` | accepted Leave V2 evidence |
| Claims | `claims-390x844.png` | accepted Claims V2 evidence |
| Attendance Corrections | `attendance-corrections-390x844.png` | accepted unified-read-model V2 evidence |
| Approval Center | `approval-center-390x844.png` | accepted Approval Center V2 normalization evidence |
| Pay | `pay-390x844.png` | accepted Pay Hub V2 evidence |
| Payslips | `payslips-390x844.png` | accepted Payslips V2 evidence |
| Commission | `commission-390x844.png` | accepted Commission V2 evidence |
| Profile | `profile-390x844.png` | closure live local browser capture |

## Responsive evidence

- 360×800: Home, Time, Requests, Leave, Claims, Attendance Corrections, Pay, Payslips, Commission and Profile.
- 412×915: all fourteen primary modules.
- Each phase report records `scrollWidth === innerWidth` at its validated widths and actionable targets of approximately 44px or larger. This closure visually rechecked Home, Timesheet, Approval Center and Profile and found no new overlap or hierarchy regression.

## Limitations

This pack is visual/layout evidence. Authorization, tenant isolation, money correctness and workflow ownership are proven by the automated and PostgreSQL integration evidence referenced in the global closure report. Images must not be treated as security proof.
