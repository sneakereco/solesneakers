export const squareCardStyle: Record<string, Record<string, string>> = {
  ".input-container": {
    borderColor: "#dedede",
    borderRadius: "12px",
    borderWidth: "1px",
  },
  ".input-container.is-focus": {
    borderColor: "#1773b0",
    borderWidth: "1px",
  },
  ".input-container.is-error": {
    borderColor: "#d92d39",
    borderWidth: "2px",
  },
  input: {
    backgroundColor: "#ffffff",
    color: "#18181b",
    fontSize: "16px",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  "input::placeholder": {
    color: "#737373",
  },
  ".message-text.is-error": {
    color: "#d92d39",
  },
  ".message-icon.is-error": {
    color: "#d92d39",
  },
};
