import { useEffect, useRef } from "react";

type TermsAndConditionsProps = {
  open: boolean;
  onClose: () => void;
  termsAndConditions: string;
};

export default function TermsAndConditions({
  open,
  onClose,
  termsAndConditions,
}: TermsAndConditionsProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => {
      if (element.open) element.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialog}
      className="booking-terms-dialog"
      aria-labelledby="booking-terms-title"
      aria-describedby="booking-terms-description"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="booking-terms-content">
        <div className="booking-terms-heading">
          <div>
            <p className="eyebrow">Booking information</p>
            <h2 id="booking-terms-title">Terms &amp; Conditions</h2>
          </div>
        </div>
        <div id="booking-terms-description" className="booking-terms-copy">
          <p>{termsAndConditions}</p>
        </div>
        <div className="booking-terms-actions">
          <button className="button button-primary" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  );
}
