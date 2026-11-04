import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export interface UpdateCompanyInfoInput {
  id: string;
  sync_token: string;
  company_name?: string;
  legal_name?: string;
  company_addr?: {
    line1?: string;
    city?: string;
    country_sub_division_code?: string;
    postal_code?: string;
    country?: string;
  };
  primary_phone?: string;
  email?: string;
  web_addr?: string;
}

export async function updateQuickbooksCompanyInfo(data: UpdateCompanyInfoInput): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await QuickbooksClient.getInstance();
    const payload: any = { Id: data.id, SyncToken: data.sync_token, sparse: true };
    if (data.company_name !== undefined) payload.CompanyName = data.company_name;
    if (data.legal_name !== undefined) payload.LegalName = data.legal_name;
    if (data.company_addr) {
      payload.CompanyAddr = {};
      if (data.company_addr.line1 !== undefined) payload.CompanyAddr.Line1 = data.company_addr.line1;
      if (data.company_addr.city !== undefined) payload.CompanyAddr.City = data.company_addr.city;
      if (data.company_addr.country_sub_division_code !== undefined) payload.CompanyAddr.CountrySubDivisionCode = data.company_addr.country_sub_division_code;
      if (data.company_addr.postal_code !== undefined) payload.CompanyAddr.PostalCode = data.company_addr.postal_code;
      if (data.company_addr.country !== undefined) payload.CompanyAddr.Country = data.company_addr.country;
    }
    if (data.primary_phone !== undefined) payload.PrimaryPhone = { FreeFormNumber: data.primary_phone };
    if (data.email !== undefined) payload.Email = { Address: data.email };
    if (data.web_addr !== undefined) payload.WebAddr = { URI: data.web_addr };

    return new Promise((resolve) => {
      (quickbooks as any).updateCompanyInfo(payload, (err: any, updated: any) => {
        if (err) resolve({ result: null, isError: true, error: formatError(err) });
        else resolve({ result: updated, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

