export const squareCardStyle: Record<string, Record<string, string>> = {
  ".input-container": {
    borderColor: "#dedede",
    borderRadius: "12px",
    borderWidth: "1px",
  },
  ".input-container.is-focus": {
    borderColor: "#1878b9",
    borderWidth: "1px",
  },
  ".input-container.is-error": {
    borderColor: "#b45309",
    borderWidth: "1px",
  },
  input: {
    backgroundColor: "#ffffff",
    color: "#18181b",
    fontSize: "16px",
  },
  "input::placeholder": {
    color: "#737373",
  },
  ".message-text.is-error": {
    color: "#92400e",
  },
  ".message-icon.is-error": {
    color: "#92400e",
  },
};
