/**
 * @file atlas-cluster-scheduled-pause.js
 * @description MongoDB Atlas Scheduled Trigger — Automated Cluster Auto-Pause
 *
 * Workflow:
 *   1. Retrieve current cluster state via Atlas Administration API
 *   2. Validate if the cluster is currently active
 *   3. Execute pause operation (PATCH paused: true) if required
 *   4. Log workflow execution status
 *
 * Trigger Type  : Scheduled (Atlas App Services)
 * Target Action : Pause a dedicated cluster (M10+) to save compute costs
 *
 * @author       Madan U
 * @role         Cloud Database Administrator
 * @project      MongoDB Atlas Automation & Operational Workflows
 * @api          Atlas Administration API v2 (2024-05-30)
 * @auth         Digest Authentication (Public Key / Private Key)
 */

import AxiosDigestAuth from "@mhoc/axios-digest-auth";

// ─────────────────────────────────────────────
// Cluster Configuration
// ─────────────────────────────────────────────

const CLUSTER_CONFIG = {
  publicKey:   context.values.get("ATLAS_PUBLIC_KEY"),
  privateKey:  context.values.get("ATLAS_PRIVATE_KEY"),
  projectId:   context.values.get("ATLAS_PROJECT_ID"),
  clusterName: context.values.get("ATLAS_CLUSTER_NAME"),
};

// ─────────────────────────────────────────────
// Atlas API Base URL & Headers
// ─────────────────────────────────────────────

const ATLAS_API_BASE = "https://cloud.mongodb.com/api/atlas/v2";
const ATLAS_API_ACCEPT_HEADER = "application/vnd.atlas.2024-05-30+json";

// ─────────────────────────────────────────────
// Core: Retrieve Current Cluster State
// ─────────────────────────────────────────────

/**
 * Fetches the current cluster configuration to check its operational state.
 *
 * @param {AxiosDigestAuth} client - Authenticated Axios digest client
 * @returns {Promise<{ paused: boolean, stateName: string }>}
 */
const fetchClusterState = async (client) => {
  const url = `${ATLAS_API_BASE}/groups/${CLUSTER_CONFIG.projectId}/clusters/${CLUSTER_CONFIG.clusterName}`;

  console.log(`[INFO] Fetching cluster state for: ${CLUSTER_CONFIG.clusterName}`);

  const response = await client.request({
    method:  "GET",
    url,
    headers: { Accept: ATLAS_API_ACCEPT_HEADER },
  });

  const { paused, stateName } = response.data;

  console.log(`[INFO] Current state: ${stateName}`);
  console.log(`[INFO] Paused status: ${paused}`);

  return { paused, stateName };
};

// ─────────────────────────────────────────────
// Core: Execute Cluster Pause
// ─────────────────────────────────────────────

/**
 * Submits a PATCH request to the Atlas Administration API to pause the cluster.
 * Note: Pausing is only supported on dedicated clusters (M10 and above).
 *
 * @param {AxiosDigestAuth} client - Authenticated Axios digest client
 */
const executeClusterPause = async (client) => {
  const url = `${ATLAS_API_BASE}/groups/${CLUSTER_CONFIG.projectId}/clusters/${CLUSTER_CONFIG.clusterName}`;

  console.log(`[INFO] Initiating cluster pause operation...`);

  const response = await client.request({
    method:  "PATCH",
    url,
    headers: { Accept: ATLAS_API_ACCEPT_HEADER },
    data: {
      paused: true, 
    },
  });

  console.log(`[INFO] Pause initiated successfully.`);
  console.log(`[INFO] Atlas response target state: ${response.data.stateName}`);
};

// ─────────────────────────────────────────────
// Entry Point: Scheduled Trigger Handler
// ─────────────────────────────────────────────

exports = async function () {
  console.log("─────────────────────────────────────────────────");
  console.log("[START] Atlas Cluster Auto-Pause Workflow");
  console.log(`[INFO]  Cluster : ${CLUSTER_CONFIG.clusterName}`);
  console.log("─────────────────────────────────────────────────");

  const client = new AxiosDigestAuth({
    username: CLUSTER_CONFIG.publicKey,
    password: CLUSTER_CONFIG.privateKey,
  });

  try {
    // Step 1: Retrieve current cluster state
    const { paused, stateName } = await fetchClusterState(client);

    // Step 2: Validate state — only proceed if the cluster is active
    if (paused) {
      console.log(`[SKIP] Cluster is already paused (State: ${stateName}). No action needed.`);
      console.log("[END]  Workflow exited — pause condition not met.");
      return;
    }

    // Step 3: Execute pause
    await executeClusterPause(client);

    console.log("[SUCCESS] Auto-pause workflow completed.");

  } catch (err) {
    const atlasError = err.response?.data;

    if (atlasError) {
      console.error(`[ERROR] Atlas API error — Code: ${atlasError.errorCode}`);
      console.error(`[ERROR] Detail: ${atlasError.detail || atlasError.reason}`);
    } else {
      console.error(`[ERROR] Unexpected error: ${err.message}`);
    }

    // Re-throw so Atlas marks the trigger execution as failed
    throw err;
  }

  console.log("─────────────────────────────────────────────────");
  console.log("[END] Atlas Cluster Auto-Pause Workflow");
  console.log("─────────────────────────────────────────────────");
};
