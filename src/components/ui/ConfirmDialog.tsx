"use client";

import { useId, useRef } from "react";
import { X } from "lucide-react";

import { ActionButton } from "./ActionButton";
import { ModalPortal } from "./ModalPortal";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalPortal
      open={isOpen}
      onClose={onCancel}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      initialFocusRef={cancelRef}
      zIndexClassName="z-50"
      contentClassName="w-full max-w-md"
      backdropClassName="bg-black/60"
    >
      <div className="relative w-full border border-zinc-800 bg-zinc-900 shadow-lg">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 w-11 cursor-pointer items-center justify-center text-gray-400 transition hover:text-white"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {description && (
          <p id={descriptionId} className="px-5 py-4 text-sm text-gray-300">
            {description}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <ActionButton
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="cursor-pointer border border-zinc-700 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:border-zinc-500"
          >
            {cancelLabel}
          </ActionButton>
          <ActionButton
            type="button"
            onClick={onConfirm}
            className="cursor-pointer bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            {confirmLabel}
          </ActionButton>
        </div>
      </div>
    </ModalPortal>
  );
}
