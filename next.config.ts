import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "32mb" },
  },
  serverExternalPackages: ["exceljs", "mammoth"],
};

export default config;
