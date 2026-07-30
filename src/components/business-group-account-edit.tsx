"use client";

import { useActionState, useEffect, useState } from "react";
import type {
  BusinessGroupActionState,
  updateBusinessGroupAccountAction,
} from "@/app/admin/business-groups/actions";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

type BusinessGroupAccountEditProps = {
  action: typeof updateBusinessGroupAccountAction;
  email: string;
  groupId: string;
  groupUserId: string;
  name: string;
};

const initialState: BusinessGroupActionState = {
  status: "idle",
  message: "",
};

export function BusinessGroupAccountEdit({
  action,
  email,
  groupId,
  groupUserId,
  name,
}: BusinessGroupAccountEditProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") setIsOpen(false);
  }, [state.status]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button className="secondary-button" type="button" onClick={() => setIsOpen(true)}>
        Edit
      </button>

      {isOpen ? (
        <div
          className="business-group-create-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby={`edit-group-account-${groupUserId}`}
            aria-modal="true"
            className="business-group-create-modal"
            role="dialog"
          >
            <header className="business-group-create-modal-header">
              <div>
                <p>GROUP LOGIN</p>
                <h2 id={`edit-group-account-${groupUserId}`}>Edit login account</h2>
                <span>Update this dedicated group login. Leave password blank to keep it.</span>
              </div>
              <ModalCloseButton
                ariaLabel="Close edit group login"
                className="business-group-create-modal-close"
                onClick={() => setIsOpen(false)}
              />
            </header>

            <form action={formAction} aria-busy={pending} className="business-group-create-form">
              <input name="groupId" type="hidden" value={groupId} />
              <input name="groupUserId" type="hidden" value={groupUserId} />

              <label>
                Name
                <input name="name" defaultValue={name} maxLength={120} required />
              </label>
              <label>
                Login email
                <input
                  name="email"
                  autoComplete="username"
                  defaultValue={email}
                  maxLength={254}
                  required
                  type="email"
                />
              </label>
              <label>
                New password
                <input
                  name="password"
                  autoComplete="new-password"
                  maxLength={72}
                  minLength={8}
                  placeholder="Leave blank to keep current password"
                  type="password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  name="confirmPassword"
                  autoComplete="new-password"
                  maxLength={72}
                  minLength={8}
                  type="password"
                />
              </label>

              {state.status === "error" ? (
                <p className="form-message error" role="alert">
                  {state.message}
                </p>
              ) : null}

              <div className="business-group-create-form-actions">
                <button
                  className="secondary-button"
                  disabled={pending}
                  type="button"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </button>
                <button disabled={pending} type="submit">
                  {pending ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
