"use client";

import { useMemo, useState } from "react";
import styles from "./cashier-pos-preview.module.css";

type CatalogType = "all" | "package" | "product";

type CatalogItem = {
  id: string;
  type: Exclude<CatalogType, "all">;
  name: string;
  category: string;
  price: number;
  detail: string;
};

type CartLine = CatalogItem & { quantity: number };

const catalog: CatalogItem[] = [
  { id: "p1", type: "product", name: "Anti-Dandruff Shampoo", category: "Hair Care", price: 32, detail: "97 in stock" },
  { id: "p2", type: "product", name: "Argan Hair Oil", category: "Hair Care", price: 49, detail: "99 in stock" },
  { id: "p3", type: "product", name: "Color Protect Conditioner", category: "Hair Care", price: 55, detail: "100 in stock" },
  { id: "p4", type: "product", name: "Gloss Styling Wax", category: "Hair Styling", price: 36, detail: "100 in stock" },
  { id: "p5", type: "product", name: "Vitamin C Face Serum", category: "Skin Care", price: 68, detail: "100 in stock" },
  { id: "p6", type: "product", name: "Cuticle Oil", category: "Nail Care", price: 25, detail: "100 in stock" },
  { id: "k1", type: "package", name: "Hair Wash 5 Sessions", category: "Hair Packages", price: 150, detail: "5 total uses" },
  { id: "k2", type: "package", name: "Acne Care 5 Sessions", category: "Skin Packages", price: 500, detail: "5 total uses" },
  { id: "k3", type: "package", name: "Relaxation Massage 5 Sessions", category: "Wellness", price: 500, detail: "5 total uses" },
];

const previewCustomer = {
  activePackages: 2,
  name: "Oscar Yong",
  phone: "01112212259",
  points: 150,
};

const money = (value: number) => `RM${value.toFixed(2)}`;

export function CashierPosPreview() {
  const [type, setType] = useState<CatalogType>("product");
  const [category, setCategory] = useState("All categories");
  const [query, setQuery] = useState("");
  const [customerSelected, setCustomerSelected] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([
    { ...catalog[0], quantity: 1 },
    { ...catalog[1], quantity: 1 },
  ]);

  const categories = useMemo(() => {
    const items = catalog.filter((item) => type === "all" || item.type === type);
    return ["All categories", ...Array.from(new Set(items.map((item) => item.category)))];
  }, [type]);

  const visibleItems = catalog.filter((item) => {
    const matchesType = type === "all" || item.type === type;
    const matchesCategory = category === "All categories" || item.category === category;
    const haystack = `${item.name} ${item.category}`.toLowerCase();
    return matchesType && matchesCategory && haystack.includes(query.trim().toLowerCase());
  });

  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const sst = subtotal * 0.06;
  const total = subtotal + sst;
  const requiresCustomer = cart.some((line) => line.type === "package");

  function switchType(nextType: CatalogType) {
    setType(nextType);
    setCategory("All categories");
  }

  function addItem(item: CatalogItem) {
    setCart((current) => {
      const existing = current.find((line) => line.id === item.id);
      if (existing) {
        return current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, { ...item, quantity: 1 }];
    });
  }

  function updateQuantity(id: string, quantity: number) {
    if (quantity < 1) {
      setCart((current) => current.filter((line) => line.id !== id));
      return;
    }
    setCart((current) => current.map((line) => line.id === id ? { ...line, quantity } : line));
  }

  return (
    <main className={styles.page}>
      <header className={styles.previewHeader}>
        <div>
          <span>UI PREVIEW ONLY</span>
          <h1>Cashier POS</h1>
          <p>Fast catalog browsing on the left, one compact checkout on the right.</p>
        </div>
        <div className={styles.previewNote}>No transaction will be created</div>
      </header>

      <section className={styles.posShell}>
        <section className={styles.catalogPanel} aria-label="Sale catalog">
          <header className={styles.panelHeader}>
            <div>
              <span>SALE CATALOG</span>
              <h2>Packages and products</h2>
            </div>
            <label className={styles.searchField}>
              <span>Search</span>
              <input
                aria-label="Search catalog"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search product, package, or category"
                value={query}
              />
            </label>
          </header>

          <div className={styles.catalogTabs} role="tablist">
            {(["product", "package"] as CatalogType[]).map((option) => (
              <button
                aria-selected={type === option}
                className={type === option ? styles.activeTab : ""}
                key={option}
                onClick={() => switchType(option)}
                role="tab"
                type="button"
              >
                {option === "product" ? "Products" : "Packages"}
              </button>
            ))}
          </div>

          <div className={styles.categoryBar} aria-label="Catalog categories">
            {categories.map((option) => (
              <button
                className={category === option ? styles.activeCategory : ""}
                key={option}
                onClick={() => setCategory(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>

          <div className={styles.catalogGrid}>
            {visibleItems.map((item) => (
              <button
                className={styles.itemTile}
                key={item.id}
                onClick={() => addItem(item)}
                type="button"
              >
                <span className={styles.itemCopy}>
                  <strong>{item.name}</strong>
                  <small>{item.category} · {item.detail}</small>
                </span>
                <span className={styles.itemPrice}>{money(item.price)}</span>
                <span className={styles.quickAdd}>+</span>
              </button>
            ))}
            {!visibleItems.length ? <p className={styles.emptyCatalog}>No matching items.</p> : null}
          </div>
        </section>

        <aside className={styles.orderPanel} aria-label="Current sale">
          <header className={styles.orderHeader}>
            <div>
              <span>CURRENT SALE</span>
              <h2>Order #{cart.length ? "P-1048" : "New"}</h2>
            </div>
            {cart.length ? <button onClick={() => setCart([])} type="button">Clear</button> : null}
          </header>

          <button className={`${styles.customerButton} ${requiresCustomer && !customerSelected ? styles.customerRequired : ""}`} onClick={() => setCustomerSelected((current) => !current)} type="button">
            <span className={styles.customerMark}>{customerSelected ? "OY" : "C"}</span>
            <span>
              <strong>{customerSelected ? previewCustomer.name : requiresCustomer ? "Select customer" : "Walk-in customer"}</strong>
              <small>
                {customerSelected
                  ? `${previewCustomer.phone} · Loyalty member`
                  : requiresCustomer
                    ? "Required for package purchase"
                    : "Optional for product sales"}
              </small>
            </span>
            {customerSelected ? (
              <span className={styles.customerMeta}>
                <strong>{previewCustomer.points} pts</strong>
                <small>{previewCustomer.activePackages} active packages</small>
                <b>Change</b>
              </span>
            ) : <b>Choose</b>}
          </button>

          <div className={styles.orderLines}>
            {cart.map((line) => (
              <div className={styles.orderLine} key={line.id}>
                <div className={styles.lineMain}>
                  <strong>{line.name}</strong>
                  <small>{line.type === "package" ? "Package" : money(line.price)}</small>
                </div>
                <div className={styles.stepper}>
                  <button aria-label={`Reduce ${line.name}`} onClick={() => updateQuantity(line.id, line.quantity - 1)} type="button">-</button>
                  <span>{line.quantity}</span>
                  <button aria-label={`Add ${line.name}`} onClick={() => updateQuantity(line.id, line.quantity + 1)} type="button">+</button>
                </div>
                <strong className={styles.lineTotal}>{money(line.price * line.quantity)}</strong>
              </div>
            ))}
            {!cart.length ? (
              <div className={styles.emptyOrder}>
                <span>+</span>
                <strong>No items yet</strong>
                <small>Select an item from the catalog.</small>
              </div>
            ) : null}
          </div>

          <div className={styles.orderSummary}>
            <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            <div><span>SST</span><strong>{money(sst)}</strong></div>
            <div className={styles.totalRow}><span>Total</span><strong>{money(total)}</strong></div>
          </div>

          <div className={styles.paymentMethods} aria-label="Payment method">
            {['Cash', 'Card', 'E-Wallet'].map((method, index) => (
              <button className={index === 0 ? styles.activePayment : ""} key={method} type="button">{method}</button>
            ))}
          </div>

          <button className={styles.payButton} disabled={!cart.length || (requiresCustomer && !customerSelected)} type="button">
            {requiresCustomer && !customerSelected ? "Select customer to continue" : `Pay ${money(total)}`}
          </button>
        </aside>
      </section>
    </main>
  );
}
