import { withRequestDeadline } from "@/lib/http/request-deadline";

export type SquareEnvironment = "sandbox" | "production";

type SquareWalletContact = {
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  addressLines?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
};

export type SquareTokenResult = {
  status: string;
  token?: string;
  errors?: Array<{ message?: string; field?: string }>;
  details?: {
    billing?: SquareWalletContact;
    shipping?: {
      contact?: SquareWalletContact;
    };
  };
};

export type SquarePaymentMethod = {
  attach?(
    selector: string,
    options?: { useCustomButton?: boolean; buttonSizeMode?: "static" | "fill" },
  ): Promise<void>;
  tokenize(details?: Record<string, unknown>): Promise<SquareTokenResult>;
  destroy?(): Promise<boolean>;
  addEventListener?(event: string, listener: (event: SquareCardInputEvent) => void): void;
  removeEventListener?(
    event: string,
    listener: (event: SquareCardInputEvent) => void,
  ): void;
  focus?(field: string): Promise<boolean>;
  recalculateSize?(): void;
};

export type SquareCardInputEvent = {
  detail: {
    field?: string;
    cardBrand?: string;
    currentState?: {
      isEmpty: boolean;
      isCompletelyValid: boolean;
      hasErrorClass?: boolean;
    };
  };
};

export type SquareCashAppPayMethod = {
  attach(
    selector: string,
    options?: {
      shape?: "round" | "semiround";
      size?: "medium" | "small";
      theme?: "dark" | "light";
      width?: "full" | "static";
    },
  ): Promise<void>;
  addEventListener(event: "ontokenization", listener: (event: unknown) => void): void;
  destroy?(): Promise<boolean>;
};

export type SquarePaymentRequest = {
  update(options: Record<string, unknown>): boolean;
  addEventListener(
    event: string,
    listener: (
      value: unknown,
    ) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>,
  ): void;
};

export type SquarePayments = {
  card(options?: {
    style?: Record<string, Record<string, string>>;
  }): Promise<SquarePaymentMethod>;
  paymentRequest(input: Record<string, unknown>): SquarePaymentRequest;
  applePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
  cashAppPay(
    request: SquarePaymentRequest,
    options: {
      redirectURL: string;
      referenceId: string;
      shouldTokenize?: () => boolean;
    },
  ): Promise<SquareCashAppPayMethod>;
  afterpayClearpay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
};

type SquareGlobal = {
  payments(applicationId: string, locationId: string): SquarePayments;
};

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

export function squareWebPaymentsScriptUrl(environment: SquareEnvironment): string {
  return environment === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
}

function loadScript(src: string): Promise<void> {
  if (window.Square) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  const script = existing ?? document.createElement("script");
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(failed, 15_000);
    function cleanup() {
      window.clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    }
    function failed() {
      cleanup();
      script.remove();
      reject(new Error("square_sdk_unavailable"));
    }
    function loaded() {
      if (!window.Square) return failed();
      cleanup();
      resolve();
    }
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export async function loadSquareWebPayments(input: {
  applicationId: string;
  locationId: string;
  environment: SquareEnvironment;
}): Promise<SquarePayments> {
  if (!input.applicationId || !input.locationId) {
    throw new Error("square_web_payments_configuration_missing");
  }
  await loadScript(squareWebPaymentsScriptUrl(input.environment));
  if (!window.Square) {
    throw new Error("square_sdk_unavailable");
  }
  return window.Square.payments(input.applicationId, input.locationId);
}

export async function authorizeAndTokenize(input: {
  permitRequest: Record<string, unknown>;
  paymentMethod: Pick<SquarePaymentMethod, "tokenize">;
  verificationDetails?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<{ permit: string; sourceId: string }> {
  const permit = await requestPermit(input.permitRequest, input.fetchImpl);
  const token = await input.paymentMethod.tokenize(input.verificationDetails);
  if (token.status !== "OK" || !token.token) {
    throw new Error("Payment details could not be verified");
  }
  return { permit, sourceId: token.token };
}

// The deadline covers response headers and body. Callers perform all subsequent
// steps only after this operation has completed within its deadline.
export function postCheckoutJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
) {
  return withRequestDeadline(async (signal) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  });
}

async function requestPermit(
  permitRequest: Record<string, unknown>,
  fetchImplementation: typeof fetch | undefined,
): Promise<string> {
  const { response: permitResponse, data: permitData } = await postCheckoutJson(
    "/api/checkout/payment-permit",
    permitRequest,
    fetchImplementation,
  ).catch(() => {
    throw new Error("Payment authorization is unavailable. Please try again.");
  });
  if (!permitResponse.ok || typeof permitData?.permit !== "string") {
    throw new Error(permitData?.error || "Unable to authorize payment");
  }
  return permitData.permit;
}

export async function authorizeTokenizedSource(input: {
  permitRequest: Record<string, unknown>;
  sourceId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ permit: string; sourceId: string }> {
  return {
    permit: await requestPermit(input.permitRequest, input.fetchImpl),
    sourceId: input.sourceId,
  };
}
