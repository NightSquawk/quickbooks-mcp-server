import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Limit on decoded PDF response bytes. The HTTP adapter stops receiving when
 * the cap is crossed; the callback check remains a second line of defense.
 * Stream chunks and Buffer concatenation still have bounded memory overhead.
 *
 * Override via QBO_PDF_MAX_BYTES env var when an unusually large PDF is
 * legitimately expected.
 */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB

function maxBytes(): number {
  const raw = process.env.QBO_PDF_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_MAX_BYTES;
  return parsed;
}

/**
 * Download a QuickBooks Online invoice as a PDF and return the raw bytes.
 *
 * Uses the underlying node-quickbooks `getInvoicePdf` method, which calls the
 * QBO REST endpoint `GET /v3/company/{realmId}/invoice/{id}/pdf` with
 * `Accept: application/pdf`. The library invokes the callback with a Buffer
 * containing the PDF body.
 *
 * Passes the byte cap to the patched client before receiving the response, so
 * oversized responses are aborted rather than fully buffered first.
 */
export async function getQuickbooksInvoicePdf(
  invoiceId: string
): Promise<ToolResponse<Buffer>> {
  try {
    const quickbooks = await QuickbooksClient.getInstance();
    const cap = maxBytes();

    return new Promise((resolve) => {
      (quickbooks as any).getInvoicePdf(invoiceId, (err: any, pdf: Buffer) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
          return;
        }

        if (pdf && pdf.length > cap) {
          resolve({
            result: null,
            isError: true,
            error: `PDF size ${pdf.length} bytes exceeds cap of ${cap} bytes (override with QBO_PDF_MAX_BYTES).`,
          });
          return;
        }

        resolve({
          result: pdf,
          isError: false,
          error: null,
        });
      }, cap);
    });
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
