export class ResponseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ResponseError";
  }
}

export async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  if (!response.ok) {
    throw new ResponseError(response.status, fallbackMessage);
  }

  return response.json().catch(() => {
    throw new ResponseError(response.status, fallbackMessage);
  });
}
