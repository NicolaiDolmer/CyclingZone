import multer from "multer";

const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function isAllowedAdminImportFile(file = {}) {
  const originalName = String(file.originalname || "").toLowerCase();
  const mimetype = String(file.mimetype || "").toLowerCase();

  return (
    originalName.endsWith(".xlsx")
    || originalName.endsWith(".xls")
    || mimetype.includes("spreadsheet")
    || EXCEL_MIME_TYPES.has(mimetype)
  );
}

export function createAdminImportUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      cb(null, isAllowedAdminImportFile(file));
    },
  });
}

export const adminImportUpload = createAdminImportUpload();
