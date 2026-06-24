type PaymentFormProps = {
  action: (formData: FormData) => Promise<void>;
  workOrderId: string;
  balance: number;
};

export function PaymentForm({ action, workOrderId, balance }: PaymentFormProps) {
  return (
    <form action={action} className="form">
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <div className="field-grid">
        <label>
          <span>Payment amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            max={balance.toFixed(2)}
            defaultValue={balance.toFixed(2)}
            required
          />
        </label>
        <label>
          <span>Payment method</span>
          <select name="method" defaultValue="CASH" required>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="DUITNOW">DuitNow</option>
            <option value="EWALLET">E-wallet</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </label>
        <label>
          <span>Reference optional</span>
          <input name="reference" />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit">Record payment</button>
      </div>
    </form>
  );
}
