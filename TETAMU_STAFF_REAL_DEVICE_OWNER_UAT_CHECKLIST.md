# TETAMU STAFF REAL DEVICE OWNER UAT CHECKLIST

Testing link: **https://tetamu-staff-app-testing.up.railway.app/staff**

Use only the two phones below. This is the Testing system, not Production.

For every step, tick one result:

- `[ ] PASS`
- `[ ] FAIL`
- `[ ] CONFUSING`
- `[ ] NOT AVAILABLE`

If a step is FAIL or CONFUSING, record only:

- Phone:
- Screen:
- What you tapped:
- What you expected:
- What happened:
- Screenshot name, if any:

## Before starting

- Use the HTTPS link above, not localhost and not an IP address.
- OTP is a real Testing SMS sent by SMS123. Request one code and wait; do not tap resend repeatedly.
- On both phones choose **Royal Salon** and confirm the Branch is **salon online**.
- On Android, do not choose the separate **Payroll UAT Business** membership.
- Leave the iPhone signed in until all Android approval steps are complete.

## IPHONE — 01112212259

1. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open the Testing Staff link.
2. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Enter `01112212259`.
3. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Complete the SMS OTP.
4. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Choose/confirm **Royal Salon · salon online**.
5. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm Approval Center is not shown and cannot be opened.
6. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check Home and confirm the employee is **Real Device UAT Employee**.
7. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check Today's Schedule: **Mobile UAT Shift**, 08:00–23:00.
8. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Allow location/GPS when asked.
9. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Clock In.
10. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Start Break.
11. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` End Break.
12. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Clock Out.
13. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open Attendance History.
14. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open Timesheet and check today's result.
15. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Apply for a future Annual Leave day and submit it.
16. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Submit a General Claim with amount, description and a phone photo/file. Do not expect Paid status.
17. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` In Attendance History, submit a missing clock-out correction for **24 Aug 2026**.
18. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check Pay. It may correctly show no published information.
19. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open Payslip. Mark **NOT AVAILABLE** if there is no published payslip.
20. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check Commission. Mark **NOT AVAILABLE** if there is no statement.
21. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check Appointments. Two appointments should be visible today; private phone/notes and other staff appointments must not appear.
22. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check Profile.
23. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Keep the iPhone signed in. Do not log out yet.

## ANDROID — 0128793848

24. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open the same Testing Staff link.
25. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Enter `0128793848`.
26. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Complete the SMS OTP.
27. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Choose **Royal Salon**, then confirm **salon online**. Do not choose Payroll UAT Business.
28. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm **Needs My Approval** is visible.
29. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open Approval Center.
30. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check All, Leave, Claims, Attendance and OT tabs.
31. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Review the iPhone employee's Leave request and choose a decision.
32. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Review the iPhone employee's Claim and approve it. Do not mark it Paid.
33. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Review the iPhone employee's Attendance correction.
34. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm Attendance shows 1 pending before opening, and 1 matching item inside.
35. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open one OT item and approve the full minutes.
36. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open a second OT item and approve with adjusted minutes.
37. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Open a third OT item and reject it with a reason.
38. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm there is no request submitted by this same Android manager for self-review.

## BACK TO IPHONE

39. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Refresh Leave.
40. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm the manager's Leave decision appears.
41. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Refresh Claims.
42. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm the Claim approval appears.
43. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm the approved Claim does not incorrectly say Paid.
44. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Refresh the Attendance correction.
45. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Confirm the manager's Attendance decision appears.
46. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Check Timesheet / OT result where relevant.
47. `[ ] PASS  [ ] FAIL  [ ] CONFUSING  [ ] NOT AVAILABLE` Log out of the iPhone Staff App.

## Result summary

| Result | Count |
|---|---:|
| PASS | |
| FAIL | |
| CONFUSING | |
| NOT AVAILABLE | |

### Main problems found

- 
- 
- 
