#!/bin/bash

# Define variables
URI="mongodb+srv://<username>:<password>@<your-cluster-url>/?retryWrites=true&w=majority"
SCRIPT_PATH="/path/to/find-unused-indexes.js"
OUTPUT_FILE="/path/to/reports/unused-indexes-$(date +%Y-%m-%d).csv"

# Execute mongosh in --quiet mode to suppress startup banners, 
# run the script, and pipe output to the CSV file.
mongosh "$URI" --quiet --file "$SCRIPT_PATH" > "$OUTPUT_FILE"

echo "Index scan complete. Report saved to $OUTPUT_FILE"
