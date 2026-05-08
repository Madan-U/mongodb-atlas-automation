/**
 * @file atlas-cluster-scheduled-resume.js
 * @description MongoDB Atlas Scheduled Trigger — Automated Cluster Auto-Resume
 *
 * Workflow:
 *   1. Retrieve current cluster state via Atlas Administration API
 *   2. Validate if the cluster is currently paused
 *   3. Execute resume operation (PATCH paused: false) if required
 *   4. Log workflow execution status
 *
 * Trigger Type  : Scheduled (Atlas App Services)
 * Target Action : Resume a paused dedicated cluster (M10+)
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
// Core: Execute Cluster Resume
// ─────────────────────────────────────────────

/**
 * Submits a PATCH request to the Atlas Administration API to resume the cluster.
 *
 * @param {AxiosDigestAuth} client - Authenticated Axios digest client
 */
const executeClusterResume = async (client) => {
  const url = `${ATLAS_API_BASE}/groups/${CLUSTER_CONFIG.projectId}/clusters/${CLUSTER_CONFIG.clusterName}`;

  console.log(`[INFO] Initiating cluster resume operation...`);

  const response = await client.request({
    method:  "PATCH",
    url,
    headers: { Accept: ATLAS_API_ACCEPT_HEADER },
    data: {
      paused: false, 
    },
  });

  console.log(`[INFO] Resume initiated successfully.`);
  console.log(`[INFO] Atlas response target state: ${response.data.stateName}`);
};

// ─────────────────────────────────────────────
// Entry Point: Scheduled Trigger Handler
// ─────────────────────────────────────────────

exports = async function () {
  console.log("─────────────────────────────────────────────────");
  console.log("[START] Atlas Cluster Auto-Resume Workflow");
  console.log(`[INFO]  Cluster : ${CLUSTER_CONFIG.clusterName}`);
  console.log("─────────────────────────────────────────────────");

  const client = new AxiosDigestAuth({
    username: CLUSTER_CONFIG.publicKey,
    password: CLUSTER_CONFIG.privateKey,
  });

  try {
    // Step 1: Retrieve current cluster state
    const { paused, stateName } = await fetchClusterState(client);

    // Step 2: Validate state — only proceed if the cluster is paused
    if (!paused) {
      console.log(`[SKIP] Cluster is currently active (State: ${stateName}). No action needed.`);
      console.log("[END]  Workflow exited — resume condition not met.");
      return;
    }

    // Step 3: Execute resume
    await executeClusterResume(client);

    console.log("[SUCCESS] Auto-resume workflow completed.");

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
  console.log("[END] Atlas Cluster Auto-Resume Workflow");
  console.log("─────────────────────────────────────────────────");
};
