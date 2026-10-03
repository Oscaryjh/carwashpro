"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatCents, parseMoneyToCents } from "@/lib/commercial/money";

type ServiceChoice = { id: string; name: string; price?: string; disabled?: boolean };
type ServiceGroup = [string, ServiceChoice[]];

// Package-only select presentation. The native field retains the existing
// successful-control payload and browser constraint-validation contract.
export function PackageServiceDropdown({
  name, value, onChange, groups, label, required = false, placeholder = "Select service",
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  groups: ServiceGroup[];
  label: string;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const [invalid, setInvalid] = useState(false);
  const choices = groups.flatMap(([, items]) => items);
  const selected = choices.find(item => item.id === value);
  const available = [
    ...(!required ? [{ id: "", name: placeholder }] : []),
    ...choices.filter(item => !item.disabled),
  ];

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  function show(direction = 1) {
    setActive(available.find(item => item.id === value)?.id ?? available[direction < 0 ? available.length - 1 : 0]?.id ?? "");
    setOpen(true);
  }

  function select(item: ServiceChoice) {
    if (item.disabled) return;
    onChange(item.id);
    setInvalid(false);
    setOpen(false);
    trigger.current?.focus();
  }

  function rowContent(item: ServiceChoice) {
    return <>
      <span className="package-service-name" title={item.name}>{item.name}</span>
      <span className="package-service-price">{item.price === undefined ? "Price unavailable" : formatCents(parseMoneyToCents(item.price))}</span>
    </>;
  }

  function option(item: ServiceChoice, index: number) {
    return <span key={item.id} id={`${id}-option-${index}`}
      role="option" aria-selected={value === item.id} aria-disabled={!!item.disabled}
      className="package-service-option" data-active={active === item.id}
      onMouseDown={event => event.preventDefault()}
      onMouseMove={() => { if (!item.disabled) setActive(item.id); }}
      onClick={() => select(item)}>
      {item.id ? rowContent(item) : <span className="package-service-name">{placeholder}</span>}
    </span>;
  }
  const activeIndex = choices.findIndex(item => item.id === active);

  return <span className="package-service-dropdown" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <select className="package-service-native" name={name} value={value}
      required={required} tabIndex={-1} aria-hidden="true"
      onChange={event => { onChange(event.target.value); setInvalid(false); }}
      onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }}>
      <option value="" disabled={required}>{placeholder}</option>
      {groups.map(([category, items]) => <optgroup key={category} label={category}>
        {items.map(item => <option key={item.id} value={item.id} disabled={item.disabled}>
          {item.name}
        </option>)}
      </optgroup>)}
    </select>
    <button ref={trigger} type="button" role="combobox" className="package-service-trigger"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? `${id}-list` : undefined}
      aria-activedescendant={open && (activeIndex >= 0 || !required) ? `${id}-option-${activeIndex}` : undefined}
      aria-required={required} aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onClick={() => { if (open) setOpen(false); else show(); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          if (!open) show(direction);
          else {
            const index = available.findIndex(item => item.id === active);
            const next = Math.min(available.length - 1, Math.max(0, index + direction));
            setActive(available[next]?.id ?? "");
          }
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!open) show();
          else {
            const item = available.find(item => item.id === active);
            if (item) select(item);
          }
        } else if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        } else if (event.key === "Tab") setOpen(false);
      }}>
      <span className="package-service-trigger-value">
        {selected ? rowContent(selected) : <span className="package-service-name">{placeholder}</span>}
      </span>
      <span aria-hidden="true" className="package-service-chevron">⌄</span>
    </button>
    {open ? <span className="package-service-list" role="listbox" id={`${id}-list`} aria-label={label} ref={list}>
      {!required ? option({ id: "", name: placeholder }, -1) : null}
      {groups.map(([category, items]) => <span role="group" aria-label={category} key={category}>
        <span className="package-service-category">{category}</span>
        {items.map(item => option(item, choices.indexOf(item)))}
      </span>)}
    </span> : null}
    {invalid ? <span className="package-service-error" role="alert" id={`${id}-error`}>Select a service.</span> : null}
  </span>;
}
