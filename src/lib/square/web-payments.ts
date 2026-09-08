export type SquareEnvironment = "sandbox" | "production";

export type SquareTokenResult = {
  status: string;
  token?: string;
  errors?: Array<{ message?: string }>;
  details?: {
    shipping?: {
      contact?: {
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
    };
  };
};

export type SquarePaymentMethod = {
  attach?(
    selector: string,
    options?: { useCustomButton?: boolean },
  ): Promise<void>;
  tokenize(details?: Record<string, unknown>): Promise<SquareTokenResult>;
  destroy?(): Promise<boolean>;
};

export type SquareCashAppPayMethod = {
  attach(selector: string): Promise<void>;
  addEventListener(event: "ontokenization", listener: (event: unknown) => void): void;
  destroy?(): Promise<boolean>;
};

export type SquarePaymentRequest = {
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
  googlePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
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
  if (window.Square) {
    return Promise.resolve();
  }
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("square_sdk_unavailable")),
        {
          once: true,
        },
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("square_sdk_unavailable"));
    document.head.appendChild(script);
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

async function requestPermit(
  permitRequest: Record<string, unknown>,
  fetchImplementation: typeof fetch | undefined,
): Promise<string> {
  const fetchImpl = fetchImplementation ?? fetch;
  const permitResponse = await fetchImpl("/api/checkout/payment-permit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(permitRequest),
  });
  const permitData = await permitResponse.json().catch(() => null);
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
