"use client";

import { useMemo, useState } from "react";
import styles from "./vehicle-fields-preview.module.css";

const OTHER = "__other__";

const BRANDS = [
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

const MODELS: Record<string, string[]> = {
  Perodua: ["Myvi", "Axia", "Bezza", "Alza", "Ativa", "Aruz", "Viva", "Kelisa", "Kancil"],
  Proton: ["Saga", "Persona", "Iriz", "X50", "X70", "X90", "S70", "Exora"],
  Toyota: ["Vios", "Yaris", "Corolla", "Camry", "Hilux", "Fortuner", "Innova", "Alphard", "Vellfire", "Avanza"],
  Honda: ["City", "Civic", "Accord", "Jazz", "HR-V", "CR-V", "BR-V", "WR-V"],
  Nissan: ["Almera", "Serena", "X-Trail", "Navara", "Kicks"],
  Mazda: ["Mazda 2", "Mazda 3", "Mazda 6", "CX-3", "CX-5", "CX-8", "CX-30"],
};

const COLORS = [
  { name: "White", value: "#f8fafc", border: true },
  { name: "Black", value: "#17191d" },
  { name: "Silver", value: "#b8bec7" },
  { name: "Grey", value: "#727985" },
  { name: "Red", value: "#d94b4b" },
  { name: "Blue", value: "#3778d0" },
  { name: "Green", value: "#3d8b62" },
  { name: "Yellow", value: "#e7c73d" },
  { name: "Brown", value: "#795548" },
  { name: "Gold", value: "#caa44d" },
  { name: "Orange", value: "#e98332" },
  { name: "Purple", value: "#8056a8" },
];

type OpenField = "brand" | "model" | "color" | null;
type Scenario = "compact" | "empty" | "perodua" | "other" | "color" | "complete";

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: "compact", label: "Compact card" },
  { id: "empty", label: "No brand selected" },
  { id: "perodua", label: "Perodua models" },
  { id: "other", label: "Other brand" },
  { id: "color", label: "Color options" },
  { id: "complete", label: "Completed form" },
];

function displayValue(value: string, otherLabel: string) {
  return value === OTHER ? otherLabel : value;
}

export function VehicleFieldsPreview() {
  const [scenario, setScenario] = useState<Scenario>("compact");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [customBrand, setCustomBrand] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customColor, setCustomColor] = useState("");
  const [openField, setOpenField] = useState<OpenField>(null);
  const [query, setQuery] = useState("");

  const modelOptions = useMemo(() => {
    if (!brand) return [];
    if (brand === OTHER) return [];
    return MODELS[brand] ?? [];
  }, [brand]);

  function open(field: Exclude<OpenField, null>) {
    if (field === "model" && !brand) return;
    setOpenField((current) => (current === field ? null : field));
    setQuery("");
  }

  function applyScenario(next: Scenario) {
    setScenario(next);
    setQuery("");
    setCustomBrand("");
    setCustomModel("");
    setCustomColor("");

    if (next === "compact" || next === "empty") {
      setBrand("");
      setModel("");
      setColor("");
      setOpenField(null);
    } else if (next === "perodua") {
      setBrand("Perodua");
      setModel("");
      setColor("");
      setOpenField("model");
    } else if (next === "other") {
      setBrand(OTHER);
      setModel("");
      setColor("");
      setOpenField(null);
    } else if (next === "color") {
      setBrand("Toyota");
      setModel("Vios");
      setColor("");
      setOpenField("color");
    } else {
      setBrand("Perodua");
      setModel("Myvi");
      setColor("Silver");
      setOpenField(null);
    }
  }

  const filteredBrands = BRANDS.filter((item) =>
    item.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredModels = modelOptions.filter((item) =>
    item.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredColors = COLORS.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>UI preview only</span>
            <h1>Vehicle details</h1>
            <p>Preview a consistent way to select vehicle brand, model, and color.</p>
          </div>
          <div className={styles.previewBadge}>No data will be saved</div>
        </header>

        <section className={styles.stateSection} aria-label="Preview states">
          <span className={styles.stateLabel}>Preview state</span>
          <div className={styles.stateSwitch}>
            {SCENARIOS.map((item) => (
              <button
                className={scenario === item.id ? styles.stateActive : styles.stateButton}
                key={item.id}
                onClick={() => applyScenario(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section
          className={`${styles.formPanel} ${scenario === "compact" ? styles.compactFormPanel : ""}`}
          data-testid="vehicle-preview-panel"
        >
          {scenario === "compact" ? (
            <div className={styles.compactCustomerHeader}>
              <h2>New Customer</h2>
              <div className={styles.compactBaseFields}>
                <label>
                  <span>Phone</span>
                  <input placeholder="Phone number" type="tel" />
                </label>
                <label>
                  <span>Name</span>
                  <input placeholder="Customer name" />
                </label>
                <label>
                  <span>Plate number</span>
                  <input defaultValue="SS654" />
                </label>
              </div>
            </div>
          ) : (
            <div className={styles.formHeading}>
              <div>
                <h2>Vehicle information</h2>
                <p>Choose standardized values. Use Other only when a value is not listed.</p>
              </div>
              <span>Optional</span>
            </div>
          )}

          <div className={`${styles.fieldGrid} ${scenario === "compact" ? styles.compactFieldGrid : ""}`}>
            <div className={styles.field}>
              <label id="brand-label">Vehicle Brand <span>optional</span></label>
              <button
                aria-expanded={openField === "brand"}
                aria-labelledby="brand-label"
                className={styles.selectControl}
                data-testid="brand-control"
                onClick={() => open("brand")}
                type="button"
              >
                <span className={brand ? styles.value : styles.placeholder}>
                  {brand ? displayValue(brand, "Other / Brand not listed") : "Select vehicle brand"}
                </span>
                <i aria-hidden="true" className={styles.chevron} />
              </button>
              <small>Search or select a common vehicle brand.</small>

              {openField === "brand" ? (
                <div className={styles.dropdown} data-testid="brand-dropdown">
                  <div className={styles.searchBox}>
                    <i aria-hidden="true" className={styles.searchIcon} />
                    <input
                      aria-label="Search vehicle brands"
                      autoFocus
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search brand"
                      value={query}
                    />
                  </div>
                  <div className={styles.optionList} role="listbox">
                    {filteredBrands.map((item) => (
                      <button
                        className={brand === item ? styles.optionSelected : styles.option}
                        key={item}
                        onClick={() => {
                          setBrand(item);
                          setModel("");
                          setCustomBrand("");
                          setOpenField(null);
                        }}
                        role="option"
                        type="button"
                      >
                        <span>{item}</span>
                        {brand === item ? <b aria-hidden="true">OK</b> : null}
                      </button>
                    ))}
                    <button
                      className={brand === OTHER ? styles.optionSelected : styles.otherOption}
                      onClick={() => {
                        setBrand(OTHER);
                        setModel("");
                        setOpenField(null);
                      }}
                      role="option"
                      type="button"
                    >
                      <span>Other / Brand not listed</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {brand === OTHER ? (
                <label className={styles.customField}>
                  <span>Custom vehicle brand</span>
                  <input
                    onChange={(event) => setCustomBrand(event.target.value)}
                    placeholder="Enter vehicle brand"
                    value={customBrand}
                  />
                </label>
              ) : null}
            </div>

            <div className={styles.field}>
              <label id="model-label">Vehicle Model <span>optional</span></label>
              <button
                aria-expanded={openField === "model"}
                aria-labelledby="model-label"
                className={styles.selectControl}
                data-testid="model-control"
                disabled={!brand}
                onClick={() => open("model")}
                type="button"
              >
                <span className={model ? styles.value : styles.placeholder}>
                  {!brand
                    ? "Select vehicle brand first"
                    : model
                      ? displayValue(model, "Other / Model not listed")
                      : "Select vehicle model"}
                </span>
                <i aria-hidden="true" className={styles.chevron} />
              </button>
              <small>{brand ? "Models are filtered by the selected brand." : "Choose a brand to enable this field."}</small>

              {openField === "model" ? (
                <div className={styles.dropdown} data-testid="model-dropdown">
                  <div className={styles.searchBox}>
                    <i aria-hidden="true" className={styles.searchIcon} />
                    <input
                      aria-label="Search vehicle models"
                      autoFocus
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search model"
                      value={query}
                    />
                  </div>
                  <div className={styles.optionList} role="listbox">
                    {filteredModels.map((item) => (
                      <button
                        className={model === item ? styles.optionSelected : styles.option}
                        key={item}
                        onClick={() => {
                          setModel(item);
                          setCustomModel("");
                          setOpenField(null);
                        }}
                        role="option"
                        type="button"
                      >
                        <span>{item}</span>
                        {model === item ? <b aria-hidden="true">OK</b> : null}
                      </button>
                    ))}
                    <button
                      className={model === OTHER ? styles.optionSelected : styles.otherOption}
                      onClick={() => {
                        setModel(OTHER);
                        setOpenField(null);
                      }}
                      role="option"
                      type="button"
                    >
                      <span>Other / Model not listed</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {model === OTHER ? (
                <label className={styles.customField}>
                  <span>Custom vehicle model</span>
                  <input
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder="Enter vehicle model"
                    value={customModel}
                  />
                </label>
              ) : null}
            </div>

            <div className={styles.field}>
              <label id="color-label">Vehicle Color <span>optional</span></label>
              <button
                aria-expanded={openField === "color"}
                aria-labelledby="color-label"
                className={styles.selectControl}
                data-testid="color-control"
                onClick={() => open("color")}
                type="button"
              >
                <span className={styles.colorValue}>
                  {color && color !== OTHER ? (
                    <i
                      aria-hidden="true"
                      className={styles.colorDot}
                      style={{ background: COLORS.find((item) => item.name === color)?.value }}
                    />
                  ) : null}
                  <span className={color ? styles.value : styles.placeholder}>
                    {color ? displayValue(color, "Other color") : "Select vehicle color"}
                  </span>
                </span>
                <i aria-hidden="true" className={styles.chevron} />
              </button>
              <small>Use a standard color for cleaner customer records.</small>

              {openField === "color" ? (
                <div className={styles.dropdown} data-testid="color-dropdown">
                  <div className={styles.searchBox}>
                    <i aria-hidden="true" className={styles.searchIcon} />
                    <input
                      aria-label="Search vehicle colors"
                      autoFocus
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search color"
                      value={query}
                    />
                  </div>
                  <div className={styles.colorGrid} role="listbox">
                    {filteredColors.map((item) => (
                      <button
                        className={color === item.name ? styles.colorSelected : styles.colorOption}
                        key={item.name}
                        onClick={() => {
                          setColor(item.name);
                          setCustomColor("");
                          setOpenField(null);
                        }}
                        role="option"
                        type="button"
                      >
                        <i
                          aria-hidden="true"
                          className={item.border ? styles.lightColorDot : styles.colorDot}
                          style={{ background: item.value }}
                        />
                        <span>{item.name}</span>
                      </button>
                    ))}
                    <button
                      className={color === OTHER ? styles.colorSelected : styles.colorOption}
                      onClick={() => {
                        setColor(OTHER);
                        setOpenField(null);
                      }}
                      role="option"
                      type="button"
                    >
                      <i aria-hidden="true" className={styles.multiColorDot} />
                      <span>Other</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {color === OTHER ? (
                <label className={styles.customField}>
                  <span>Custom vehicle color</span>
                  <input
                    onChange={(event) => setCustomColor(event.target.value)}
                    placeholder="Enter vehicle color"
                    value={customColor}
                  />
                </label>
              ) : null}
            </div>
          </div>

          {scenario === "compact" ? (
            <button aria-disabled="true" className={styles.compactSubmit} type="button">
              Create customer / Add vehicle
            </button>
          ) : (
            <div className={styles.summary}>
              <div>
                <span>Preview result</span>
                <strong>
                  {[brand === OTHER ? customBrand || "Custom brand" : brand || "No brand",
                    model === OTHER ? customModel || "Custom model" : model || "No model",
                    color === OTHER ? customColor || "Custom color" : color || "No color"].join(" / ")}
                </strong>
              </div>
              <button type="button" disabled>Preview only</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
