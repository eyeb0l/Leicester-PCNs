#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASEMAP_STYLES = {
  light: "mapbox/streets-v12",
  dark: "mapbox/dark-v11",
};

function requirePublicToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token || !token.startsWith("pk.")) {
    throw new Error(
      "MAPBOX_PUBLIC_TOKEN must be set to a public Mapbox token starting with 'pk.'."
    );
  }
  return token;
}

async function main() {
  const token = requirePublicToken(process.env.MAPBOX_PUBLIC_TOKEN);
  const payload = {
    mapboxAccessToken: token,
    basemapStyles: DEFAULT_BASEMAP_STYLES,
  };
  const outputPath = path.resolve(process.cwd(), "map-config.json");
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outputPath}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
