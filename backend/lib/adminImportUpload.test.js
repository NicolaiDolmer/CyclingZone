import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import express from "express";

import { createAdminImportUpload, isAllowedAdminImportFile } from "./adminImportUpload.js";

async function withUploadServer(fn) {
  const app = express();
  const upload = createAdminImportUpload();

  app.post("/upload", upload.single("file"), (req, res) => {
    res.json({
      file: req.file
        ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            buffer: req.file.buffer.toString("utf8"),
          }
        : null,
      body: req.body,
    });
  });

  const server = http.createServer(app);
  server.listen(0);
  await once(server, "listening");

  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("admin import upload keeps Excel uploads in memory and preserves form fields", async () => {
  await withUploadServer(async (baseUrl) => {
    const formData = new FormData();
    formData.append("race_id", "race-1");
    formData.append("stage_number", "2");
    formData.append(
      "file",
      new Blob(["xlsx-bytes"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "results.xlsx",
    );

    const response = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      body: formData,
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.body, { race_id: "race-1", stage_number: "2" });
    assert.deepEqual(body.file, {
      originalname: "results.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 10,
      buffer: "xlsx-bytes",
    });
  });
});

test("admin import upload accepts legacy .xls filenames used by the admin UI", () => {
  assert.equal(
    isAllowedAdminImportFile({
      originalname: "legacy-results.xls",
      mimetype: "application/vnd.ms-excel",
    }),
    true,
  );
});

test("admin import upload ignores non-Excel files before the handler runs", async () => {
  await withUploadServer(async (baseUrl) => {
    const formData = new FormData();
    formData.append("race_id", "race-1");
    formData.append("file", new Blob(["plain text"], { type: "text/plain" }), "notes.txt");

    const response = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      body: formData,
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.file, null);
    assert.deepEqual(body.body, { race_id: "race-1" });
  });
});
