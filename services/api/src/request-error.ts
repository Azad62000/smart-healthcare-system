export class ApiRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ field: string; issue: string }>
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
