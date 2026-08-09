"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./vehicle-select-fields.module.css";

const OTHER = "__other__";

const BRAND_OPTIONS = [
  "Perodua",
  "Proton",
  "Toyota",
  "Honda",
  "Nissan",
  "Mazda",
  "Mitsubishi",
  "Isuzu",
  "Ford",
  "BMW",
  "Mercedes-Benz",
  "Hyundai",
  "Kia",
  "BYD",
  "Chery",
  "GWM",
  "Jaecoo",
];

const MODEL_OPTIONS: Record<string, string[]> = {
  Perodua: ["Myvi", "Axia", "Bezza", "Alza", "Ativa", "Aruz", "Viva", "Kelisa", "Kancil"],
  Proton: ["Saga", "Persona", "Iriz", "X50", "X70", "X90", "S70", "Exora", "Wira", "Waja"],
  Toyota: ["Vios", "Yaris", "Corolla", "Camry", "Hilux", "Fortuner", "Innova", "Alphard", "Vellfire", "Avanza"],
  Honda: ["City", "Civic", "Accord", "Jazz", "HR-V", "CR-V", "BR-V", "WR-V"],
  Nissan: ["Almera", "Serena", "X-Trail", "Navara", "Kicks", "Teana", "Sylphy"],
  Mazda: ["Mazda 2", "Mazda 3", "Mazda 6", "CX-3", "CX-5", "CX-8", "CX-30"],
  Mitsubishi: ["Triton", "Xpander", "Outlander", "ASX", "Pajero Sport"],
  Isuzu: ["D-Max", "MU-X"],
  Ford: ["Ranger", "Everest", "Mustang", "Focus", "Fiesta"],
  BMW: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "7 Series", "X1", "X3", "X5", "X7"],
  "Mercedes-Benz": ["A-Class", "C-Class", "E-Class", "S-Class", "CLA", "GLA", "GLC", "GLE"],
  Hyundai: ["Accent", "Elantra", "Sonata", "Kona", "Tucson", "Santa Fe", "Staria"],
  Kia: ["Picanto", "Cerato", "Sportage", "Sorento", "Carnival", "EV6"],
  BYD: ["Atto 3", "Dolphin", "Seal", "M6"],
  Chery: ["Omoda 5", "Tiggo 7 Pro", "Tiggo 8 Pro"],
  GWM: ["Haval H6", "Haval Jolion", "Ora Good Cat", "Tank 300"],
  Jaecoo: ["J7", "J8"],
};

const COLOR_OPTIONS = [
  { label: "White", swatch: "#f8fafc" },
  { label: "Black", swatch: "#17191d" },
  { label: "Silver", swatch: "#b8bec7" },
  { label: "Grey", swatch: "#727985" },
  { label: "Red", swatch: "#d94b4b" },
  { label: "Blue", swatch: "#3778d0" },
  { label: "Green", swatch: "#3d8b62" },
  { label: "Yellow", swatch: "#e7c73d" },
  { label: "Brown", swatch: "#795548" },
  { label: "Gold", swatch: "#caa44d" },
  { label: "Orange", swatch: "#e98332" },
  { label: "Purple", swatch: "#8056a8" },
];

type Picker = "brand" | "model" | "color" | null;

type VehicleSelectFieldsProps = {
  brandName?: string;
  colorName?: string;
  compact?: boolean;
  defaultBrand?: string | null;
  defaultColor?: string | null;
  defaultModel?: string | null;
  modelName?: string;
  onChange?: (values: { brand: string; color: string; model: string }) => void;
};

function initialChoice(value: string | null | undefined, options: string[]) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { choice: "", custom: "" };
  const listed = options.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  return listed ? { choice: listed, custom: "" } : { choice: OTHER, custom: trimmed };
}

export function VehicleSelectFields({
  brandName = "brand",
  colorName = "color",
  compact = false,
  defaultBrand,
  defaultColor,
  defaultModel,
  modelName = "model",
  onChange,
}: VehicleSelectFieldsProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialBrand = initialChoice(defaultBrand, BRAND_OPTIONS);
  const [brand, setBrand] = useState(initialBrand.choice);
  const [customBrand, setCustomBrand] = useState(initialBrand.custom);
  const listedBrand = brand === OTHER ? "" : brand;
  const availableModels = useMemo(() => MODEL_OPTIONS[listedBrand] ?? [], [listedBrand]);
  const initialModel = initialChoice(defaultModel, availableModels);
  const initialColor = initialChoice(defaultColor, COLOR_OPTIONS.map((option) => option.label));
  const [model, setModel] = useState(initialModel.choice);
  const [customModel, setCustomModel] = useState(initialModel.custom);
  const [color, setColor] = useState(initialColor.choice);
  const [customColor, setCustomColor] = useState(initialColor.custom);
  const [picker, setPicker] = useState<Picker>(null);
  const [query, setQuery] = useState("");
  const id = useId();

  const submittedBrand = brand === OTHER ? customBrand.trim() : brand;
  const submittedModel = model === OTHER ? customModel.trim() : model;
  const submittedColor = color === OTHER ? customColor.trim() : color;

  useEffect(() => {
    onChangeRef.current?.({
      brand: submittedBrand,
      color: submittedColor,
      model: submittedModel,
    });
  }, [submittedBrand, submittedColor, submittedModel]);

  const pickerOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const options =
      picker === "brand"
        ? BRAND_OPTIONS
        : picker === "model"
          ? availableModels
          : COLOR_OPTIONS.map((option) => option.label);
    return [...options, OTHER].filter((option) =>
      (option === OTHER ? "other not listed" : option).toLowerCase().includes(needle),
    );
  }, [availableModels, picker, query]);

  function openPicker(next: Exclude<Picker, null>) {
    if (next === "model" && !brand) return;
    setPicker(next);
    setQuery("");
  }

  function selectOption(option: string) {
    if (picker === "brand") {
      setBrand(option);
      setCustomBrand("");
      setModel("");
      setCustomModel("");
    } else if (picker === "model") {
      setModel(option);
      setCustomModel("");
    } else if (picker === "color") {
      setColor(option);
      setCustomColor("");
    }
    setPicker(null);
  }

  const colorSwatch = COLOR_OPTIONS.find((option) => option.label === color)?.swatch;

  return (
    <div className={`${styles.fields} ${compact ? styles.compact : ""}`}>
      <input name={brandName} type="hidden" value={submittedBrand} />
      <input name={modelName} type="hidden" value={submittedModel} />
      <input name={colorName} type="hidden" value={submittedColor} />

      <div className={styles.field}>
        <span id={`${id}-brand`}>Vehicle Brand <small>optional</small></span>
        <button aria-labelledby={`${id}-brand`} onClick={() => openPicker("brand")} type="button">
          <b className={brand ? styles.value : styles.placeholder}>
            {brand === OTHER ? customBrand || "Other / Brand not listed" : brand || "Select vehicle brand"}
          </b>
          <i className={styles.chevron} aria-hidden="true" />
        </button>
        {brand === OTHER ? (
          <input
            aria-label="Custom vehicle brand"
            onChange={(event) => setCustomBrand(event.target.value)}
            placeholder="Custom vehicle brand"
            value={customBrand}
          />
        ) : null}
      </div>

      <div className={styles.field}>
        <span id={`${id}-model`}>Vehicle Model <small>optional</small></span>
        <button
          aria-labelledby={`${id}-model`}
          disabled={!brand}
          onClick={() => openPicker("model")}
          type="button"
        >
          <b className={model ? styles.value : styles.placeholder}>
            {!brand
              ? "Select vehicle brand first"
              : model === OTHER
                ? customModel || "Other / Model not listed"
                : model || "Select vehicle model"}
          </b>
          <i className={styles.chevron} aria-hidden="true" />
        </button>
        {model === OTHER ? (
          <input
            aria-label="Custom vehicle model"
            onChange={(event) => setCustomModel(event.target.value)}
            placeholder="Custom vehicle model"
            value={customModel}
          />
        ) : null}
      </div>

      <div className={styles.field}>
        <span id={`${id}-color`}>Vehicle Color <small>optional</small></span>
        <button aria-labelledby={`${id}-color`} onClick={() => openPicker("color")} type="button">
          <b className={`${color ? styles.value : styles.placeholder} ${styles.colorValue}`}>
            {colorSwatch ? <em style={{ backgroundColor: colorSwatch }} /> : null}
            {color === OTHER ? customColor || "Other / Color not listed" : color || "Select vehicle color"}
          </b>
          <i className={styles.chevron} aria-hidden="true" />
        </button>
        {color === OTHER ? (
          <input
            aria-label="Custom vehicle color"
            onChange={(event) => setCustomColor(event.target.value)}
            placeholder="Custom vehicle color"
            value={customColor}
          />
        ) : null}
      </div>

      {picker ? (
        <div className={styles.backdrop} onMouseDown={() => setPicker(null)} role="presentation">
          <section
            aria-labelledby={`${id}-picker-title`}
            aria-modal="true"
            className={styles.picker}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <button aria-label="Close picker" onClick={() => setPicker(null)} type="button">x</button>
              <h3 id={`${id}-picker-title`}>Select vehicle {picker}</h3>
              <span />
            </header>
            <div className={styles.search}>
              <span aria-hidden="true" />
              <input
                aria-label={`Search vehicle ${picker}`}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${picker}`}
                value={query}
              />
            </div>
            <div className={styles.options} role="listbox">
              {pickerOptions.map((option) => {
                const swatch = picker === "color"
                  ? COLOR_OPTIONS.find((item) => item.label === option)?.swatch
                  : undefined;
                return (
                  <button
                    aria-selected={
                      picker === "brand"
                        ? brand === option
                        : picker === "model"
                          ? model === option
                          : color === option
                    }
                    key={option}
                    onClick={() => selectOption(option)}
                    role="option"
                    type="button"
                  >
                    {swatch ? <em style={{ backgroundColor: swatch }} /> : null}
                    <span>{option === OTHER ? `Other / ${picker} not listed` : option}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
