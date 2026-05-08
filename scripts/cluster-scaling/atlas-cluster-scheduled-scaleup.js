/**
 * @file atlas-cluster-scheduled-scaleup.js
 * @description MongoDB Atlas Scheduled Trigger — Automated Cluster Scale-Up Workflow
 *
 * Workflow:
 *   1. Retrieve current cluster configuration via Atlas Administration API
 *   2. Validate active cluster tier against the expected scale-up source tier
 *   3. Execute conditional scale-up if criteria are met
 *   4. Apply updated replication specifications across all region configs
 *   5. Log workflow execution status
 *
 * Trigger Type  : Scheduled (Atlas App Services)
 * Schedule      : Configure in Atlas App Services UI (e.g., daily at 08:00 IST)
 * Target Action : M50 General → M80 General (business-hour performance scaling)
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
// Scaling Policy
// ─────────────────────────────────────────────

const SCALING_POLICY = {
  sourceTier:      "M50",   // Trigger scale-up only when cluster is at this tier
  targetTier:      "M80",   // Desired tier after scale-up
  maxInstanceSize: "M80",   // AutoScaling upper bound
  diskIOPS:        8000,
  diskSizeGB:      750,
  ebsVolumeType:   "PROVISIONED",
  cpuArchitecture: "arm64",
};

// ─────────────────────────────────────────────
// Region Configuration
// ─────────────────────────────────────────────

const REGION_CONFIGS = [
  {
    providerName:    "AWS",
    regionName:      "AP_SOUTH_1",
    priority:        7,
    electableNodes:  2,
    readOnlyNodes:   0,
  },
  {
    providerName:    "AWS",
    regionName:      "AP_SOUTH_2",
    priority:        6,
    electableNodes:  1,
    readOnlyNodes:   2,
  },
];

// ─────────────────────────────────────────────
// Atlas API Base URL
// ─────────────────────────────────────────────

const ATLAS_API_BASE = "https://cloud.mongodb.com/api/atlas/v2";
const ATLAS_API_ACCEPT_HEADER = "application/vnd.atlas.2024-05-30+json";

// ─────────────────────────────────────────────
// Helper: Build AutoScaling Config
// ─────────────────────────────────────────────

/**
 * Returns a standard autoscaling configuration block.
 * scaleDownEnabled is false to prevent Atlas from automatically
 * reversing the manual scale-up triggered by this workflow.
 */
const buildAutoScalingConfig = () => ({
  diskGB: {
    enabled: true,
  },
  compute: {
    enabled:           true,
    scaleDownEnabled:  false,
    maxInstanceSize:   SCALING_POLICY.maxInstanceSize,
  },
});

// ─────────────────────────────────────────────
// Helper: Build Node Specs
// ─────────────────────────────────────────────

/**
 * Returns a standard node specification block for a given tier.
 * @param {string} instanceSize - Target Atlas instance size (e.g., "M80")
 */
const buildNodeSpecs = (instanceSize) => ({
  instanceSize:                instanceSize,
  diskIOPS:                    SCALING_POLICY.diskIOPS,
  diskSizeGB:                  SCALING_POLICY.diskSizeGB,
  ebsVolumeType:               SCALING_POLICY.ebsVolumeType,
  preferredCpuArchitecture:    SCALING_POLICY.cpuArchitecture,
});

// ─────────────────────────────────────────────
// Helper: Build Replication Specs Payload
// ─────────────────────────────────────────────

/**
 * Constructs the full replicationSpecs payload for the PATCH request.
 * Dynamically builds region configs from REGION_CONFIGS definition.
 *
 * @param {string} replicationSpecId - Existing replicationSpec ID (required by Atlas API)
 * @param {string} targetTier        - Instance size to scale up to
 */
const buildReplicationSpecsPayload = (replicationSpecId, targetTier) => ({
  replicationSpecs: [
    {
      id: replicationSpecId,
      regionConfigs: REGION_CONFIGS.map((region) => {
        const config = {
          providerName:  region.providerName,
          regionName:    region.regionName,
          priority:      region.priority,
          electableSpecs: {
            ...buildNodeSpecs(targetTier),
            nodeCount: region.electableNodes,
          },
          autoScaling: buildAutoScalingConfig(),
        };

        // Add readOnlySpecs only for regions that have read-only nodes configured
        if (region.readOnlyNodes > 0) {
          config.readOnlySpecs = {
            ...buildNodeSpecs(targetTier),
            nodeCount: region.readOnlyNodes,
          };
        }

        return config;
      }),
    },
  ],
});

// ─────────────────────────────────────────────
// Core: Retrieve Current Cluster Configuration
// ─────────────────────────────────────────────

/**
 * Fetches the current cluster configuration from the Atlas Administration API.
 * Extracts the active instance size and replicationSpec ID required for the PATCH operation.
 *
 * @param {AxiosDigestAuth} client - Authenticated Axios digest client
 * @returns {{ clusterTier: string, replicationSpecId: string }}
 */
const fetchClusterConfiguration = async (client) => {
  const url = `${ATLAS_API_BASE}/groups/${CLUSTER_CONFIG.projectId}/clusters/${CLUSTER_CONFIG.clusterName}`;

  console.log(`[INFO] Fetching cluster configuration: ${CLUSTER_CONFIG.clusterName}`);

  const response = await client.request({
    method:  "GET",
    url,
    headers: { Accept: ATLAS_API_ACCEPT_HEADER },
  });

  const replicationSpec   = response.data.replicationSpecs[0];
  const activeInstanceSize = replicationSpec.regionConfigs[0].electableSpecs.instanceSize;

  console.log(`[INFO] Current cluster tier: ${activeInstanceSize}`);
  console.log(`[INFO] ReplicationSpec ID: ${replicationSpec.id}`);

  return {
    clusterTier:       activeInstanceSize,
    replicationSpecId: replicationSpec.id,
  };
};

// ─────────────────────────────────────────────
// Core: Execute Cluster Scale-Up
// ─────────────────────────────────────────────

/**
 * Submits a PATCH request to the Atlas Administration API to scale up the cluster.
 * Applies updated replication specifications across all configured regions.
 *
 * @param {AxiosDigestAuth} client            - Authenticated Axios digest client
 * @param {string}          currentTier       - Current instance size (pre-scale)
 * @param {string}          replicationSpecId - Existing replicationSpec ID
 */
const executeClusterScaleUp = async (client, currentTier, replicationSpecId) => {
  const { targetTier } = SCALING_POLICY;
  const url = `${ATLAS_API_BASE}/groups/${CLUSTER_CONFIG.projectId}/clusters/${CLUSTER_CONFIG.clusterName}`;

  console.log(`[INFO] Initiating scale-up: ${currentTier} → ${targetTier}`);

  const payload = buildReplicationSpecsPayload(replicationSpecId, targetTier);

  const response = await client.request({
    method:  "PATCH",
    url,
    headers: { Accept: ATLAS_API_ACCEPT_HEADER },
    data:    payload,
  });

  console.log(`[INFO] Scale-up initiated successfully.`);
  console.log(`[INFO] Atlas response state: ${response.data.stateName}`);
};

// ─────────────────────────────────────────────
// Entry Point: Scheduled Trigger Handler
// ─────────────────────────────────────────────

/**
 * Main entry point invoked by the Atlas Scheduled Trigger.
 * Orchestrates the full scale-up workflow:
 *   fetch config → validate tier → conditional scale-up → log outcome
 */
exports = async function () {
  console.log("─────────────────────────────────────────────────");
  console.log("[START] Atlas Cluster Scale-Up Workflow");
  console.log(`[INFO]  Cluster  : ${CLUSTER_CONFIG.clusterName}`);
  console.log(`[INFO]  Policy   : ${SCALING_POLICY.sourceTier} → ${SCALING_POLICY.targetTier}`);
  console.log("─────────────────────────────────────────────────");

  const client = new AxiosDigestAuth({
    username: CLUSTER_CONFIG.publicKey,
    password: CLUSTER_CONFIG.privateKey,
  });

  try {
    // Step 1: Retrieve current cluster configuration
    const { clusterTier, replicationSpecId } = await fetchClusterConfiguration(client);

    // Step 2: Validate tier — only proceed if cluster is at expected source tier
    if (clusterTier !== SCALING_POLICY.sourceTier) {
      console.log(`[SKIP] Cluster is currently ${clusterTier}. Expected ${SCALING_POLICY.sourceTier}. No action taken.`);
      console.log("[END]  Workflow exited — scale-up condition not met.");
      return;
    }

    // Step 3: Execute scale-up
    await executeClusterScaleUp(client, clusterTier, replicationSpecId);

    console.log("[SUCCESS] Scale-up workflow completed.");

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
  console.log("[END] Atlas Cluster Scale-Up Workflow");
  console.log("─────────────────────────────────────────────────");
};
