/**
 * ============================================================================
 * MongoDB Atlas Collection Statistics Report
 * ============================================================================
 *
 * Description:
 * ----------------------------------------------------------------------------
 * This script generates a detailed CSV-based storage and collection usage
 * report for MongoDB Atlas clusters.
 *
 * It collects collection-level statistics across all accessible user databases
 * and provides insights into:
 *
 *   - Document count
 *   - Index count
 *   - Average document size
 *   - Logical data size
 *   - Index size
 *   - WiredTiger storage allocation size
 *   - Compression ratio
 *   - Reusable/free storage bytes
 *
 * The script is designed for:
 *
 *   - Capacity planning
 *   - Storage growth analysis
 *   - Compression efficiency validation
 *   - Fragmentation analysis
 *   - MongoDB Atlas storage auditing
 *   - Operational DBA reporting
 * Author:
 * ----------------------------------------------------------------------------
 * Madan
 * Cloud Database Administrator
 * ============================================================================
 */
(function () {
 
  var MB = 1024 * 1024;
 
  // ── Skip these — internal or not real user data ──────────────────────────
  var SKIP_DBS = { admin: true, local: true, config: true };
 
  function skipCollection(name) {
    return (
      name.indexOf("system.") === 0 ||
      name.indexOf("$cmd")    === 0
    );
  }
 
  function toMB(bytes) {
    // Always receives raw bytes (scale:1), converts to MB with 3 decimal places
    return ((bytes || 0) / MB).toFixed(3);
  }
 
  function csvQuote(s) {
    return '"' + String(s).replace(/"/g, '""') + '"';
  }
 
  // ── Header ────────────────────────────────────────────────────────────────
  print([
    "DBName",
    "CollectionName",
    "DocumentCount",
    "IndexCount",
    "AvgDocSizeBytes",
    "DataSizeMB",       // uncompressed logical size (stats.size)
    "IndexSizeMB",      // total index size (stats.totalIndexSize)
    "LogicalTotalMB",   // DataSizeMB + IndexSizeMB
    "StorageSizeMB",    // WT on-disk allocated (compressed + fragmented pages)
    "CompressionRatio", // DataSizeMB / StorageSizeMB  (>1 = good compression)
    "FreeReuseBytes"    // WT block-manager reusable bytes (fragmentation indicator)
  ].join(","));
 
  // ── List databases ────────────────────────────────────────────────────────
  var dbListCmd = db.getSiblingDB("admin").runCommand({
    listDatabases: 1,
    authorizedDatabases: true
  });
 
  if (!dbListCmd || dbListCmd.ok !== 1) {
    throw new Error("listDatabases failed — check clusterMonitor role");
  }
 
  var databases = (dbListCmd.databases || []).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
 
  // ── Instance-level grand totals accumulator ──────────────────────────────
  var grandTotals = {
    docs: 0, indexes: 0,
    dataBytes: 0, indexBytes: 0, storageBytes: 0
  };
 
  // ── Per-database loop ─────────────────────────────────────────────────────
  databases.forEach(function (dbInfo) {
    var dbName = dbInfo.name;
 
    if (SKIP_DBS[dbName]) return;
 
    var dbObj    = db.getSiblingDB(dbName);
    var collNames = [];
 
    try {
      collNames = dbObj.getCollectionNames();
    } catch (e) {
      return; // no access
    }
 
    collNames = collNames
      .filter(function (n) { return !skipCollection(n); })
      .sort(function (a, b) { return a.localeCompare(b); });
 
    // Accumulator for DB-level totals row
    var dbTotals = {
      docs: 0, indexes: 0,
      dataBytes: 0, indexBytes: 0, storageBytes: 0
    };
 
    collNames.forEach(function (collName) {
      try {
        // KEY FIX: always pass scale:1 so every size field is in raw bytes.
        // In legacy mongo shell, omitting scale can cause collStats to return
        // sizes in a driver-version-dependent default unit — always be explicit.
        var stats = dbObj.runCommand({ collStats: collName, scale: 1 });
 
        if (!stats || stats.ok !== 1) return;
 
        var docCount    = stats.count         || 0;
        var idxCount    = stats.nindexes      || 0;
        var avgObjSize  = stats.avgObjSize     || 0; // bytes per doc (already per-doc, not scaled)
 
        // All in bytes (scale:1 guarantees this)
        var dataBytes    = stats.size           || 0; // uncompressed logical
        var indexBytes   = stats.totalIndexSize || 0; // all indexes combined
        var storageBytes = stats.storageSize    || 0; // WT on-disk
 
        // WiredTiger block-manager reuse bytes (fragmented/wasted space)
        // Only available on WiredTiger storage engine (Atlas always uses WT)
        var wtStats    = stats.wiredTiger || {};
        var bmStats    = wtStats["block-manager"] || {};
        var reuseBytes = bmStats["file bytes available for reuse"] || 0;
 
        // Compression ratio: how well WT compressed the data
        // > 1.0 = good (logical bigger than on-disk)
        // < 1.0 = storageSize > logical (fragmentation, pre-allocated space)
        var compressionRatio = storageBytes > 0
          ? (dataBytes / storageBytes).toFixed(3)
          : "N/A";
 
        // Accumulate DB totals
        dbTotals.docs         += docCount;
        dbTotals.indexes      += idxCount;
        dbTotals.dataBytes    += dataBytes;
        dbTotals.indexBytes   += indexBytes;
        dbTotals.storageBytes += storageBytes;
 
        print([
          csvQuote(dbName),
          csvQuote(collName),
          docCount,
          idxCount,
          Math.round(avgObjSize),
          toMB(dataBytes),
          toMB(indexBytes),
          toMB(dataBytes + indexBytes),   // logical total
          toMB(storageBytes),
          compressionRatio,
          reuseBytes                       // raw bytes — easy to spot large values
        ].join(","));
 
      } catch (e) {
        // print a partial row so you know which collection errored
        print([
          csvQuote(dbName),
          csvQuote(collName),
          "ERROR: " + e.message
        ].join(","));
      }
    });
 
    // Accumulate into instance-level grand totals
    grandTotals.docs         += dbTotals.docs;
    grandTotals.indexes      += dbTotals.indexes;
    grandTotals.dataBytes    += dbTotals.dataBytes;
    grandTotals.indexBytes   += dbTotals.indexBytes;
    grandTotals.storageBytes += dbTotals.storageBytes;
 
  });
 
  // ── Single instance-level grand total row ────────────────────────────────
  var grandCompressionRatio = grandTotals.storageBytes > 0
    ? (grandTotals.dataBytes / grandTotals.storageBytes).toFixed(3)
    : "N/A";
 
  print([
    csvQuote("INSTANCE_TOTAL"),
    csvQuote("__ALL_DBS_ALL_COLLECTIONS__"),
    grandTotals.docs,
    grandTotals.indexes,
    "",
    toMB(grandTotals.dataBytes),
    toMB(grandTotals.indexBytes),
    toMB(grandTotals.dataBytes + grandTotals.indexBytes),
    toMB(grandTotals.storageBytes),
    grandCompressionRatio,
    ""
  ].join(","));
 
})();
