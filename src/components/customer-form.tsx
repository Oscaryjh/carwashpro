type CustomerFormProps = {
  action: (formData: FormData) => Promise<void>;
};

export function CustomerForm({ action }: CustomerFormProps) {
  return (
    <form action={action} className="form">
      <div className="field-grid">
        <label>
          <span>Name</span>
          <input name="name" required />
        </label>
        <label>
          <span>Phone</span>
          <input name="phone" required />
        </label>
        <label>
          <span>Email optional</span>
          <input name="email" type="email" />
        </label>
      </div>
      <label>
        <span>Notes optional</span>
        <textarea name="notes" rows={3} />
      </label>
      <div className="form-actions">
        <button type="submit">Create customer</button>
      </div>
    </form>
  );
}
