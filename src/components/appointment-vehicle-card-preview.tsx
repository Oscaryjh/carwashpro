"use client";

import { useMemo, useState } from "react";
import styles from "./appointment-vehicle-card-preview.module.css";

const OTHER = "Other";

const brands = [
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

const models: Record<string, string[]> = {
  Perodua: ["Myvi", "Axia", "Bezza", "Alza", "Ativa", "Aruz", "Viva", "Kelisa", "Kancil"],
  Proton: ["Saga", "Persona", "Iriz", "X50", "X70", "X90", "S70", "Exora"],
  Toyota: ["Vios", "Yaris", "Corolla", "Camry", "Hilux", "Fortuner", "Innova", "Alphard", "Vellfire", "Avanza"],
  Honda: ["City", "Civic", "Accord", "Jazz", "HR-V", "CR-V", "BR-V", "WR-V"],
};

const colors = [
  ["White", "#f8fafc"],
  ["Black", "#17191d"],
  ["Silver", "#b8bec7"],
  ["Grey", "#727985"],
  ["Red", "#d94b4b"],
  ["Blue", "#3778d0"],
  ["Green", "#3d8b62"],
  ["Yellow", "#e7c73d"],
  ["Brown", "#795548"],
  ["Gold", "#caa44d"],
  ["Orange", "#e98332"],
  ["Purple", "#8056a8"],
] as const;

type Screen = "appointment" | "vehicle";
type Picker = "brand" | "model" | "color" | null;

function PickerIcon({ type }: { type: "calendar" | "customer" | "vehicle" | "service" }) {
  const labels = { calendar: "31", customer: "C", vehicle: "V", service: "+" };
  return <span className={`${styles.icon} ${styles[`icon${type}`]}`}>{labels[type]}</span>;
}

export function AppointmentVehicleCardPreview() {
  const [screen, setScreen] = useState<Screen>("appointment");
  const [picker, setPicker] = useState<Picker>(null);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("Perodua");
  const [model, setModel] = useState("Alza");
  const [color, setColor] = useState("Grey");
  const [customBrand, setCustomBrand] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customColor, setCustomColor] = useState("");

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (picker === "brand") return [...brands, OTHER].filter((item) => item.toLowerCase().includes(needle));
    if (picker === "model") {
      const modelOptions = brand && brand !== OTHER ? models[brand] ?? [] : [];
      return [...modelOptions, OTHER].filter((item) => item.toLowerCase().includes(needle));
    }
    if (picker === "color") return [...colors.map(([name]) => name), OTHER].filter((item) => item.toLowerCase().includes(needle));
    return [];
  }, [brand, picker, query]);

  function openPicker(next: Exclude<Picker, null>) {
    if (next === "model" && !brand) return;
    setPicker(next);
    setQuery("");
  }

  function choose(value: string) {
    if (picker === "brand") {
      setBrand(value);
      setModel("");
    } else if (picker === "model") {
      setModel(value);
    } else if (picker === "color") {
      setColor(value);
    }
    setPicker(null);
  }

  const brandLabel = brand === OTHER ? customBrand || "Custom brand" : brand;
  const modelLabel = model === OTHER ? customModel || "Custom model" : model;
  const colorLabel = color === OTHER ? customColor || "Custom color" : color;

  return (
    <main className={styles.page}>
      <header className={styles.previewHeader}>
        <div>
          <span>UI preview only</span>
          <h1>Appointment vehicle flow</h1>
          <p>420px fixed card with a scrollable body. Nothing is saved.</p>
        </div>
        <div className={styles.previewSwitch}>
          <button className={screen === "appointment" ? styles.activeSwitch : ""} onClick={() => setScreen("appointment")} type="button">
            Appointment
          </button>
          <button className={screen === "vehicle" ? styles.activeSwitch : ""} onClick={() => setScreen("vehicle")} type="button">
            Vehicle form
          </button>
        </div>
      </header>

      <section className={styles.stage}>
        <div className={styles.card}>
          {screen === "appointment" ? (
            <>
              <header className={styles.cardHeader}>
                <button aria-label="Close preview" className={styles.iconButton} type="button">x</button>
                <h2>New Appointment</h2>
                <span className={styles.headerSpacer} />
              </header>

              <div className={styles.cardBody}>
                <section className={styles.summaryGroup}>
                  <div className={styles.summaryRow}>
                    <PickerIcon type="calendar" />
                    <div><strong>11 July 2026</strong><span>10:00 AM</span></div>
                  </div>
                  <button className={styles.vehicleSummary} onClick={() => setScreen("vehicle")} type="button">
                    <PickerIcon type="customer" />
                    <div className={styles.customerText}><strong>OSCAR YONG</strong><span>01112212259</span></div>
                    <div className={styles.vehicleText}><strong>SAB9118G</strong><span>{brandLabel} {modelLabel}</span><small>{colorLabel}</small></div>
                    <span className={styles.editLabel}>Edit</span>
                  </button>
                </section>

                <section className={styles.sectionCard}>
                  <h3>Pick up contact</h3>
                  <div className={styles.segmented}>
                    <button className={styles.segmentActive} type="button"><strong>Registered owner</strong><span>Use customer phone</span></button>
                    <button type="button"><strong>Other person</strong><span>Pickup contact</span></button>
                  </div>
                  <p>Ready reminders will use the registered owner.</p>
                </section>

                <button className={styles.actionRow} type="button"><PickerIcon type="service" /><span>Select Service</span><b>›</b></button>

                <label className={styles.staffField}>
                  <span>Staff optional</span>
                  <select defaultValue="cashierB"><option>Unassigned</option><option>cashier A</option><option>cashierB</option></select>
                </label>
              </div>

              <footer className={styles.cardFooter}>
                <button className={styles.primaryButton} type="button">Confirm</button>
              </footer>
            </>
          ) : (
            <>
              <header className={styles.cardHeader}>
                <button aria-label="Back to appointment" className={styles.iconButton} onClick={() => setScreen("appointment")} type="button">‹</button>
                <h2>Customer & Vehicle</h2>
                <span className={styles.headerSpacer} />
              </header>

              <div className={styles.cardBody}>
                <section className={styles.formSection}>
                  <h3>Customer</h3>
                  <label><span>Phone</span><input defaultValue="01112212259" /></label>
                  <label><span>Name</span><input defaultValue="OSCAR YONG" /></label>
                </section>

                <section className={styles.formSection}>
                  <h3>Vehicle</h3>
                  <label><span>Plate number</span><input defaultValue="SAB9118G" /></label>

                  <div className={styles.selectField}>
                    <span>Vehicle Brand <small>optional</small></span>
                    <button onClick={() => openPicker("brand")} type="button"><b>{brandLabel || "Select vehicle brand"}</b><i>⌄</i></button>
                    {brand === OTHER ? <input onChange={(event) => setCustomBrand(event.target.value)} placeholder="Custom vehicle brand" value={customBrand} /> : null}
                  </div>

                  <div className={styles.selectField}>
                    <span>Vehicle Model <small>optional</small></span>
                    <button disabled={!brand} onClick={() => openPicker("model")} type="button"><b>{brand ? modelLabel || "Select vehicle model" : "Select vehicle brand first"}</b><i>⌄</i></button>
                    {model === OTHER ? <input onChange={(event) => setCustomModel(event.target.value)} placeholder="Custom vehicle model" value={customModel} /> : null}
                  </div>

                  <div className={styles.selectField}>
                    <span>Vehicle Color <small>optional</small></span>
                    <button onClick={() => openPicker("color")} type="button">
                      <b className={styles.colorValue}><em style={{ background: colors.find(([name]) => name === color)?.[1] ?? "#d8dee7" }} />{colorLabel || "Select vehicle color"}</b><i>⌄</i>
                    </button>
                    {color === OTHER ? <input onChange={(event) => setCustomColor(event.target.value)} placeholder="Custom vehicle color" value={customColor} /> : null}
                  </div>
                </section>
              </div>

              <footer className={styles.cardFooter}>
                <button className={styles.primaryButton} onClick={() => setScreen("appointment")} type="button">Use vehicle</button>
              </footer>

              {picker ? (
                <div className={styles.pickerBackdrop} onMouseDown={() => setPicker(null)}>
                  <section className={styles.picker} onMouseDown={(event) => event.stopPropagation()}>
                    <header><button onClick={() => setPicker(null)} type="button">x</button><h3>Select {picker}</h3><span /></header>
                    <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${picker}`} value={query} />
                    <div className={styles.optionList}>
                      {options.map((item) => (
                        <button key={item} onClick={() => choose(item)} type="button">
                          {picker === "color" && item !== OTHER ? <em style={{ background: colors.find(([name]) => name === item)?.[1] }} /> : null}
                          <span>{item === OTHER ? `Other / ${picker} not listed` : item}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
