import { Controller } from "@nestjs/common";
import { readFile } from "node:fs";
import { Client } from "pg";

import { mainProcessValue } from "../main/index.js";

export const invalidRendererImports = [
  Controller,
  readFile,
  Client,
  mainProcessValue,
];
