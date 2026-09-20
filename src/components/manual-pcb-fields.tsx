import { PayrollHighRiskMfaFields } from "./payroll-high-risk-mfa-fields";

export function ManualPcbFields({ historical = false }: { historical?: boolean }) {
  return <fieldset>
    <legend>Confirm PCB amount · 人工确认</legend>
    <p>Enter the externally reviewed amount, including zero. This is a manual payroll deduction source, not an official tax calculation or government submission.</p>
    {historical && <><p>The original payslip remains unchanged. This creates a corrected version. The difference is a prior-period adjustment, not proof of payment.</p><label><span>Correction reason</span><textarea name="reason" minLength={5} maxLength={500} required /></label></>}
    <label><span>PCB amount (RM)</span><input name="amount" inputMode="decimal" type="number" min="0" max="9999999999.99" step="0.01" required /></label>
    <label><span>External evidence / reference</span><input name="externalReference" minLength={5} maxLength={500} required /><small>Use an audit reference. Do not enter passwords, access codes or bank credentials.</small></label>
    <label><input name="confirmed" type="checkbox" value="yes" required />I confirm this amount and evidence for the displayed employee, month and payroll revision.</label>
    <p>{historical ? "Published history stays frozen. Staff will see the corrected version; all versions remain in audit history. If no open payroll is available or the employee has left, the difference remains unsettled for Payroll to handle with evidence." : "Changing draft payroll inputs or tax information requires a new confirmation. Previous confirmations remain in the audit history."}</p>
    <PayrollHighRiskMfaFields actionLabel={historical ? "Publish PCB correction" : "Confirm manual PCB"} />
  </fieldset>;
}
