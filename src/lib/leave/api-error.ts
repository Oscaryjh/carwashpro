import { AttendanceApiError } from "@/lib/attendance/api-error";
import { ClaimPrivateStorageConfigurationError } from "@/lib/claim/private-attachment-storage";

const SUPPORTING_DOCUMENT_UNAVAILABLE_MESSAGE =
  "Supporting document upload is temporarily unavailable. If the document is optional, remove it and submit your Leave request again. Otherwise, try again later.";

export function normalizeEmployeeLeaveApiError(error: unknown): unknown {
  if (error instanceof ClaimPrivateStorageConfigurationError) {
    return new AttendanceApiError(
      "INTERNAL_ERROR",
      SUPPORTING_DOCUMENT_UNAVAILABLE_MESSAGE,
      {
        status: 503,
        cause: error,
      },
    );
  }

  return error;
}
