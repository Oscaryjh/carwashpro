"use client";

import { useEffect, useRef, useState } from "react";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

type BusinessGroupCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
};

function createGroupCode(name: string) {
  return name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function BusinessGroupCreateModal({ action }: BusinessGroupCreateModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => nameInputRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function closeModal() {
    setIsOpen(false);
    setName("");
    setCode("");
    setCodeEdited(false);
  }

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Create group
      </button>

      {isOpen ? (
        <div
          className="business-group-create-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
          role="presentation"
        >
          <section
            aria-labelledby="business-group-create-title"
            aria-modal="true"
            className="business-group-create-modal"
            role="dialog"
          >
            <header className="business-group-create-modal-header">
              <div>
                <p>BUSINESS GROUP</p>
                <h2 id="business-group-create-title">Create group</h2>
                <span>Group existing businesses without changing their data ownership.</span>
              </div>
              <ModalCloseButton
                ariaLabel="Close create group"
                className="business-group-create-modal-close"
                onClick={closeModal}
              />
            </header>

            <form action={action} className="business-group-create-form">
              <label>
                Group name
                <input
                  ref={nameInputRef}
                  name="name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setName(nextName);
                    if (!codeEdited) setCode(createGroupCode(nextName));
                  }}
                  placeholder="e.g. Oscar Group"
                  autoComplete="off"
                />
              </label>
              <label>
                Group code
                <input
                  name="code"
                  required
                  maxLength={64}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.toLocaleLowerCase());
                    setCodeEdited(true);
                  }}
                  placeholder="e.g. oscar-group"
                  autoComplete="off"
                />
                <span className="muted">
                  Unique identifier. Use lowercase letters, numbers and hyphens.
                </span>
              </label>

              <div className="business-group-create-form-note">
                Businesses, users and transaction data remain under their existing businessId.
              </div>

              <div className="business-group-create-form-actions">
                <button className="secondary-button" type="button" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" disabled={!name.trim() || !code.trim()}>
                  Create group
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
