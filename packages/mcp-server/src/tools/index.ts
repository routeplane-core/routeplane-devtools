/**
 * The curated tool catalog — 33 hand-selected gateway operations an AI
 * assistant actually needs, grouped by domain.
 */

import type { ToolDef } from './common.js';
import { inferenceTools } from './inference.js';
import { managementTools } from './management.js';
import { observabilityTools } from './observability.js';
import { configTools } from './config.js';
import { securityTools } from './security.js';

export const allTools: ToolDef[] = [
  ...inferenceTools,
  ...managementTools,
  ...observabilityTools,
  ...configTools,
  ...securityTools,
];

export type { ToolDef } from './common.js';
