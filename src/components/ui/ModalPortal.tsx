"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { useHydrated } from "@/components/ui/useHydrated";

const placements = {
  center: "items-center justify-center p-4",
  left: "items-stretch justify-start",
  right: "items-stretch justify-end",
};

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  placement?: keyof typeof placements;
  initialFocusRef?: RefObject<HTMLElement | null>;
  focusDialog?: boolean;
  role?: "alertdialog";
  contentClassName?: string;
  backdropClassName?: string;
  zIndexClassName?: string;
  zIndex?: number;
};

let scrollLocks = 0;
let previousOverflow = "";

function lockBodyScroll() {
  if (scrollLocks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
  };
}

function containTab(event: KeyboardEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget;
  if (
    event.key !== "Tab" ||
    event.defaultPrevented ||
    !dialog.contains(event.target as Node)
  ) {
    return;
  }
  const tabbable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, iframe, summary, [contenteditable], [tabindex]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === "visible",
  );
  const first = tabbable[0];
  const last = tabbable.at(-1);
  const active = document.activeElement;
  if (!first || active === dialog || active === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}

function ModalSurface({
  onClose,
  children,
  label,
  labelledBy,
  describedBy,
  placement = "center",
  initialFocusRef,
  focusDialog,
  role,
  contentClassName = "max-h-full max-w-full",
  backdropClassName = "bg-black/80",
  zIndexClassName = "z-[9999]",
  zIndex,
}: Omit<Props, "open">) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const pointerStartedOnBackdrop = useRef(false);
  const useAdminTheme =
    placement === "center" && Boolean(document.querySelector("[data-admin-shell]"));

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    const unlock = lockBodyScroll();
    dialog.showModal();
    const initialFocus = focusDialog ? dialog : initialFocusRef?.current;
    initialFocus?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      unlock();
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [focusDialog, initialFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      role={role}
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-admin-content={useAdminTheme ? "" : undefined}
      data-admin-modal={useAdminTheme ? "" : undefined}
      className={`fixed inset-0 isolate m-0 h-full max-h-none w-full max-w-none overflow-clip overscroll-contain border-0 bg-transparent p-0 text-inherit backdrop:bg-transparent ${zIndexClassName}`}
      style={{ zIndex, outline: "none" }}
      onKeyDown={containTab}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onPointerDown={(event) => {
        pointerStartedOnBackdrop.current =
          event.button === 0 &&
          (event.target === backdropRef.current || event.target === event.currentTarget);
      }}
      onPointerCancel={() => {
        pointerStartedOnBackdrop.current = false;
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (
          pointerStartedOnBackdrop.current &&
          (event.target === backdropRef.current || event.target === event.currentTarget)
        ) {
          onClose();
        }
        pointerStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={backdropRef}
        className={`absolute inset-0 ${backdropClassName}`}
        aria-hidden="true"
      />
      <div
        className={`pointer-events-none absolute inset-0 flex ${placements[placement]}`}
      >
        <div className={`pointer-events-auto ${contentClassName}`}>{children}</div>
      </div>
    </dialog>
  );
}

export function ModalPortal({ open, ...props }: Props) {
  const hydrated = useHydrated();
  return open && hydrated
    ? createPortal(<ModalSurface {...props} />, document.body)
    : null;
}

// Keep an exiting drawer modal until its visual transition completes.
export function useOverlayTransition(open: boolean, duration: number) {
  const [previousOpen, setPreviousOpen] = useState(open);
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(false);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) setPresent(true);
    else setVisible(false);
  }

  useEffect(() => {
    if (!present) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!open) {
      const timer = window.setTimeout(
        () => setPresent(false),
        reducedMotion ? 0 : duration,
      );
      return () => window.clearTimeout(timer);
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      if (reducedMotion) setVisible(true);
      else secondFrame = window.requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [duration, open, present]);

  return { present, visible };
}
