"use client";

import { useState } from "react";

import styles from "./holidays.module.css";

type HolidaySource = "OFFICIAL" | "CUSTOM";

export function HolidaySourceFields({
  defaultOfficialReference,
  defaultSource,
}: {
  defaultOfficialReference?: string | null;
  defaultSource: HolidaySource;
}) {
  const [source, setSource] = useState<HolidaySource>(defaultSource);

  return (
    <>
      <label>
        <span>Holiday source</span>
        <select
          name="source"
          onChange={(event) => setSource(event.target.value as HolidaySource)}
          value={source}
        >
          <option value="OFFICIAL">Government official holiday</option>
          <option value="CUSTOM">Company-defined holiday</option>
        </select>
      </label>
      {source === "OFFICIAL" ? (
        <label className={styles.wide}>
          <span>Government source URL</span>
          <input
            defaultValue={defaultOfficialReference ?? ""}
            maxLength={500}
            name="officialReference"
            placeholder="Paste the official government page URL"
            required
            type="url"
          />
          <small>Required only for government official holidays.</small>
        </label>
      ) : null}
    </>
  );
}
