import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../demo/", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webm": "video/webm",
};
http
  .createServer(async (req, res) => {
    try {
      const requested = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const file = path.resolve(
        root,
        "." + (requested === "/" ? "/index.html" : requested),
      );
      if (
        !file.startsWith(root + path.sep) &&
        file !== path.join(root, "index.html")
      ) {
        res.writeHead(403);
        return res.end();
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Content-Length": data.length,
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4335, "127.0.0.1", () =>
    console.log(
      "Static demo preview: http://127.0.0.1:4335/ (no business backend or external calls)",
    ),
  );
