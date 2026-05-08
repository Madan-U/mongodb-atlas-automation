/**
 * @file find-unused-indexes.js
 * @description Scans all authorized databases for underutilized indexes.
 * @output CSV format to standard output.
 */

(function () {
  // --- Configuration ---
  var MAX_USAGE_THRESHOLD = 10; 
  var EXCLUDED_DBS = ["admin", "local", "config"];
  var EXCLUDED_INDEXES = ["_id_"]; // Default system indexes to ignore

  // Print CSV Header
  print("DBName,CollectionName,IndexName,AccessOps,TrackingSince");

  // Fetch all databases the user has access to
  var dbListCmd = db.getSiblingDB("admin").runCommand({
    listDatabases: 1,
    authorizedDatabases: true
  });

  if (!dbListCmd || dbListCmd.ok !== 1) {
    throw new Error("Failed to list databases");
  }

  // Sort databases alphabetically for clean output
  var databases = (dbListCmd.databases || []).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });

  // Iterate through databases
  databases.forEach(function (dbInfo) {
    var dbName = dbInfo.name;

    // Skip system databases
    if (EXCLUDED_DBS.indexOf(dbName) !== -1) return;

    var dbObj = db.getSiblingDB(dbName);
    var collNames = [];

    try {
      collNames = dbObj.getCollectionNames();
    } catch (e) {
      return; // Skip if no permission
    }

    collNames.sort(function (a, b) {
      return a.localeCompare(b);
    });

    // Iterate through collections
    collNames.forEach(function (collName) {
      // Skip system collections (e.g., system.profile, system.views)
      if (collName.indexOf("system.") === 0) return;

      try {
        var collection = dbObj.getCollection(collName);
        
        // Execute the $indexStats aggregation pipeline
        var statsCursor = collection.aggregate([{ $indexStats: {} }]);

        statsCursor.forEach(function (stat) {
          var indexName = stat.name;
          
          // Handle cases where accesses might not be tracked yet
          var accessOps = (stat.accesses && stat.accesses.ops !== undefined) ? stat.accesses.ops : 0;
          var since = (stat.accesses && stat.accesses.since) ? stat.accesses.since : "Unknown";

          // Format the date to ISO string if it's a valid Date object
          if (since instanceof Date) {
            since = since.toISOString();
          }

          // Evaluate against our threshold and exclusions
          if (EXCLUDED_INDEXES.indexOf(indexName) === -1 && accessOps <= MAX_USAGE_THRESHOLD) {
            
            // Format for CSV (escape double quotes just in case)
            var dbCSV = '"' + dbName.replace(/"/g, '""') + '"';
            var collCSV = '"' + collName.replace(/"/g, '""') + '"';
            var idxCSV = '"' + indexName.replace(/"/g, '""') + '"';

            print(
              dbCSV + "," +
              collCSV + "," +
              idxCSV + "," +
              accessOps + "," +
              '"' + since + '"'
            );
          }
        });
      } catch (e) {
        // Silently skip collections that error out (e.g., views)
      }
    });
  });
})();
