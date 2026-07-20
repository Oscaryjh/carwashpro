type ModalCloseButtonProps = {
  ariaLabel: string;
  className?: string;
  onClick: () => void;
};

export function ModalCloseButton({
  ariaLabel,
  className = "ui-modal-close",
  onClick,
}: ModalCloseButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">{"\u00d7"}</span>
    </button>
  );
}
