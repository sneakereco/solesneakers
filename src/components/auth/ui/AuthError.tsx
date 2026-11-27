import { authStyles } from "./authStyles";

function focusWhenNeeded(alert: HTMLParagraphElement | null) {
  if (alert && document.activeElement === document.body) {
    alert.focus({ preventScroll: true });
  }
}

export function AuthError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className={authStyles.errorBox}
      tabIndex={-1}
      ref={focusWhenNeeded}
    >
      {message}
    </p>
  );
}
