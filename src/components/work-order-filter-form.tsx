"use client";

type WorkOrderFilterFormProps = {
  date: string;
  dateFilters: readonly {
    label: string;
    value: string;
  }[];
  rawSearch: string;
  scope: string;
};

export function WorkOrderFilterForm({
  date,
  dateFilters,
  rawSearch,
  scope,
}: WorkOrderFilterFormProps) {
  return (
    <form className="search-form work-order-filter-form" action="/work-orders">
      <input type="hidden" name="scope" value={scope} />
      <input
        name="q"
        placeholder="Search plate, customer, or phone"
        defaultValue={rawSearch}
      />
      <select
        name="date"
        defaultValue={date}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {dateFilters.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </form>
  );
}
