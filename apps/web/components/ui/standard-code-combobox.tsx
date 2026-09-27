"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getStandardOptions,
  type StandardCodeKind,
} from "../../lib/standard-options";
import type { UiLanguage } from "../../lib/ui-language";

type Props = {
  kind: StandardCodeKind;
  uiLanguage: UiLanguage;
  id: string;
  name: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  date?: string;
  optional?: boolean;
  disabled?: boolean;
};

export function StandardCodeCombobox({
  kind,
  uiLanguage,
  id,
  name,
  defaultValue = "",
  value,
  onValueChange,
  date,
  optional = false,
  disabled = false,
}: Props) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selected = value ?? internalValue;
  const options = useMemo(
    () => getStandardOptions(kind, uiLanguage, selected, date),
    [kind, uiLanguage, selected, date],
  );
  const [query, setQuery] = useState(
    () =>
      getStandardOptions(kind, uiLanguage, value ?? defaultValue, date).find(
        (item) => item.value === (value ?? defaultValue),
      )?.label ?? "",
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastWrittenValue = useRef(value);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(uiLanguage);
    return options
      .filter(
        (item) =>
          !needle ||
          `${item.label} ${item.value}`
            .toLocaleLowerCase(uiLanguage)
            .includes(needle),
      )
      .slice(0, 40);
  }, [options, query, uiLanguage]);

  useEffect(() => {
    if (value !== undefined && value !== lastWrittenValue.current) {
      setQuery(options.find((item) => item.value === value)?.label ?? "");
      lastWrittenValue.current = value;
    }
  }, [value, options]);
  useEffect(() => {
    const current = selectedRef.current;
    if (current)
      setQuery(
        getStandardOptions(kind, uiLanguage, current, date).find(
          (item) => item.value === current,
        )?.label ?? "",
      );
  }, [kind, uiLanguage, date]);
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      selected || optional
        ? ""
        : uiLanguage === "th"
          ? "กรุณาเลือกจากรายการ"
          : "Please select from the list",
    );
  }, [selected, optional, uiLanguage]);

  function choose(next: string) {
    if (value === undefined) setInternalValue(next);
    lastWrittenValue.current = next;
    onValueChange?.(next);
    setQuery(options.find((item) => item.value === next)?.label ?? "");
    setOpen(false);
    setActive(0);
  }

  return (
    <div className="relative min-w-0">
      <input type="hidden" name={name} value={selected} />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && filtered[active] ? `${listId}-${active}` : undefined
        }
        className="w-full rounded border border-[#d7beb5] bg-white p-2 text-[#402d35] focus-visible:outline-2 focus-visible:outline-[#7d4152]"
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          if (selected) {
            if (value === undefined) setInternalValue("");
            lastWrittenValue.current = "";
            onValueChange?.("");
          }
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              Math.min(current + (open ? 1 : 0), filtered.length - 1),
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.max(current - 1, 0));
            return;
          }
          if (event.key === "Enter" && open && filtered[active]) {
            event.preventDefault();
            choose(filtered[active].value);
          }
        }}
      />
      {open && filtered.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded border border-[#d7beb5] bg-white p-1 shadow-lg"
        >
          {filtered.map((item, index) => (
            <button
              id={`${listId}-${index}`}
              key={item.value}
              type="button"
              role="option"
              aria-selected={item.value === selected}
              className={`block w-full rounded px-3 py-2 text-left text-sm ${index === active ? "bg-[#f8e9ed]" : "hover:bg-[#fff3f5]"}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
