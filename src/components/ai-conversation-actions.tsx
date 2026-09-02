"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { archiveAiConversationAction, restoreAiConversationAction } from "@/app/(business)/ai/actions";
import styles from "./ask-tetamu.module.css";

export function ArchiveConversationButton(props: { conversationId: string; title: string }) {
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.archiveConversationTrigger}
        title="Remove conversation"
        aria-label={`Remove conversation: ${props.title}`}
        onClick={() => setIsConfirming(true)}
      >
        <span aria-hidden="true">×</span>
      </button>

      {isConfirming ? (
        <div className={styles.archiveConfirmBackdrop} role="presentation">
          <section
            className={styles.archiveConfirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`archive-title-${props.conversationId}`}
            aria-describedby={`archive-description-${props.conversationId}`}
          >
            <div>
              <span>Conversation</span>
              <h2 id={`archive-title-${props.conversationId}`}>Remove this conversation?</h2>
              <p id={`archive-description-${props.conversationId}`}>
                “{props.title}” will disappear from your Conversations list. Its history will still be retained.
              </p>
            </div>

            <div className={styles.archiveConfirmActions}>
              <button type="button" className={styles.archiveCancelButton} onClick={() => setIsConfirming(false)}>
                Keep conversation
              </button>
              <form action={archiveAiConversationAction} className={styles.archiveConversationForm}>
                <input type="hidden" name="conversationId" value={props.conversationId} />
                <ArchiveSubmitButton />
              </form>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ArchiveSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={styles.archiveConfirmButton}
    >
      {pending ? "Removing…" : "Remove conversation"}
    </button>
  );
}

export function RestoreConversationButton(props: { conversationId: string; iconOnly?: boolean }) {
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`${styles.restoreConversationTrigger} ${props.iconOnly ? styles.restoreIconButton : ""}`}
        aria-label="Restore conversation"
        title="Restore conversation"
        onClick={() => setIsConfirming(true)}
      >
        {props.iconOnly ? <RestoreIcon /> : "Restore"}
      </button>

      {isConfirming ? (
        <div className={styles.archiveConfirmBackdrop} role="presentation">
          <section
            className={styles.archiveConfirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`restore-title-${props.conversationId}`}
            aria-describedby={`restore-description-${props.conversationId}`}
          >
            <div>
              <span>Archived conversation</span>
              <h2 id={`restore-title-${props.conversationId}`}>Restore this conversation?</h2>
              <p id={`restore-description-${props.conversationId}`}>
                It will return to your Conversations list and you can continue asking questions in it.
              </p>
            </div>

            <div className={styles.archiveConfirmActions}>
              <button type="button" className={styles.archiveCancelButton} onClick={() => setIsConfirming(false)}>
                Keep archived
              </button>
              <form action={restoreAiConversationAction} className={styles.restoreConfirmForm}>
                <input type="hidden" name="conversationId" value={props.conversationId} />
                <RestoreConfirmSubmitButton />
              </form>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function RestoreConfirmSubmitButton() {
  const { pending } = useFormStatus();
  return <button
    type="submit"
    disabled={pending}
    className={styles.restoreConfirmButton}
    aria-label={pending ? "Restoring conversation" : "Restore conversation"}
  >
    {pending ? "Restoring…" : "Restore conversation"}
  </button>;
}

function RestoreIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>;
}
