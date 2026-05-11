import multer from "multer";

export const ADMIN_IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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
    limits: { fileSize: ADMIN_IMPORT_MAX_FILE_SIZE_BYTES },
    fileFilter: (_, file, cb) => {
      cb(null, isAllowedAdminImportFile(file));
    },
  });
}

export const adminImportUpload = createAdminImportUpload();

export function adminImportUploadSingleFile(req, res, next) {
  adminImportUpload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: "File too large",
        code: "upload_file_too_large",
        max_file_size_bytes: ADMIN_IMPORT_MAX_FILE_SIZE_BYTES,
      });
      return;
    }

    res.status(400).json({
      error: "Invalid upload",
      code: "upload_invalid",
    });
  });
}
